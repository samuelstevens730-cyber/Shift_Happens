/**
 * POST /api/confirm-changeover - Double Shift Mid-Point Drawer Count
 *
 * Records a changeover drawer count for double shifts at the midpoint between
 * open and close portions.
 *
 * Request body:
 * - qrToken?: string - QR token to validate store ownership (optional)
 * - shiftId: string - Shift ID to record changeover for (required)
 * - drawerCents: number - Drawer count in cents (required)
 * - confirmed?: boolean - Whether the drawer count was confirmed
 * - notifiedManager?: boolean - Whether manager was notified of discrepancy
 * - note?: string | null - Optional note about the drawer count
 *
 * Returns:
 * - Success: { ok: true }
 * - Error: { error: string, requiresConfirm?: boolean }
 *
 * Business logic:
 * - Validates shift exists and is not already ended
 * - Validates QR token matches shift's store if provided
 * - If drawer count is outside expected threshold, requires confirmation
 * - Uses upsert with "changeover" count_type to handle re-submissions gracefully
 * - Typically used for double shifts to record drawer state at shift transition
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold } from "@/lib/kioskRules";

type Body = {
  qrToken?: string;
  shiftId: string;
  drawerCents: number;
  confirmed?: boolean;
  notifiedManager?: boolean;
  note?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });
    if (typeof body.drawerCents !== "number") return NextResponse.json({ error: "Missing drawerCents." }, { status: 400 });

    const { data: shift } = await supabaseServer
      .from("shifts")
      .select("id, store_id, shift_type, ended_at")
      .eq("id", body.shiftId)
      .maybeSingle();

    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.ended_at) return NextResponse.json({ error: "Shift already ended." }, { status: 400 });

    let store: { id: string; expected_drawer_cents: number } | null = null;

    if (body.qrToken) {
      const { data: storeByToken } = await supabaseServer
        .from("stores")
        .select("id, expected_drawer_cents")
        .eq("qr_token", body.qrToken)
        .maybeSingle();
      if (!storeByToken) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });
      if (shift.store_id !== storeByToken.id) return NextResponse.json({ error: "Wrong store." }, { status: 403 });
      store = storeByToken;
    } else {
      const { data: storeById } = await supabaseServer
        .from("stores")
        .select("id, expected_drawer_cents")
        .eq("id", shift.store_id)
        .maybeSingle();
      if (!storeById) return NextResponse.json({ error: "Store not found." }, { status: 404 });
      store = storeById;
    }

    const out = isOutOfThreshold(body.drawerCents, store.expected_drawer_cents);
    if (out && !body.confirmed) {
      return NextResponse.json({ error: "Drawer outside threshold. Must confirm.", requiresConfirm: true }, { status: 400 });
    }

    // insert or replace changeover
    const { error } = await supabaseServer
      .from("shift_drawer_counts")
      .upsert(
        {
          shift_id: body.shiftId,
          count_type: "changeover",
          drawer_cents: body.drawerCents,
          confirmed: Boolean(body.confirmed),
          notified_manager: Boolean(body.notifiedManager),
          note: body.note ?? null,
        },
        { onConflict: "shift_id,count_type" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Changeover failed." }, { status: 500 });
  }
}
