/**
 * POST /api/confirm-changeover - Double Shift Mid-Point Drawer Count
 *
 * Records a changeover drawer count for double shifts at the midpoint between
 * open and close portions. Optionally captures mid-day X report total and
 * the transaction count for the AM half of a double shift.
 *
 * Request body:
 * - qrToken?: string - QR token to validate store ownership (optional)
 * - shiftId: string - Shift ID to record changeover for (required)
 * - drawerCents: number - Drawer count in cents (required)
 * - confirmed?: boolean - Whether the drawer count was confirmed
 * - notifiedManager?: boolean - Whether manager was notified of discrepancy
 * - note?: string | null - Optional note about the drawer count
 * - midXReportCents?: number | null - Net X report total at changeover (enables AM/PM split)
 * - openTransactionCount?: number | null - Transactions rung in the AM half (zero = not captured)
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
 * - When midXReportCents / openTransactionCount are provided they are upserted
 *   into daily_sales_records for the shift's business date (CST)
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold } from "@/lib/kioskRules";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type Body = {
  qrToken?: string;
  shiftId: string;
  drawerCents: number;
  confirmed?: boolean;
  notifiedManager?: boolean;
  note?: string | null;
  /** Net X report total at changeover (cents). Enables AM/PM sales split. */
  midXReportCents?: number | null;
  /** Transactions rung in the AM half. 0 is treated as null (not captured). */
  openTransactionCount?: number | null;
};

function getCstDateKey(value: string): string | null {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

export async function POST(req: Request) {
  try {
    // Authenticate request (employee PIN JWT or manager Supabase session)
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const body = (await req.json()) as Body;
    if (!body.shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });
    if (typeof body.drawerCents !== "number") return NextResponse.json({ error: "Missing drawerCents." }, { status: 400 });

    const { data: shift } = await supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, shift_type, planned_start_at, ended_at")
      .eq("id", body.shiftId)
      .maybeSingle();

    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.ended_at) return NextResponse.json({ error: "Shift already ended." }, { status: 400 });

    // Verify caller owns this shift
    if (shift.profile_id !== auth.profileId) {
      return NextResponse.json({ error: "Not your shift." }, { status: 403 });
    }

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

    // insert or replace changeover drawer count
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

    // Analytics fields (mid_x_report_cents, open_transaction_count) are only
    // meaningful for double shifts — guard here so a direct API call for a
    // non-double shift cannot pollute daily_sales_records with partial data.
    if (shift.shift_type !== "double") {
      return NextResponse.json({ ok: true });
    }

    // Optionally persist mid-day X report total and AM transaction count to
    // daily_sales_records so the analytics layer can compute AM/PM splits.
    const hasMidX =
      typeof body.midXReportCents === "number" &&
      Number.isFinite(body.midXReportCents) &&
      body.midXReportCents >= 0;
    // Zero-contamination guard: treat 0 as "not captured" (same as null).
    const openTxnCount =
      typeof body.openTransactionCount === "number" &&
      Number.isInteger(body.openTransactionCount) &&
      body.openTransactionCount > 0
        ? body.openTransactionCount
        : null;

    if (hasMidX || openTxnCount != null) {
      const businessDate = getCstDateKey(shift.planned_start_at);
      if (businessDate) {
        const patch: Record<string, unknown> = {
          store_id: shift.store_id,
          business_date: businessDate,
        };
        if (hasMidX) patch.mid_x_report_cents = Math.round(body.midXReportCents as number);
        if (openTxnCount != null) patch.open_transaction_count = openTxnCount;

        const { error: dsr } = await supabaseServer
          .from("daily_sales_records")
          .upsert(patch, { onConflict: "store_id,business_date" });
        if (dsr) return NextResponse.json({ error: dsr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Changeover failed." }, { status: 500 });
  }
}
