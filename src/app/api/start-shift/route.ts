/**
 * POST /api/start-shift - Clock In
 *
 * Creates a new shift record and records the starting drawer count for an employee.
 *
 * Authentication: Bearer token required (employee PIN JWT or manager Supabase session)
 * - Employee PIN JWT: issued by employee-auth edge function after PIN verification
 * - Manager Supabase: manager can clock in for themselves only (profile linked via auth_user_id)
 *
 * Request body:
 * - qrToken?: string - QR token to identify the store (alternative to storeId)
 * - storeId?: string - Store ID (alternative to qrToken; one of qrToken or storeId required)
 * - profileId: string - Employee profile ID (must match authenticated user)
 * - shiftTypeHint?: "open" | "close" | "double" | "other" - Optional hint (server derives shift_type)
 * - plannedStartAt: string - ISO timestamp of planned start time (required)
 * - startDrawerCents?: number | null - Starting drawer count in cents (required for non-"other" shifts)
 * - changeDrawerCents?: number | null - Change drawer count in cents (required for non-"other" shifts)
 * - confirmed?: boolean - Whether the drawer count was confirmed (required if out of threshold)
 * - notifiedManager?: boolean - Whether manager was notified of discrepancy
 * - note?: string | null - Optional note about the drawer count
 *
 * Returns:
 * - Success: { shiftId: string, reused: boolean, startedAt?: string }
 * - Error: { error: string, requiresConfirm?: boolean, shiftId?: string }
 *
 * Business logic:
 * - Authenticates via employee PIN JWT or manager Supabase session
 * - Validates profileId matches authenticated user (no impersonation)
 * - Resolves store by QR token or store ID
 * - Validates employee exists, is active, and is assigned to the store
 * - Rounds planned start time to nearest 30 minutes for payroll consistency
 * - For non-"other" shifts, requires starting drawer count
 * - If drawer count is outside expected threshold, requires manager notification
 * - Prevents duplicate active shifts - returns existing shift if employee already clocked in at same store
 * - Blocks clock-in if employee has active shift at different store
 * - Matches planned start to published schedule (within -5/+15 min). If not scheduled, requires approval.
 * - Creates shift record and drawer count atomically (cleans up shift if drawer count fails)
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold, roundTo30Minutes, ShiftType } from "@/lib/kioskRules";
import { getCstDowMinutes, isTimeWithinWindow, toStoreKey } from "@/lib/clockWindows";
import { authenticateShiftRequest, validateProfileAccess } from "@/lib/shiftAuth";

type Body = {
  qrToken?: string;
  storeId?: string;
  profileId: string;
  shiftTypeHint?: ShiftType;
  plannedStartAt: string; // ISO string
  startDrawerCents?: number | null; // required for non-"other"
  changeDrawerCents?: number | null; // change drawer count in cents
  confirmed?: boolean; // required if out of threshold
  notifiedManager?: boolean;
  note?: string | null;
  force?: boolean;
};

const ALLOWED_SHIFT_TYPES: ShiftType[] = ["open", "close", "double", "other"];

function parseClockWindowError(message: string) {
  const token = "CLOCK_WINDOW_VIOLATION:";
  if (!message.includes(token)) return null;
  const label = message.split(token)[1]?.trim() || "Outside allowed clock window";
  return { code: "CLOCK_WINDOW_VIOLATION", windowLabel: label };
}

export async function POST(req: Request) {
  try {
    // 0) Authenticate request (employee PIN JWT or manager Supabase session)
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const body = (await req.json()) as Body;

    // Basic validation
    if (!body.qrToken && !body.storeId) {
      return NextResponse.json({ error: "Missing qrToken or storeId." }, { status: 400 });
    }
    if (!body.profileId) return NextResponse.json({ error: "Missing profileId." }, { status: 400 });

    // Validate profileId matches authenticated user (no impersonation)
    const profileCheck = validateProfileAccess(auth, body.profileId);
    if (!profileCheck.ok) {
      return NextResponse.json({ error: profileCheck.error }, { status: 403 });
    }

    if (body.shiftTypeHint && !ALLOWED_SHIFT_TYPES.includes(body.shiftTypeHint))
      return NextResponse.json({ error: "Invalid shiftTypeHint." }, { status: 400 });

    if (!body.plannedStartAt) return NextResponse.json({ error: "Missing plannedStartAt." }, { status: 400 });

    // 1) Resolve store by QR token or storeId
    const storeQuery = supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents");

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

    // 4b) Determine schedule match + shift type from schedule if possible
    const plannedCst = getCstDowMinutes(plannedRounded);
    const plannedDateKey = plannedRounded.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const plannedMinutes = plannedCst?.minutes ?? null;

    const { data: scheduledRows, error: schedErr } = await supabaseServer
      .from("schedule_shifts")
      .select("id, shift_type, scheduled_start, scheduled_end, shift_date, schedules!inner(status)")
      .eq("store_id", store.id)
      .eq("profile_id", body.profileId)
      .eq("shift_date", plannedDateKey)
      .eq("schedules.status", "published");

    if (schedErr) return NextResponse.json({ error: schedErr.message }, { status: 500 });

    let matchedSchedule: { id: string; shift_type: ShiftType } | null = null;
    if (plannedMinutes != null && scheduledRows?.length) {
      let best: { id: string; shift_type: ShiftType; score: number } | null = null;
      for (const row of scheduledRows) {
        const [h, m] = row.scheduled_start.split(":");
        const schedMinutes = Number(h) * 60 + Number(m);
        const diff = plannedMinutes - schedMinutes;
        if (diff >= -5 && diff <= 15) {
          const score = Math.abs(diff);
          if (!best || score < best.score) {
            best = { id: row.id, shift_type: row.shift_type as ShiftType, score };
          }
        }
      }
      if (best) matchedSchedule = { id: best.id, shift_type: best.shift_type };
    }

    const isScheduled = Boolean(matchedSchedule);
    if (!isScheduled && !body.force) {
      return NextResponse.json(
        { error: "UNSCHEDULED", code: "UNSCHEDULED", requiresApproval: true },
        { status: 409 }
      );
    }

    let resolvedShiftType: ShiftType = matchedSchedule?.shift_type ?? "other";
    if (!isScheduled) {
      if (plannedCst) {
        const { data: templates } = await supabaseServer
          .from("shift_templates")
          .select("shift_type, start_time")
          .eq("store_id", store.id)
          .eq("day_of_week", plannedCst.dow)
          .in("shift_type", ["open", "close"]);

        const toMinutes = (timeStr: string) => {
          const [hh, mm] = timeStr.split(":");
          return Number(hh) * 60 + Number(mm);
        };

        if (templates && templates.length > 0 && plannedMinutes != null) {
          const openStart = templates.find(t => t.shift_type === "open")?.start_time;
          const closeStart = templates.find(t => t.shift_type === "close")?.start_time;
          if (openStart && Math.abs(plannedMinutes - toMinutes(openStart)) <= 120) {
            resolvedShiftType = "open";
          } else if (closeStart && Math.abs(plannedMinutes - toMinutes(closeStart)) <= 120) {
            resolvedShiftType = "close";
          } else {
            resolvedShiftType = "other";
          }
        } else if (body.shiftTypeHint && ALLOWED_SHIFT_TYPES.includes(body.shiftTypeHint)) {
          resolvedShiftType = body.shiftTypeHint;
        }
      } else if (body.shiftTypeHint && ALLOWED_SHIFT_TYPES.includes(body.shiftTypeHint)) {
        resolvedShiftType = body.shiftTypeHint;
      }
    }

    // 4c) Enforce clock window for open shifts only when scheduled
    if (isScheduled && resolvedShiftType === "open") {
      const storeKey = toStoreKey(store.name);
      const cst = getCstDowMinutes(plannedRounded);
      if (!storeKey || !cst) {
        return NextResponse.json(
          { error: "CLOCK_WINDOW_VIOLATION", code: "CLOCK_WINDOW_VIOLATION", windowLabel: "Outside allowed clock window" },
          { status: 400 }
        );
      }
      const windowCheck = isTimeWithinWindow({
        storeKey,
        shiftType: "open",
        localDow: cst.dow,
        minutes: cst.minutes,
      });
      if (!windowCheck.ok) {
        return NextResponse.json(
          { error: "CLOCK_WINDOW_VIOLATION", code: "CLOCK_WINDOW_VIOLATION", windowLabel: windowCheck.windowLabel },
          { status: 400 }
        );
      }
    }

    // 5) Enforce start drawer rules BEFORE creating the shift
    const startCents = body.startDrawerCents ?? null;
    const changeCents = body.changeDrawerCents ?? null;

    if (resolvedShiftType !== "other") {
      // Required for open/close/double
      if (startCents === null || startCents === undefined) {
        return NextResponse.json(
          { error: "Missing startDrawerCents (required for this shift type)." },
          { status: 400 }
        );
      }
      if (changeCents === null || changeCents === undefined || !Number.isFinite(changeCents)) {
        return NextResponse.json(
          { error: "Missing changeDrawerCents (required for this shift type)." },
          { status: 400 }
        );
      }

      const out = isOutOfThreshold(startCents, store.expected_drawer_cents);
      const changeNot200 = changeCents !== 20000;
      if ((out || changeNot200) && !body.notifiedManager) {
        return NextResponse.json(
          { error: "Start drawer or change drawer requires manager notification.", requiresConfirm: true },
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
      if (changeCents !== null && changeCents !== undefined) {
        if (!Number.isFinite(changeCents)) {
          return NextResponse.json({ error: "Invalid changeDrawerCents." }, { status: 400 });
        }
        const changeNot200 = changeCents !== 20000;
        if (changeNot200 && !body.notifiedManager) {
          return NextResponse.json(
            { error: "Change drawer not $200. Must notify manager.", requiresConfirm: true },
            { status: 400 }
          );
        }
      }
    }

    // 6) Prevent duplicate active shifts (employee taps twice, phone refreshes, life happens)
    const { data: existing, error: existingErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, started_at, shift_type")
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
        shiftType: existing.shift_type ?? null,
      });
    }

    // 7) Create shift
    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .insert({
        store_id: store.id,
        profile_id: body.profileId,
        shift_type: resolvedShiftType,
        schedule_shift_id: matchedSchedule?.id ?? null,
        shift_source: isScheduled ? "scheduled" : "manual",
        requires_override: !isScheduled,
        override_note: !isScheduled ? "Unscheduled clock-in" : null,
        planned_start_at: plannedRounded.toISOString(),
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (shiftErr) {
      const parsed = parseClockWindowError(shiftErr.message);
      if (parsed) {
        return NextResponse.json(
          { error: "CLOCK_WINDOW_VIOLATION", code: parsed.code, windowLabel: parsed.windowLabel },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    }
    if (!shift) return NextResponse.json({ error: "Failed to create shift." }, { status: 500 });

    // 8) Insert start drawer count for non-other; optional for other if provided
    if (startCents !== null && startCents !== undefined) {
      const { error: sdcErr } = await supabaseServer.from("shift_drawer_counts").insert({
        shift_id: shift.id,
        count_type: "start",
        drawer_cents: startCents,
        change_count: changeCents,
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

    return NextResponse.json({ shiftId: shift.id, reused: false, shiftType: resolvedShiftType });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Start shift failed." },
      { status: 500 }
    );
  }
}
