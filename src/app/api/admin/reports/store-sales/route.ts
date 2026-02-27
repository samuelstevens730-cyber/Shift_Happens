/**
 * GET /api/admin/reports/store-sales
 *
 * Aggregates store-level sales, labor, cash-flow, and weather data for the
 * executive store report. Returns JSON or plain-text depending on ?format=.
 *
 * Auth:   Bearer token, manager-scoped to their store(s).
 * Params: from, to (YYYY-MM-DD), storeId ("all" | UUID), format ("json" | "text")
 */

import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  analyzeStoreData,
  type StoreReportShiftRow,
  type StoreReportSalesRow,
  type StoreReportSafeCloseoutRow,
  type StoreReportStoreRow,
} from "@/lib/storeReportAnalyzer";
import { formatStoreReport } from "@/lib/storeReportFormatter";

function isDateOnly(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(req: Request) {
  try {
    // ── Auth ───────────────────────────────────────────────────────────────────
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
    }

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "No stores in scope.", code: "no_stores" }, { status: 403 });
    }

    // ── Query params ───────────────────────────────────────────────────────────
    const url = new URL(req.url);
    const p = url.searchParams;

    // meta=true: return stores only (for UI dropdowns)
    if (p.get("meta") === "true") {
      const storesRes = await supabaseServer
        .from("stores")
        .select("id,name")
        .in("id", managerStoreIds)
        .returns<StoreReportStoreRow[]>();
      return NextResponse.json({ stores: storesRes.data ?? [] });
    }

    const from = p.get("from");
    const to = p.get("to");
    const storeIdParam = p.get("storeId") ?? "all";
    const format = p.get("format") ?? "json";

    if (!isDateOnly(from) || !isDateOnly(to)) {
      return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)." }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: "from must be ≤ to." }, { status: 400 });
    }

    const activeStoreIds =
      storeIdParam !== "all" && managerStoreIds.includes(storeIdParam)
        ? [storeIdParam]
        : managerStoreIds;

    // ── Data fetch (parallel) ─────────────────────────────────────────────────
    const [shiftsRes, salesRes, closeoutsRes, storesRes] = await Promise.all([
      supabaseServer
        .from("shifts")
        .select(
          "id,store_id,profile_id,shift_type,planned_start_at,started_at,ended_at,last_action," +
          "start_weather_condition,start_weather_desc,start_temp_f,end_weather_condition,end_weather_desc,end_temp_f"
        )
        .in("store_id", activeStoreIds)
        .gte("started_at", `${from}T00:00:00.000Z`)
        .lte("started_at", `${to}T23:59:59.999Z`)
        .neq("last_action", "removed")
        .returns<StoreReportShiftRow[]>(),

      supabaseServer
        .from("daily_sales_records")
        .select(
          "store_id,business_date,open_x_report_cents,z_report_cents," +
          "rollover_from_previous_cents,open_transaction_count,close_transaction_count"
        )
        .in("store_id", activeStoreIds)
        .gte("business_date", from)
        .lte("business_date", to)
        .returns<StoreReportSalesRow[]>(),

      supabaseServer
        .from("safe_closeouts")
        .select(
          "store_id,business_date,status,cash_sales_cents,card_sales_cents," +
          "expected_deposit_cents,actual_deposit_cents,variance_cents"
        )
        .in("store_id", activeStoreIds)
        .gte("business_date", from)
        .lte("business_date", to)
        .neq("status", "draft")
        .returns<StoreReportSafeCloseoutRow[]>(),

      supabaseServer
        .from("stores")
        .select("id,name")
        .in("id", activeStoreIds)
        .returns<StoreReportStoreRow[]>(),
    ]);

    if (shiftsRes.error)    return NextResponse.json({ error: shiftsRes.error.message },    { status: 500 });
    if (salesRes.error)     return NextResponse.json({ error: salesRes.error.message },     { status: 500 });
    if (closeoutsRes.error) return NextResponse.json({ error: closeoutsRes.error.message }, { status: 500 });
    if (storesRes.error)    return NextResponse.json({ error: storesRes.error.message },    { status: 500 });

    // ── Analyze ───────────────────────────────────────────────────────────────
    const summaries = analyzeStoreData(
      shiftsRes.data  ?? [],
      salesRes.data   ?? [],
      closeoutsRes.data ?? [],
      storesRes.data  ?? [],
      from,
      to,
    );

    if (format === "text") {
      const text = formatStoreReport(summaries, from, to);
      return new NextResponse(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json({ summaries, from, to });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Store sales report failed." },
      { status: 500 }
    );
  }
}
