import { NextResponse } from "next/server";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = {
  shiftId?: string;
  salesZReportCents?: number;
  salesPriorXCents?: number;
  salesConfirmed?: boolean;
  // closeTransactionCount intentionally omitted — transactions are captured
  // at midnight clock-out (end-shift), not at the 10 PM Z-report checkpoint.
};

type ShiftRow = {
  id: string;
  store_id: string;
  profile_id: string;
  shift_type: "open" | "close" | "double" | "other";
  planned_start_at: string;
  ended_at: string | null;
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

function dayOfWeekFromDateOnly(dateOnly: string): number {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return dt.getUTCDay();
}

export async function POST(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const zReportRaw = body.salesZReportCents;
    const priorXRaw = body.salesPriorXCents;
    if (!Number.isFinite(zReportRaw) || (zReportRaw ?? 0) < 0) {
      return NextResponse.json({ error: "Missing or invalid Z report total." }, { status: 400 });
    }
    if (!Number.isFinite(priorXRaw) || (priorXRaw ?? 0) < 0) {
      return NextResponse.json({ error: "Missing or invalid prior X report total." }, { status: 400 });
    }

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, shift_type, planned_start_at, ended_at")
      .eq("id", body.shiftId)
      .maybeSingle<ShiftRow>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.profile_id !== auth.profileId) {
      return NextResponse.json({ error: "You can only submit for your own shift." }, { status: 403 });
    }
    if (!validateStoreAccess(auth, shift.store_id)) {
      return NextResponse.json({ error: "You do not have access to this store." }, { status: 403 });
    }
    if (shift.shift_type !== "close" && shift.shift_type !== "double") {
      return NextResponse.json({ error: "Close checkpoint is only valid for close or double shifts." }, { status: 400 });
    }

    const businessDate = getCstDateKey(shift.planned_start_at);
    if (!businessDate) return NextResponse.json({ error: "Invalid shift date." }, { status: 400 });

    const [settingsRes, rolloverRes] = await Promise.all([
      supabaseServer
        .from("store_settings")
        .select("sales_tracking_enabled, sales_rollover_enabled")
        .eq("store_id", shift.store_id)
        .maybeSingle<{ sales_tracking_enabled: boolean | null; sales_rollover_enabled: boolean | null }>(),
      supabaseServer
        .from("store_rollover_config")
        .select("has_rollover")
        .eq("store_id", shift.store_id)
        .eq("day_of_week", dayOfWeekFromDateOnly(businessDate))
        .maybeSingle<{ has_rollover: boolean | null }>(),
    ]);
    if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
    if (rolloverRes.error) return NextResponse.json({ error: rolloverRes.error.message }, { status: 500 });

    if (!settingsRes.data?.sales_tracking_enabled) {
      return NextResponse.json({ error: "Sales tracking is disabled for this store." }, { status: 400 });
    }
    if (!(settingsRes.data?.sales_rollover_enabled ?? true)) {
      return NextResponse.json({ error: "Rollover flow is disabled for this store." }, { status: 400 });
    }
    if (!rolloverRes.data?.has_rollover) {
      return NextResponse.json({ error: "This date is not configured as a rollover night." }, { status: 400 });
    }

    const zReportCents = Math.round(zReportRaw ?? 0);
    const priorXReportCents = Math.round(priorXRaw ?? 0);
    const closeSalesCents = zReportCents - priorXReportCents;

    const { data: dailyRecord, error: dailyErr } = await supabaseServer
      .from("daily_sales_records")
      .upsert(
        {
          store_id: shift.store_id,
          business_date: businessDate,
          close_shift_id: shift.id,
          close_sales_cents: closeSalesCents,
          z_report_cents: zReportCents,
          is_rollover_night: true,
          // close_transaction_count is NOT written here — it's captured at
          // midnight clock-out (end-shift) where the closer knows the full count.
        },
        { onConflict: "store_id,business_date" }
      )
      .select("id, out_of_balance, balance_variance_cents")
      .maybeSingle<{ id: string; out_of_balance: boolean | null; balance_variance_cents: number | null }>();
    if (dailyErr) return NextResponse.json({ error: dailyErr.message }, { status: 500 });
    if (!dailyRecord?.id) return NextResponse.json({ error: "Failed to save close checkpoint." }, { status: 500 });

    const { error: shiftSalesErr } = await supabaseServer
      .from("shift_sales_counts")
      .upsert(
        {
          shift_id: shift.id,
          daily_sales_record_id: dailyRecord.id,
          entry_type: "z_report",
          amount_cents: zReportCents,
          prior_x_report_cents: priorXReportCents,
          confirmed: Boolean(body.salesConfirmed),
        },
        { onConflict: "shift_id,entry_type" }
      );
    if (shiftSalesErr) return NextResponse.json({ error: shiftSalesErr.message }, { status: 500 });

    const salesWarning = Boolean(dailyRecord.out_of_balance);
    if (salesWarning && !body.salesConfirmed) {
      return NextResponse.json(
        {
          error: "Sales mismatch detected. Please confirm to continue.",
          requiresSalesConfirm: true,
          salesVarianceCents: dailyRecord.balance_variance_cents ?? null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      salesWarning: salesWarning || undefined,
      salesVarianceCents: dailyRecord.balance_variance_cents ?? undefined,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to submit close checkpoint." },
      { status: 500 }
    );
  }
}

