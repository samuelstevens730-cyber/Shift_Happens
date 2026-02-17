import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type {
  DashboardActionCategory,
  DashboardActionItem,
  DashboardResponse,
  DashboardSalesPoint,
  DashboardStoreHealth,
  DashboardToplineByStore,
} from "@/types/adminDashboard";

type RequestStatus = "open" | "pending";

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
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function clampScore(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function gradeForScore(score: number): "A" | "B" | "C" | "D" {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
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
      const empty: DashboardResponse = {
        stores: [],
        topline: {},
        openShifts: 0,
        pendingApprovals: 0,
        actions: { people: [], money: [], scheduling: [], approvals: [] },
        actionCounts: { people: 0, money: 0, scheduling: 0, approvals: 0 },
        salesHistory: {},
        health: {},
      };
      return NextResponse.json(empty);
    }

    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    if (storeId && storeId !== "all" && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store filter." }, { status: 403 });
    }

    const todayCst = cstDateKey(new Date());
    const defaultFrom = cstDateKey(addDays(new Date(), -6));
    const from = isDateOnly(fromParam) ? fromParam : defaultFrom;
    const to = isDateOnly(toParam) ? toParam : todayCst;
    const activeStoreIds = storeId && storeId !== "all" ? [storeId] : managerStoreIds;
    const yesterday = cstDateKey(addDays(new Date(), -1));

    const [storesRes, yesterdayCloseoutsRes, salesRes, openShiftsRes, swapCountRes, timeOffCountRes, timesheetCountRes] =
      await Promise.all([
        supabaseServer
          .from("stores")
          .select("id,name")
          .in("id", activeStoreIds)
          .order("name", { ascending: true })
          .returns<Array<{ id: string; name: string }>>(),
        supabaseServer
          .from("safe_closeouts")
          .select("store_id,cash_sales_cents,card_sales_cents,other_sales_cents,status,variance_cents")
          .in("store_id", activeStoreIds)
          .eq("business_date", yesterday)
          .returns<
            Array<{
              store_id: string;
              cash_sales_cents: number;
              card_sales_cents: number;
              other_sales_cents: number;
              status: string;
              variance_cents: number;
            }>
          >(),
        supabaseServer
          .from("safe_closeouts")
          .select("store_id,business_date,cash_sales_cents,card_sales_cents,other_sales_cents,status")
          .in("store_id", activeStoreIds)
          .gte("business_date", from)
          .lte("business_date", to)
          .order("business_date", { ascending: true })
          .returns<
            Array<{
              store_id: string;
              business_date: string;
              cash_sales_cents: number;
              card_sales_cents: number;
              other_sales_cents: number;
              status: string;
            }>
          >(),
        supabaseServer
          .from("shifts")
          .select("id", { count: "exact", head: true })
          .in("store_id", activeStoreIds)
          .is("ended_at", null)
          .not("started_at", "is", null),
        supabaseServer
          .from("shift_swap_requests")
          .select("id", { count: "exact", head: true })
          .in("store_id", activeStoreIds)
          .in("status", ["open", "pending"] as RequestStatus[]),
        supabaseServer
          .from("time_off_requests")
          .select("id", { count: "exact", head: true })
          .in("store_id", activeStoreIds)
          .in("status", ["open", "pending"] as RequestStatus[]),
        supabaseServer
          .from("timesheet_change_requests")
          .select("id", { count: "exact", head: true })
          .in("store_id", activeStoreIds)
          .in("status", ["open", "pending"] as RequestStatus[]),
      ]);

    if (storesRes.error) return NextResponse.json({ error: storesRes.error.message }, { status: 500 });
    if (yesterdayCloseoutsRes.error) return NextResponse.json({ error: yesterdayCloseoutsRes.error.message }, { status: 500 });
    if (salesRes.error) return NextResponse.json({ error: salesRes.error.message }, { status: 500 });
    if (openShiftsRes.error) return NextResponse.json({ error: openShiftsRes.error.message }, { status: 500 });
    if (swapCountRes.error) return NextResponse.json({ error: swapCountRes.error.message }, { status: 500 });
    if (timeOffCountRes.error) return NextResponse.json({ error: timeOffCountRes.error.message }, { status: 500 });
    if (timesheetCountRes.error) return NextResponse.json({ error: timesheetCountRes.error.message }, { status: 500 });

    const topline: DashboardToplineByStore = {};
    for (const store of storesRes.data ?? []) {
      topline[store.id] = {
        totalSales: 0,
        cashSales: 0,
        cardSales: 0,
        otherSales: 0,
        closeoutStatus: null,
        closeoutVariance: 0,
      };
    }
    for (const row of yesterdayCloseoutsRes.data ?? []) {
      const existing = topline[row.store_id] ?? {
        totalSales: 0,
        cashSales: 0,
        cardSales: 0,
        otherSales: 0,
        closeoutStatus: null,
        closeoutVariance: 0,
      };
      topline[row.store_id] = {
        // Command Center sales should not include shift changeover X-report carry values.
        totalSales: existing.totalSales + (row.cash_sales_cents + row.card_sales_cents),
        cashSales: existing.cashSales + row.cash_sales_cents,
        cardSales: existing.cardSales + row.card_sales_cents,
        otherSales: existing.otherSales + row.other_sales_cents,
        closeoutStatus: row.status,
        closeoutVariance: row.variance_cents,
      };
    }

    const salesHistory: Record<string, DashboardSalesPoint[]> = {};
    for (const store of storesRes.data ?? []) salesHistory[store.id] = [];
    for (const row of salesRes.data ?? []) {
      salesHistory[row.store_id] = salesHistory[row.store_id] ?? [];
      salesHistory[row.store_id].push({
        date: row.business_date,
        cash: row.cash_sales_cents,
        card: row.card_sales_cents,
        other: row.other_sales_cents,
        // Keep "other" field available for diagnostics, but do not include in sales totals.
        total: row.cash_sales_cents + row.card_sales_cents,
        status: row.status,
      });
    }

    const nowIso = new Date().toISOString();
    const staleShiftCutoffIso = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const rangeFromIso = toIso(from);
    const rangeToIso = `${to}T23:59:59.999Z`;

    const [
      peopleRowsRes,
      peopleCountRes,
      moneyRowsRes,
      moneyCountRes,
      schedulingRowsRes,
      schedulingCountRes,
      swapRowsRes,
      timeOffRowsRes,
      timesheetRowsRes,
      swapPendingCountRes,
      timeOffPendingCountRes,
      timesheetPendingCountRes,
    ] = await Promise.all([
      supabaseServer
        .from("shifts")
        .select("id,store_id,started_at")
        .in("store_id", activeStoreIds)
        .eq("requires_override", true)
        .is("override_at", null)
        .is("ended_at", null)
        .order("started_at", { ascending: true })
        .limit(3)
        .returns<Array<{ id: string; store_id: string; started_at: string | null }>>(),
      supabaseServer
        .from("shifts")
        .select("id", { count: "exact", head: true })
        .in("store_id", activeStoreIds)
        .eq("requires_override", true)
        .is("override_at", null)
        .is("ended_at", null),
      supabaseServer
        .from("safe_closeouts")
        .select("id,store_id,business_date,status")
        .in("store_id", activeStoreIds)
        .is("reviewed_at", null)
        .or("requires_manager_review.eq.true,status.eq.warn,status.eq.fail")
        .order("business_date", { ascending: false })
        .limit(3)
        .returns<Array<{ id: string; store_id: string; business_date: string; status: string }>>(),
      supabaseServer
        .from("safe_closeouts")
        .select("id", { count: "exact", head: true })
        .in("store_id", activeStoreIds)
        .is("reviewed_at", null)
        .or("requires_manager_review.eq.true,status.eq.warn,status.eq.fail"),
      supabaseServer
        .from("shifts")
        .select("id,store_id,started_at")
        .in("store_id", activeStoreIds)
        .not("started_at", "is", null)
        .is("schedule_shift_id", null)
        .gte("started_at", rangeFromIso)
        .lte("started_at", rangeToIso)
        .order("started_at", { ascending: false })
        .limit(3)
        .returns<Array<{ id: string; store_id: string; started_at: string | null }>>(),
      supabaseServer
        .from("shifts")
        .select("id", { count: "exact", head: true })
        .in("store_id", activeStoreIds)
        .not("started_at", "is", null)
        .is("schedule_shift_id", null)
        .gte("started_at", rangeFromIso)
        .lte("started_at", rangeToIso),
      supabaseServer
        .from("shift_swap_requests")
        .select("id,store_id,created_at,status")
        .in("store_id", activeStoreIds)
        .in("status", ["open", "pending"] as RequestStatus[])
        .order("created_at", { ascending: true })
        .limit(3)
        .returns<Array<{ id: string; store_id: string; created_at: string; status: string }>>(),
      supabaseServer
        .from("time_off_requests")
        .select("id,store_id,created_at,status")
        .in("store_id", activeStoreIds)
        .in("status", ["open", "pending"] as RequestStatus[])
        .order("created_at", { ascending: true })
        .limit(3)
        .returns<Array<{ id: string; store_id: string; created_at: string; status: string }>>(),
      supabaseServer
        .from("timesheet_change_requests")
        .select("id,store_id,created_at,status")
        .in("store_id", activeStoreIds)
        .in("status", ["open", "pending"] as RequestStatus[])
        .order("created_at", { ascending: true })
        .limit(3)
        .returns<Array<{ id: string; store_id: string; created_at: string; status: string }>>(),
      supabaseServer
        .from("shift_swap_requests")
        .select("id", { count: "exact", head: true })
        .in("store_id", activeStoreIds)
        .in("status", ["open", "pending"] as RequestStatus[]),
      supabaseServer
        .from("time_off_requests")
        .select("id", { count: "exact", head: true })
        .in("store_id", activeStoreIds)
        .in("status", ["open", "pending"] as RequestStatus[]),
      supabaseServer
        .from("timesheet_change_requests")
        .select("id", { count: "exact", head: true })
        .in("store_id", activeStoreIds)
        .in("status", ["open", "pending"] as RequestStatus[]),
    ]);

    for (const r of [
      peopleRowsRes,
      peopleCountRes,
      moneyRowsRes,
      moneyCountRes,
      schedulingRowsRes,
      schedulingCountRes,
      swapRowsRes,
      timeOffRowsRes,
      timesheetRowsRes,
      swapPendingCountRes,
      timeOffPendingCountRes,
      timesheetPendingCountRes,
    ]) {
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    }

    const peopleActions: DashboardActionItem[] = (peopleRowsRes.data ?? []).map((row) => ({
      id: `people-${row.id}`,
      category: "people",
      severity: row.started_at && row.started_at < staleShiftCutoffIso ? "high" : "medium",
      title: "Open shift requires override review",
      description: row.started_at ? `Started ${row.started_at}` : "Started time missing",
      store_id: row.store_id,
      created_at: row.started_at,
    }));

    const moneyActions: DashboardActionItem[] = (moneyRowsRes.data ?? []).map((row) => ({
      id: `money-${row.id}`,
      category: "money",
      severity: row.status === "fail" ? "high" : "medium",
      title: row.status === "fail" ? "Failed safe closeout review" : "Safe closeout needs review",
      description: `Business date ${row.business_date}`,
      store_id: row.store_id,
      created_at: row.business_date,
    }));

    const schedulingActions: DashboardActionItem[] = (schedulingRowsRes.data ?? []).map((row) => ({
      id: `scheduling-${row.id}`,
      category: "scheduling",
      severity: "medium",
      title: "Unscheduled worked shift",
      description: row.started_at ? `Started ${row.started_at}` : "Started time missing",
      store_id: row.store_id,
      created_at: row.started_at,
    }));

    const approvalActions: DashboardActionItem[] = [
      ...(swapRowsRes.data ?? []).map((row) => ({
        id: `approval-swap-${row.id}`,
        category: "approvals" as DashboardActionCategory,
        severity: "medium" as const,
        title: "Pending shift swap request",
        description: `Status: ${row.status}`,
        store_id: row.store_id,
        created_at: row.created_at,
      })),
      ...(timeOffRowsRes.data ?? []).map((row) => ({
        id: `approval-timeoff-${row.id}`,
        category: "approvals" as DashboardActionCategory,
        severity: "medium" as const,
        title: "Pending time off request",
        description: `Status: ${row.status}`,
        store_id: row.store_id,
        created_at: row.created_at,
      })),
      ...(timesheetRowsRes.data ?? []).map((row) => ({
        id: `approval-timesheet-${row.id}`,
        category: "approvals" as DashboardActionCategory,
        severity: "medium" as const,
        title: "Pending timesheet correction",
        description: `Status: ${row.status}`,
        store_id: row.store_id,
        created_at: row.created_at,
      })),
    ]
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
      .slice(0, 3);

    const actions: DashboardResponse["actions"] = {
      people: peopleActions,
      money: moneyActions,
      scheduling: schedulingActions,
      approvals: approvalActions,
    };

    const actionCounts: DashboardResponse["actionCounts"] = {
      people: peopleCountRes.count ?? 0,
      money: moneyCountRes.count ?? 0,
      scheduling: schedulingCountRes.count ?? 0,
      approvals:
        (swapPendingCountRes.count ?? 0) + (timeOffPendingCountRes.count ?? 0) + (timesheetPendingCountRes.count ?? 0),
    };

    const health: Record<string, DashboardStoreHealth> = {};

    for (const store of storesRes.data ?? []) {
      const sid = store.id;
      const [
        unapprovedLongRes,
        staleShiftsRes,
        manualCloseRes,
        drawerAllRes,
        drawerOutRes,
        closeoutAllRes,
        closeoutBadRes,
        backlogSwapRes,
        backlogTimeOffRes,
        backlogTimesheetRes,
        scheduledRes,
        startedScheduledRes,
        cleaningRes,
      ] = await Promise.all([
        supabaseServer
          .from("shifts")
          .select("id", { count: "exact", head: true })
          .eq("store_id", sid)
          .eq("requires_override", true)
          .is("override_at", null)
          .is("ended_at", null),
        supabaseServer
          .from("shifts")
          .select("id", { count: "exact", head: true })
          .eq("store_id", sid)
          .is("ended_at", null)
          .lt("started_at", staleShiftCutoffIso),
        supabaseServer
          .from("shifts")
          .select("id", { count: "exact", head: true })
          .eq("store_id", sid)
          .eq("manual_closed", true)
          .is("manual_closed_review_status", null),
        supabaseServer
          .from("shift_drawer_counts")
          .select("id,shifts!inner(store_id)")
          .eq("shifts.store_id", sid)
          .gte("counted_at", rangeFromIso)
          .lte("counted_at", rangeToIso)
          .returns<Array<{ id: string }>>(),
        supabaseServer
          .from("shift_drawer_counts")
          .select("id,shifts!inner(store_id)")
          .eq("shifts.store_id", sid)
          .eq("out_of_threshold", true)
          .gte("counted_at", rangeFromIso)
          .lte("counted_at", rangeToIso)
          .returns<Array<{ id: string }>>(),
        supabaseServer
          .from("safe_closeouts")
          .select("id")
          .eq("store_id", sid)
          .gte("business_date", from)
          .lte("business_date", to)
          .returns<Array<{ id: string }>>(),
        supabaseServer
          .from("safe_closeouts")
          .select("id")
          .eq("store_id", sid)
          .gte("business_date", from)
          .lte("business_date", to)
          .in("status", ["warn", "fail"])
          .returns<Array<{ id: string }>>(),
        supabaseServer
          .from("shift_swap_requests")
          .select("created_at")
          .eq("store_id", sid)
          .in("status", ["open", "pending"] as RequestStatus[])
          .order("created_at", { ascending: true })
          .limit(1)
          .returns<Array<{ created_at: string }>>(),
        supabaseServer
          .from("time_off_requests")
          .select("created_at")
          .eq("store_id", sid)
          .in("status", ["open", "pending"] as RequestStatus[])
          .order("created_at", { ascending: true })
          .limit(1)
          .returns<Array<{ created_at: string }>>(),
        supabaseServer
          .from("timesheet_change_requests")
          .select("created_at")
          .eq("store_id", sid)
          .in("status", ["open", "pending"] as RequestStatus[])
          .order("created_at", { ascending: true })
          .limit(1)
          .returns<Array<{ created_at: string }>>(),
        supabaseServer
          .from("schedule_shifts")
          .select("id,schedule:schedule_id(status)")
          .eq("store_id", sid)
          .gte("shift_date", from)
          .lte("shift_date", to)
          .returns<Array<{ id: string; schedule: { status: string } | null }>>(),
        supabaseServer
          .from("shifts")
          .select("schedule_shift_id")
          .eq("store_id", sid)
          .not("schedule_shift_id", "is", null)
          .not("started_at", "is", null)
          .gte("started_at", rangeFromIso)
          .lte("started_at", rangeToIso)
          .returns<Array<{ schedule_shift_id: string }>>(),
        supabaseServer
          .from("cleaning_task_completions")
          .select("status,shifts!inner(store_id)")
          .eq("shifts.store_id", sid)
          .gte("completed_at", rangeFromIso)
          .lte("completed_at", rangeToIso)
          .returns<Array<{ status: "completed" | "skipped" }>>(),
      ]);

      for (const r of [
        unapprovedLongRes,
        staleShiftsRes,
        manualCloseRes,
        drawerAllRes,
        drawerOutRes,
        closeoutAllRes,
        closeoutBadRes,
        backlogSwapRes,
        backlogTimeOffRes,
        backlogTimesheetRes,
        scheduledRes,
        startedScheduledRes,
        cleaningRes,
      ]) {
        if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
      }

      const unapprovedLong = unapprovedLongRes.count ?? 0;
      const staleShifts = staleShiftsRes.count ?? 0;
      const manualUnreviewed = manualCloseRes.count ?? 0;

      const drawerTotal = drawerAllRes.data?.length ?? 0;
      const drawerOut = drawerOutRes.data?.length ?? 0;
      const drawerRate = drawerTotal > 0 ? drawerOut / drawerTotal : 0;

      const closeoutTotal = closeoutAllRes.data?.length ?? 0;
      const closeoutBad = closeoutBadRes.data?.length ?? 0;
      const closeoutRate = closeoutTotal > 0 ? closeoutBad / closeoutTotal : 0;

      const oldestBacklog = [backlogSwapRes.data?.[0]?.created_at, backlogTimeOffRes.data?.[0]?.created_at, backlogTimesheetRes.data?.[0]?.created_at]
        .filter((value): value is string => Boolean(value))
        .sort()[0];
      const backlogAgeHours = oldestBacklog
        ? Math.max(0, (Date.parse(nowIso) - Date.parse(oldestBacklog)) / (1000 * 60 * 60))
        : 0;

      const publishedSchedules = (scheduledRes.data ?? []).filter((row) => row.schedule?.status === "published");
      const publishedScheduledIds = new Set(publishedSchedules.map((row) => row.id));
      const startedScheduledIds = new Set(
        (startedScheduledRes.data ?? []).map((row) => row.schedule_shift_id).filter((value): value is string => Boolean(value))
      );
      let noShowRate = 0;
      let includeNoShowSignal = false;
      if (publishedScheduledIds.size > 0) {
        includeNoShowSignal = true;
        let noShows = 0;
        for (const id of publishedScheduledIds) {
          if (!startedScheduledIds.has(id)) noShows += 1;
        }
        noShowRate = noShows / publishedScheduledIds.size;
      }

      const cleaningRows = cleaningRes.data ?? [];
      const cleaningTotal = cleaningRows.length;
      const cleaningCompleted = cleaningRows.filter((row) => row.status === "completed").length;
      const cleaningRate = cleaningTotal > 0 ? cleaningCompleted / cleaningTotal : 1;

      const signals = [
        { name: "Unapproved long shifts", maxScore: 15, score: clampScore(15 - unapprovedLong * 5, 15) },
        { name: "Stale shifts >13h", maxScore: 10, score: staleShifts > 0 ? 0 : 10 },
        { name: "Manual closes unreviewed", maxScore: 10, score: clampScore(10 - manualUnreviewed * 3, 10) },
        { name: "Drawer variance rate", maxScore: 15, score: clampScore(Math.round(15 * (1 - drawerRate)), 15) },
        { name: "Safe closeout variance rate", maxScore: 15, score: clampScore(Math.round(15 * (1 - closeoutRate)), 15) },
        {
          name: "Approval backlog age",
          maxScore: 15,
          score: backlogAgeHours === 0 ? 15 : backlogAgeHours < 24 ? 15 : backlogAgeHours < 48 ? 10 : backlogAgeHours < 72 ? 5 : 0,
        },
        ...(includeNoShowSignal
          ? [{ name: "No-show rate", maxScore: 10, score: clampScore(Math.round(10 * (1 - noShowRate)), 10) }]
          : []),
        { name: "Cleaning compliance", maxScore: 10, score: clampScore(Math.round(10 * cleaningRate), 10) },
      ];

      const score = signals.reduce((sum, signal) => sum + signal.score, 0);
      const normalizedMax = signals.reduce((sum, signal) => sum + signal.maxScore, 0);
      const normalizedScore = normalizedMax > 0 ? Math.round((score / normalizedMax) * 100) : 100;

      health[sid] = {
        score: normalizedScore,
        grade: gradeForScore(normalizedScore),
        signals: signals.sort((a, b) => a.score - b.score).slice(0, 3),
      };
    }

    const response: DashboardResponse = {
      stores: storesRes.data ?? [],
      topline,
      openShifts: openShiftsRes.count ?? 0,
      pendingApprovals: (swapCountRes.count ?? 0) + (timeOffCountRes.count ?? 0) + (timesheetCountRes.count ?? 0),
      actions,
      actionCounts,
      salesHistory,
      health,
    };

    return NextResponse.json(response);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load dashboard stats." },
      { status: 500 }
    );
  }
}
