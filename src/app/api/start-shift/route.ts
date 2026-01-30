/**
 * POST /api/start-shift - Clock In
 *
 * Creates a new shift record and records the starting drawer count for an employee.
 *
 * Request body:
 * - qrToken?: string - QR token to identify the store (alternative to storeId)
 * - storeId?: string - Store ID (alternative to qrToken; one of qrToken or storeId required)
 * - profileId: string - Employee profile ID (required)
 * - shiftType: "open" | "close" | "double" | "other" - Type of shift (required)
 * - plannedStartAt: string - ISO timestamp of planned start time (required)
 * - startDrawerCents?: number | null - Starting drawer count in cents (required for non-"other" shifts)
 * - confirmed?: boolean - Whether the drawer count was confirmed (required if out of threshold)
 * - notifiedManager?: boolean - Whether manager was notified of discrepancy
 * - note?: string | null - Optional note about the drawer count
 *
 * Returns:
 * - Success: { shiftId: string, reused: boolean, startedAt?: string }
 * - Error: { error: string, requiresConfirm?: boolean, shiftId?: string }
 *
 * Business logic:
 * - Resolves store by QR token or store ID
 * - Validates employee exists, is active, and is assigned to the store
 * - Rounds planned start time to nearest 30 minutes for payroll consistency
 * - For non-"other" shifts, requires starting drawer count
 * - If drawer count is outside expected threshold, requires manager notification
 * - Prevents duplicate active shifts - returns existing shift if employee already clocked in at same store
 * - Blocks clock-in if employee has active shift at different store
 * - Creates shift record and drawer count atomically (cleans up shift if drawer count fails)
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold, roundTo30Minutes, ShiftType } from "@/lib/kioskRules";

type Body = {
  qrToken?: string;
  storeId?: string;
  profileId: string;
  shiftType: ShiftType;
  plannedStartAt: string; // ISO string
  startDrawerCents?: number | null; // required for non-"other"
  confirmed?: boolean; // required if out of threshold
  notifiedManager?: boolean;
  note?: string | null;
};

const ALLOWED_SHIFT_TYPES: ShiftType[] = ["open", "close", "double", "other"];

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    // Basic validation
    if (!body.qrToken && !body.storeId) {
      return NextResponse.json({ error: "Missing qrToken or storeId." }, { status: 400 });
    }
    if (!body.profileId) return NextResponse.json({ error: "Missing profileId." }, { status: 400 });
    if (!body.shiftType) return NextResponse.json({ error: "Missing shiftType." }, { status: 400 });
    if (!ALLOWED_SHIFT_TYPES.includes(body.shiftType))
      return NextResponse.json({ error: "Invalid shiftType." }, { status: 400 });

    if (!body.plannedStartAt) return NextResponse.json({ error: "Missing plannedStartAt." }, { status: 400 });

    // 1) Resolve store by QR token or storeId
    const storeQuery = supabaseServer
      .from("stores")
      .select("id, expected_drawer_cents");

    const { data: store, error: storeErr } = body.qrToken
      ? await storeQuery.eq("qr_token", body.qrToken).maybeSingle()
      : await storeQuery.eq("id", body.storeId).maybeSingle();

    if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
    if (!store) return NextResponse.json({ error: "Invalid store." }, { status: 401 });

    // 2) Validate profile exists + active
    const { data: prof, error: profErr } = await supabaseServer
      .from("profiles")
      .select("id, active")
      .eq("id", body.profileId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof || prof.active === false)
      return NextResponse.json({ error: "Invalid or inactive employee." }, { status: 400 });

    // 3) Membership check (you made the table, so use it)
    const { data: mem, error: memErr } = await supabaseServer
      .from("store_memberships")
      .select("store_id")
      .eq("store_id", store.id)
      .eq("profile_id", body.profileId)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    if (!mem) return NextResponse.json({ error: "Employee not assigned to this store." }, { status: 400 });

    // 4) Round planned start time (payroll sanity)
    const planned = new Date(body.plannedStartAt);
    if (Number.isNaN(planned.getTime()))
      return NextResponse.json({ error: "Invalid plannedStartAt." }, { status: 400 });
    const plannedRounded = roundTo30Minutes(planned);

    // 5) Enforce start drawer rules BEFORE creating the shift
    const startCents = body.startDrawerCents ?? null;

    if (body.shiftType !== "other") {
      // Required for open/close/double
      if (startCents === null || startCents === undefined) {
        return NextResponse.json(
          { error: "Missing startDrawerCents (required for this shift type)." },
          { status: 400 }
        );
      }

      const out = isOutOfThreshold(startCents, store.expected_drawer_cents);
      if (out && !body.notifiedManager) {
        return NextResponse.json(
          { error: "Start drawer outside threshold. Must notify manager.", requiresConfirm: true },
          { status: 400 }
        );
      }
    } else {
      // "other" is exempt, but if they provide a number, still enforce confirm if it's wild
      if (startCents !== null && startCents !== undefined) {
        const out = isOutOfThreshold(startCents, store.expected_drawer_cents);
        if (out && !body.notifiedManager) {
          return NextResponse.json(
            { error: "Start drawer outside threshold. Must notify manager.", requiresConfirm: true },
            { status: 400 }
          );
        }
      }
    }

    // 6) Prevent duplicate active shifts (employee taps twice, phone refreshes, life happens)
    const { data: existing, error: existingErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, started_at")
      .eq("profile_id", body.profileId)
      .is("ended_at", null)
      .maybeSingle();

    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

    if (existing?.id) {
      // If they already have an active shift in another store, block it.
      if (existing.store_id !== store.id) {
        return NextResponse.json(
          { error: "Employee already has an active shift at another store.", shiftId: existing.id },
          { status: 409 }
        );
      }

      // Same store: return existing shift as idempotent behavior
      return NextResponse.json({
        shiftId: existing.id,
        reused: true,
        startedAt: existing.started_at ?? null,
      });
    }

    // 7) Create shift
    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .insert({
        store_id: store.id,
        profile_id: body.profileId,
        shift_type: body.shiftType,
        planned_start_at: plannedRounded.toISOString(),
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Failed to create shift." }, { status: 500 });

    // 8) Insert start drawer count for non-other; optional for other if provided
    if (startCents !== null && startCents !== undefined) {
      const { error: sdcErr } = await supabaseServer.from("shift_drawer_counts").insert({
        shift_id: shift.id,
        count_type: "start",
        drawer_cents: startCents,
        confirmed: Boolean(body.confirmed),
        notified_manager: Boolean(body.notifiedManager),
        note: body.note ?? null,
      });

      if (sdcErr) {
        // Clean up the created shift so you don’t accumulate ghosts
        await supabaseServer.from("shifts").delete().eq("id", shift.id);
        return NextResponse.json({ error: sdcErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ shiftId: shift.id, reused: false });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Start shift failed." },
      { status: 500 }
    );
  }
}
