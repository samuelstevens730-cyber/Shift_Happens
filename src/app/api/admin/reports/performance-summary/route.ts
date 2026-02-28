/**
 * /api/admin/reports/performance-summary
 *
 * GET  — Run the sales performance analyzer for a date range and return
 *         structured summaries (JSON) or a plain-text report (format=text).
 *
 * Auth:  Bearer token, manager-scoped to their store(s).
 * Snapshot storage: performance_snapshots table (Supabase).
 */

import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  analyzeEmployeeSales,
  type RawShiftRow,
  type SalesRecordRow,
  type StoreRow,
  type ProfileRow,
  type EmployeePeriodSummary,
} from "@/lib/salesAnalyzer";
import { computePeriodDelta } from "@/lib/salesDelta";
import {
  formatPerformanceReport,
} from "@/lib/performanceReportFormatter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    // ── Auth ───────────────────────────────────────────────────────────────────
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "No stores in scope.", code: "no_stores" }, { status: 403 });
    }

    // ── Query params ───────────────────────────────────────────────────────────
    const url = new URL(req.url);
    const p = url.searchParams;

    // meta=true: return only stores + profiles for the manager's scope (for UI dropdowns).
    // No analyzer run, no date params required.
    if (p.get("meta") === "true") {
      const [storesRes, profilesRes] = await Promise.all([
        supabaseServer.from("stores").select("id,name").in("id", managerStoreIds).returns<StoreRow[]>(),
        supabaseServer.from("profiles").select("id,name").order("name").returns<ProfileRow[]>(),
      ]);
      return NextResponse.json({
        stores: storesRes.data ?? [],
        profiles: profilesRes.data ?? [],
      });
    }

    const defaultTo = cstDateKey(new Date());
    const defaultFrom = cstDateKey(addDays(new Date(), -13));
    const from = isDateOnly(p.get("from")) ? (p.get("from") as string) : defaultFrom;
    const to = isDateOnly(p.get("to")) ? (p.get("to") as string) : defaultTo;

    if (from > to) {
      return NextResponse.json({ error: "'from' must be on or before 'to'.", code: "invalid_range" }, { status: 400 });
    }

    const fromUtc = new Date(`${from}T00:00:00.000Z`);
    const toUtc = new Date(`${to}T00:00:00.000Z`);
    const periodDays = Math.floor((toUtc.getTime() - fromUtc.getTime()) / 86_400_000) + 1;
    const previousFrom = cstDateKey(addDays(fromUtc, -periodDays));
    const previousTo = cstDateKey(addDays(fromUtc, -1));

    const storeIdParam = p.get("storeId") ?? "all";
    if (storeIdParam !== "all" && !managerStoreIds.includes(storeIdParam)) {
      return NextResponse.json({ error: "Store not in scope.", code: "forbidden_store" }, { status: 403 });
    }
    const activeStoreIds =
      storeIdParam !== "all" ? [storeIdParam] : managerStoreIds;

    const employeeIdParam = p.get("employeeId") ?? null;
    const includeDelta = p.get("includeDelta") === "true";
    const saveSnapshot = p.get("saveSnapshot") === "true";
    const periodLabel = p.get("periodLabel") ?? null;
    const reportType = (["biweekly", "monthly", "quarterly", "custom"].includes(p.get("reportType") ?? "")
      ? p.get("reportType")
      : "biweekly") as "biweekly" | "monthly" | "quarterly" | "custom";
    const format = p.get("format") ?? "json";
    // "primary" = compact text (best/worst only); "full" = verbose with all breakdowns + shift detail
    const detail = p.get("detail") === "full" ? "full" : "primary";

    // benchmarkEmployeeIds: comma-separated UUIDs
    const benchmarkRaw = p.get("benchmarkEmployeeIds") ?? "";
    const benchmarkEmployeeIds = benchmarkRaw
      ? benchmarkRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    // goalBenchmarkCents: optional manager-entered achievable target (integer cents per shift)
    const goalBenchmarkCentsParam = p.get("goalBenchmarkCents");
    const goalBenchmarkCents =
      goalBenchmarkCentsParam != null && goalBenchmarkCentsParam !== ""
        ? Math.round(parseFloat(goalBenchmarkCentsParam))
        : null;

    type ShiftRowWithSchedule = RawShiftRow & { schedule_shift_id: string | null };

    // ── Data fetch ─────────────────────────────────────────────────────────────
    // Build shift query (optionally filtered to a single employee)
    let shiftsQuery = supabaseServer
      .from("shifts")
      .select("id,store_id,profile_id,shift_type,planned_start_at,started_at,ended_at,last_action,schedule_shift_id,start_weather_condition,start_weather_desc,start_temp_f,end_weather_condition,end_weather_desc,end_temp_f")
      .in("store_id", activeStoreIds)
      .gte("started_at", `${previousFrom}T00:00:00.000Z`)
      .lte("started_at", `${to}T23:59:59.999Z`)
      .neq("last_action", "removed");

    if (employeeIdParam) {
      shiftsQuery = shiftsQuery.eq("profile_id", employeeIdParam);
    }

    // We always need benchmark employees' shifts too (for benchmark avg computation)
    // but they're included automatically when no employeeId filter is set.
    // If an employeeId filter IS set, benchmark employees may differ — we'll handle
    // the benchmark-only case by doing a second fetch below if needed.
    const needBenchmarkFetch =
      employeeIdParam != null &&
      benchmarkEmployeeIds.length > 0 &&
      !benchmarkEmployeeIds.includes(employeeIdParam);

    const [shiftsRes, salesRes, storesRes, profilesRes] = await Promise.all([
      shiftsQuery.returns<ShiftRowWithSchedule[]>(),
      supabaseServer
        .from("daily_sales_records")
        .select(
          "id,store_id,business_date,open_shift_id,close_shift_id,open_x_report_cents,close_sales_cents,z_report_cents,rollover_from_previous_cents,closer_rollover_cents,is_rollover_night,open_transaction_count,close_transaction_count,mid_x_report_cents"
        )
        .in("store_id", activeStoreIds)
        .gte("business_date", previousFrom)
        .lte("business_date", to)
        .returns<SalesRecordRow[]>(),
      supabaseServer
        .from("stores")
        .select("id,name")
        .in("id", activeStoreIds)
        .returns<StoreRow[]>(),
      supabaseServer
        .from("profiles")
        .select("id,name")
        .returns<ProfileRow[]>(),
    ]);

    for (const result of [shiftsRes, salesRes, storesRes, profilesRes]) {
      if (result.error) {
        return NextResponse.json({ error: result.error.message, code: "db_error" }, { status: 500 });
      }
    }

    let allShifts: ShiftRowWithSchedule[] = shiftsRes.data ?? [];

    // Fetch benchmark-employee shifts separately if filtered to a single employee
    if (needBenchmarkFetch) {
      const benchmarkShiftsRes = await supabaseServer
        .from("shifts")
        .select("id,store_id,profile_id,shift_type,planned_start_at,started_at,ended_at,last_action,schedule_shift_id,start_weather_condition,start_weather_desc,start_temp_f,end_weather_condition,end_weather_desc,end_temp_f")
        .in("store_id", activeStoreIds)
        .in("profile_id", benchmarkEmployeeIds)
        .gte("started_at", `${previousFrom}T00:00:00.000Z`)
        .lte("started_at", `${to}T23:59:59.999Z`)
        .neq("last_action", "removed")
        .returns<ShiftRowWithSchedule[]>();

      if (!benchmarkShiftsRes.error) {
        allShifts = [...allShifts, ...(benchmarkShiftsRes.data ?? [])];
      }
    }


    const scheduledShiftIds = Array.from(
      new Set(allShifts.map((s) => s.schedule_shift_id).filter((v): v is string => Boolean(v)))
    );

    let effectiveShifts: RawShiftRow[] = allShifts.map((s) => ({
      id: s.id,
      store_id: s.store_id,
      profile_id: s.profile_id,
      shift_type: s.shift_type,
      planned_start_at: s.planned_start_at,
      started_at: s.started_at,
      ended_at: s.ended_at,
      last_action: s.last_action,
      start_weather_condition: s.start_weather_condition,
      start_weather_desc: s.start_weather_desc,
      start_temp_f: s.start_temp_f,
      end_weather_condition: s.end_weather_condition,
      end_weather_desc: s.end_weather_desc,
      end_temp_f: s.end_temp_f,
    }));

    if (scheduledShiftIds.length > 0) {
      const scheduledRes = await supabaseServer
        .from("schedule_shifts")
        .select("id,shift_type,shift_mode")
        .in("id", scheduledShiftIds)
        .returns<Array<{ id: string; shift_type: string | null; shift_mode: string | null }>>();

      if (!scheduledRes.error) {
        const isScheduledDoubleById = new Map<string, boolean>(
          (scheduledRes.data ?? []).map((row) => [
            row.id,
            row.shift_mode === "double" || row.shift_type === "double",
          ])
        );

        effectiveShifts = allShifts.map((s) => {
          const forceDouble =
            s.shift_type !== "double" &&
            s.schedule_shift_id != null &&
            isScheduledDoubleById.get(s.schedule_shift_id) === true;

          return {
            id: s.id,
            store_id: s.store_id,
            profile_id: s.profile_id,
            shift_type: forceDouble ? "double" : s.shift_type,
            planned_start_at: s.planned_start_at,
            started_at: s.started_at,
            ended_at: s.ended_at,
            last_action: s.last_action,
            start_weather_condition: s.start_weather_condition,
            start_weather_desc: s.start_weather_desc,
            start_temp_f: s.start_temp_f,
            end_weather_condition: s.end_weather_condition,
            end_weather_desc: s.end_weather_desc,
            end_temp_f: s.end_temp_f,
          };
        });
      }
    }

    // ── Run analyzer ───────────────────────────────────────────────────────────
    const allSalesRecords = salesRes.data ?? [];

    const shiftsCurrentPeriod = effectiveShifts.filter((shift) => {
      const businessDate = cstDateKey(new Date(shift.planned_start_at));
      return businessDate >= from && businessDate <= to;
    });
    const shiftsPreviousPeriod = effectiveShifts.filter((shift) => {
      const businessDate = cstDateKey(new Date(shift.planned_start_at));
      return businessDate >= previousFrom && businessDate <= previousTo;
    });

    const salesCurrentPeriod = allSalesRecords.filter(
      (record) => record.business_date >= from && record.business_date <= to
    );
    const salesPreviousPeriod = allSalesRecords.filter(
      (record) => record.business_date >= previousFrom && record.business_date <= previousTo
    );

    const { summaries, benchmarkCents, storeFactors } = analyzeEmployeeSales(
      shiftsCurrentPeriod,
      salesCurrentPeriod,
      storesRes.data ?? [],
      profilesRes.data ?? [],
      from,
      to,
      { benchmarkEmployeeIds: benchmarkEmployeeIds.length > 0 ? benchmarkEmployeeIds : undefined }
    );

    const { summaries: previousSummaries } = analyzeEmployeeSales(
      shiftsPreviousPeriod,
      salesPreviousPeriod,
      storesRes.data ?? [],
      profilesRes.data ?? [],
      previousFrom,
      previousTo,
      { benchmarkEmployeeIds: benchmarkEmployeeIds.length > 0 ? benchmarkEmployeeIds : undefined }
    );

    // If filtered to a single employee, drop benchmark employees from output
    const outputSummaries = employeeIdParam
      ? summaries.filter((s) => s.employeeId === employeeIdParam)
      : summaries;

    if (outputSummaries.length === 0 && effectiveShifts.length === 0) {
      return NextResponse.json(
        { error: "No shifts found for the selected range and filters.", code: "no_data" },
        { status: 404 }
      );
    }

    // ── Delta computation ──────────────────────────────────────────────────────
    let deltas: ReturnType<typeof computePeriodDelta>[] | undefined;

    if (includeDelta && outputSummaries.length > 0) {
      const previousByEmployee = new Map(previousSummaries.map((s) => [s.employeeId, s]));
      deltas = [];
      for (const current of outputSummaries) {
        const previous = previousByEmployee.get(current.employeeId);
        if (previous) {
          deltas.push(computePeriodDelta(current, previous));
        }
      }
    }

    if (saveSnapshot && outputSummaries.length > 0) {
      const storeIdForSnapshot = storeIdParam !== "all" ? storeIdParam : null;
      const snapshotRows = outputSummaries.map((s) => ({
        employee_id: s.employeeId,
        store_id: storeIdForSnapshot,
        period_from: from,
        period_to: to,
        period_label: periodLabel,
        report_type: reportType,
        snapshot: s as unknown as Record<string, unknown>,
        created_by: user.id,
      }));

      // ON CONFLICT DO NOTHING — never overwrite existing snapshots
      await supabaseServer
        .from("performance_snapshots")
        .upsert(snapshotRows, { onConflict: "employee_id,period_from,period_to", ignoreDuplicates: true });
    }

    // ── Response ───────────────────────────────────────────────────────────────

    // Plain-text format for AI pasting
    if (format === "text") {
      const deltaMap = new Map(
        (deltas ?? []).map((d) => [d.employeeId, d])
      );
      const text = formatPerformanceReport(outputSummaries, deltaMap, benchmarkCents, {
        verbose: detail === "full",
        includeShiftDetail: detail === "full",
        goalBenchmarkCents: goalBenchmarkCents ?? undefined,
      });
      return new Response(text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // JSON response
    return NextResponse.json({
      period: {
        from,
        to,
        label: periodLabel ?? undefined,
        reportType,
      },
      benchmark: benchmarkCents,
      storeFactors: Object.fromEntries(storeFactors),
      stores: storesRes.data ?? [],   // convenient for UI store-filter dropdown
      employees: outputSummaries,
      deltas: deltas ?? undefined,
      snapshotSaved: saveSnapshot,
    });
  } catch (e: unknown) {
    console.error("[performance-summary] Unexpected error:", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Failed to generate performance report.",
        code: "internal_error",
      },
      { status: 500 }
    );
  }
}
