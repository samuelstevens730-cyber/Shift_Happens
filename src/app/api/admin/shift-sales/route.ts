import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ShiftSalesResponse, ShiftSalesRow } from "@/types/adminShiftSales";

function isDateOnly(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function cstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function businessDateFromIso(iso: string): string {
  return cstDateKey(new Date(iso));
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      const empty: ShiftSalesResponse = { stores: [], rows: [], from: "", to: "" };
      return NextResponse.json(empty);
    }

    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId");
    if (storeId && storeId !== "all" && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store filter." }, { status: 403 });
    }
    const activeStoreIds = storeId && storeId !== "all" ? [storeId] : managerStoreIds;

    const defaultTo = cstDateKey(new Date());
    const defaultFrom = cstDateKey(addDays(new Date(), -13));
    const from = isDateOnly(url.searchParams.get("from")) ? (url.searchParams.get("from") as string) : defaultFrom;
    const to = isDateOnly(url.searchParams.get("to")) ? (url.searchParams.get("to") as string) : defaultTo;

    const [storesRes, shiftsRes, salesRes, profilesRes] = await Promise.all([
      supabaseServer
        .from("stores")
        .select("id,name")
        .in("id", activeStoreIds)
        .order("name", { ascending: true })
        .returns<Array<{ id: string; name: string }>>(),
      supabaseServer
        .from("shifts")
        .select("id,store_id,profile_id,shift_type,planned_start_at,started_at,ended_at,last_action")
        .in("store_id", activeStoreIds)
        .gte("started_at", `${from}T00:00:00.000Z`)
        .lte("started_at", `${to}T23:59:59.999Z`)
        .neq("last_action", "removed")
        .order("started_at", { ascending: false })
        .returns<
          Array<{
            id: string;
            store_id: string;
            profile_id: string;
            shift_type: "open" | "close" | "double" | "other";
            planned_start_at: string;
            started_at: string;
            ended_at: string | null;
            last_action: string | null;
          }>
        >(),
      supabaseServer
        .from("daily_sales_records")
        .select(
          "id,store_id,business_date,open_shift_id,close_shift_id,open_x_report_cents,close_sales_cents,z_report_cents,rollover_from_previous_cents,closer_rollover_cents,is_rollover_night"
        )
        .in("store_id", activeStoreIds)
        .gte("business_date", from)
        .lte("business_date", to)
        .returns<
          Array<{
            id: string;
            store_id: string;
            business_date: string;
            open_shift_id: string | null;
            close_shift_id: string | null;
            open_x_report_cents: number | null;
            close_sales_cents: number | null;
            z_report_cents: number | null;
            rollover_from_previous_cents: number | null;
            closer_rollover_cents: number | null;
            is_rollover_night: boolean | null;
          }>
        >(),
      supabaseServer
        .from("profiles")
        .select("id,name")
        .returns<Array<{ id: string; name: string | null }>>(),
    ]);

    for (const result of [storesRes, shiftsRes, salesRes, profilesRes]) {
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
    }

    const storeNameById = new Map((storesRes.data ?? []).map((s) => [s.id, s.name]));
    const profileNameById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.name]));

    const salesByOpenShiftId = new Map(
      (salesRes.data ?? [])
        .filter((row) => Boolean(row.open_shift_id))
        .map((row) => [row.open_shift_id as string, row])
    );
    const salesByCloseShiftId = new Map(
      (salesRes.data ?? [])
        .filter((row) => Boolean(row.close_shift_id))
        .map((row) => [row.close_shift_id as string, row])
    );
    const salesByStoreDate = new Map(
      (salesRes.data ?? []).map((row) => [`${row.store_id}|${row.business_date}`, row])
    );

    const rows: ShiftSalesRow[] = (shiftsRes.data ?? []).map((shift) => {
      const businessDate = businessDateFromIso(shift.planned_start_at);
      const salesRecord =
        salesByOpenShiftId.get(shift.id) ??
        salesByCloseShiftId.get(shift.id) ??
        salesByStoreDate.get(`${shift.store_id}|${businessDate}`) ??
        null;

      const beginningX = salesRecord?.rollover_from_previous_cents ?? 0;
      const openX = salesRecord?.open_x_report_cents ?? null;
      const closeSales = salesRecord?.close_sales_cents ?? null;
      const zReport = salesRecord?.z_report_cents ?? null;
      const priorX = openX;
      const midnightX = salesRecord?.closer_rollover_cents ?? null;
      const isRolloverNight = Boolean(salesRecord?.is_rollover_night);

      let salesCents: number | null = null;
      let formula = "No sales data captured";

      if (shift.shift_type === "open") {
        if (openX != null) {
          salesCents = openX - beginningX;
          formula = beginningX > 0 ? "Open Sales = End X - Beginning X" : "Open Sales = End X";
        } else {
          formula = "Open Sales missing End X";
        }
      } else if (shift.shift_type === "close" || shift.shift_type === "double") {
        const baseClose = closeSales ?? (zReport != null && priorX != null ? zReport - priorX : null);
        if (baseClose != null) {
          salesCents = baseClose + (isRolloverNight ? midnightX ?? 0 : 0);
          formula = isRolloverNight
            ? "PM Sales = (Z - Morning X) + Midnight X"
            : "PM Sales = Z - Morning X";
        } else {
          formula = "PM Sales missing Z or Morning X";
        }
      } else {
        formula = "Shift type does not use sales formula";
      }

      return {
        shiftId: shift.id,
        storeId: shift.store_id,
        storeName: storeNameById.get(shift.store_id) ?? null,
        profileId: shift.profile_id,
        employeeName: profileNameById.get(shift.profile_id) ?? null,
        shiftType: shift.shift_type,
        businessDate,
        startedAt: shift.started_at,
        endedAt: shift.ended_at,
        salesCents,
        formula,
        openXReportCents: openX,
        priorXReportCents: priorX,
        zReportCents: zReport,
        beginningXReportCents: beginningX > 0 ? beginningX : null,
        midnightXReportCents: midnightX,
        isRolloverNight,
      };
    });

    const response: ShiftSalesResponse = {
      stores: storesRes.data ?? [],
      rows,
      from,
      to,
    };
    return NextResponse.json(response);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load shift sales." },
      { status: 500 }
    );
  }
}
