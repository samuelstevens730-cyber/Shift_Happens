import { NextResponse } from "next/server";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type ShiftType = "open" | "close" | "double" | "other";

type DailySalesRecordRow = {
  id: string;
  open_x_report_cents: number | null;
  close_sales_cents: number | null;
  z_report_cents: number | null;
  closer_rollover_cents: number | null;
  opener_rollover_cents: number | null;
  is_rollover_night: boolean | null;
};

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseShiftType(value: string | null): ShiftType | null {
  if (value === "open" || value === "close" || value === "double" || value === "other") {
    return value;
  }
  return null;
}

function dayOfWeekFromDateOnly(dateOnly: string): number {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return dt.getUTCDay();
}

function previousDateOnly(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auth = authResult.auth;

    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId");
    const businessDate = url.searchParams.get("businessDate");
    const shiftType = parseShiftType(url.searchParams.get("shiftType"));

    if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
    if (!businessDate || !isDateOnly(businessDate)) {
      return NextResponse.json({ error: "businessDate must be YYYY-MM-DD." }, { status: 400 });
    }
    if (!shiftType) return NextResponse.json({ error: "Invalid shiftType." }, { status: 400 });
    if (!validateStoreAccess(auth, storeId)) {
      return NextResponse.json({ error: "You do not have access to this store." }, { status: 403 });
    }

    const [settingsRes, rolloverConfigRes, dailyRecordRes, prevRecordRes] = await Promise.all([
      supabaseServer
        .from("store_settings")
        .select("sales_tracking_enabled, sales_rollover_enabled")
        .eq("store_id", storeId)
        .maybeSingle<{ sales_tracking_enabled: boolean | null; sales_rollover_enabled: boolean | null }>(),
      supabaseServer
        .from("store_rollover_config")
        .select("has_rollover")
        .eq("store_id", storeId)
        .eq("day_of_week", dayOfWeekFromDateOnly(businessDate))
        .maybeSingle<{ has_rollover: boolean | null }>(),
      supabaseServer
        .from("daily_sales_records")
        .select("id, open_x_report_cents, close_sales_cents, z_report_cents, closer_rollover_cents, opener_rollover_cents, is_rollover_night")
        .eq("store_id", storeId)
        .eq("business_date", businessDate)
        .maybeSingle<DailySalesRecordRow>(),
      supabaseServer
        .from("daily_sales_records")
        .select("id, open_x_report_cents, close_sales_cents, z_report_cents, closer_rollover_cents, opener_rollover_cents, is_rollover_night")
        .eq("store_id", storeId)
        .eq("business_date", previousDateOnly(businessDate))
        .maybeSingle<DailySalesRecordRow>(),
    ]);

    if (settingsRes.error) return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
    if (rolloverConfigRes.error) return NextResponse.json({ error: rolloverConfigRes.error.message }, { status: 500 });
    if (dailyRecordRes.error) return NextResponse.json({ error: dailyRecordRes.error.message }, { status: 500 });
    if (prevRecordRes.error) return NextResponse.json({ error: prevRecordRes.error.message }, { status: 500 });

    const salesTrackingEnabled = Boolean(settingsRes.data?.sales_tracking_enabled);
    const salesRolloverEnabled = settingsRes.data?.sales_rollover_enabled ?? true;
    const priorXReportCents = shiftType === "close" || shiftType === "double"
      ? (dailyRecordRes.data?.open_x_report_cents ?? null)
      : null;
    const isRolloverNight = Boolean(rolloverConfigRes.data?.has_rollover) && Boolean(salesRolloverEnabled);

    const prev = prevRecordRes.data;
    const pendingRollover = Boolean(
      prev?.is_rollover_night &&
      prev?.opener_rollover_cents == null
    );

    return NextResponse.json({
      salesTrackingEnabled,
      priorXReportCents,
      isRolloverNight,
      pendingRollover,
      pendingRolloverDate: pendingRollover ? previousDateOnly(businessDate) : null,
      closerEntryExists: Boolean(prev?.closer_rollover_cents != null),
      closeEntryExists: Boolean(
        dailyRecordRes.data?.close_sales_cents != null &&
        dailyRecordRes.data?.z_report_cents != null
      ),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load sales context." },
      { status: 500 }
    );
  }
}
