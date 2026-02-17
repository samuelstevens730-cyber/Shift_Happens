import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type {
  EmployeeScoreCategory,
  EmployeeScoreRow,
  EmployeeScoreboardResponse,
} from "@/types/employeeScore";

const MIN_SHIFTS_FOR_RANKING = 8;

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function gradeForScore(score: number): "A" | "B" | "C" | "D" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  return "D";
}

function percentile(value: number, population: number[]): number {
  if (population.length === 0) return 0;
  if (population.length === 1) return 1;
  const sorted = [...population].sort((a, b) => a - b);
  let countLE = 0;
  for (const v of sorted) {
    if (v <= value) countLE += 1;
  }
  return clamp((countLE - 1) / (sorted.length - 1), 0, 1);
}

function cstMinutesOfDay(iso: string): number | null {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function parseTimeToMinutes(timeValue: string): number | null {
  const parts = timeValue.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function businessDateFromIso(iso: string): string {
  return cstDateKey(new Date(iso));
}

type EmployeeStats = {
  profileId: string;
  employeeName: string | null;
  shiftsWorked: number;
  rawSalesValues: number[];
  adjustedSalesValues: number[];
  attendanceScheduled: number;
  attendanceWorked: number;
  lateMinutes: number[];
  drawerAbsDelta: number[];
  closeoutAbsVariance: number[];
  cleaningCompleted: number;
  cleaningSkipped: number;
};

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
      const empty: EmployeeScoreboardResponse = {
        stores: [],
        rows: [],
        from: "",
        to: "",
        minShiftsForRanking: MIN_SHIFTS_FOR_RANKING,
      };
      return NextResponse.json(empty);
    }

    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId");
    if (storeId && storeId !== "all" && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store filter." }, { status: 403 });
    }
    const activeStoreIds = storeId && storeId !== "all" ? [storeId] : managerStoreIds;

    const defaultTo = cstDateKey(new Date());
    const defaultFrom = cstDateKey(addDays(new Date(), -29));
    const from = isDateOnly(url.searchParams.get("from")) ? (url.searchParams.get("from") as string) : defaultFrom;
    const to = isDateOnly(url.searchParams.get("to")) ? (url.searchParams.get("to") as string) : defaultTo;

    const [storesRes, shiftsRes, salesRes, drawerCountsRes, closeoutsRes, cleaningRes, schedulesRes, scheduledShiftsRes, profilesRes] =
      await Promise.all([
        supabaseServer
          .from("stores")
          .select("id,name,expected_drawer_cents")
          .in("id", activeStoreIds)
          .returns<Array<{ id: string; name: string; expected_drawer_cents: number }>>(),
        supabaseServer
          .from("shifts")
          .select("id,store_id,profile_id,shift_type,planned_start_at,started_at,ended_at,schedule_shift_id,last_action")
          .in("store_id", activeStoreIds)
          .gte("started_at", `${from}T00:00:00.000Z`)
          .lte("started_at", `${to}T23:59:59.999Z`)
          .neq("last_action", "removed")
          .returns<
            Array<{
              id: string;
              store_id: string;
              profile_id: string;
              shift_type: "open" | "close" | "double" | "other";
              planned_start_at: string;
              started_at: string;
              ended_at: string | null;
              schedule_shift_id: string | null;
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
          .from("shift_drawer_counts")
          .select("shift_id,count_type,drawer_cents")
          .in("count_type", ["start", "end"])
          .returns<Array<{ shift_id: string; count_type: "start" | "end"; drawer_cents: number }>>(),
        supabaseServer
          .from("safe_closeouts")
          .select("shift_id,profile_id,variance_cents")
          .in("store_id", activeStoreIds)
          .gte("business_date", from)
          .lte("business_date", to)
          .returns<Array<{ shift_id: string | null; profile_id: string; variance_cents: number }>>(),
        supabaseServer
          .from("cleaning_task_completions")
          .select("completed_by,status,completed_at,shift:shift_id(store_id)")
          .gte("completed_at", `${from}T00:00:00.000Z`)
          .lte("completed_at", `${to}T23:59:59.999Z`)
          .returns<
            Array<{
              completed_by: string;
              status: "completed" | "skipped";
              completed_at: string;
              shift: { store_id: string } | null;
            }>
          >(),
        supabaseServer
          .from("schedules")
          .select("id,status")
          .returns<Array<{ id: string; status: string }>>(),
        supabaseServer
          .from("schedule_shifts")
          .select("id,schedule_id,store_id,profile_id,shift_date,scheduled_start")
          .in("store_id", activeStoreIds)
          .gte("shift_date", from)
          .lte("shift_date", to)
          .returns<
            Array<{
              id: string;
              schedule_id: string;
              store_id: string;
              profile_id: string;
              shift_date: string;
              scheduled_start: string;
            }>
          >(),
        supabaseServer.from("profiles").select("id,name").returns<Array<{ id: string; name: string | null }>>(),
      ]);

    for (const result of [
      storesRes,
      shiftsRes,
      salesRes,
      drawerCountsRes,
      closeoutsRes,
      cleaningRes,
      schedulesRes,
      scheduledShiftsRes,
      profilesRes,
    ]) {
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    const profileNameById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.name]));
    const expectedDrawerByStoreId = new Map(
      (storesRes.data ?? []).map((s) => [s.id, s.expected_drawer_cents])
    );

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

    const rawShiftSalesRows = (shiftsRes.data ?? []).map((shift) => {
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
      if (shift.shift_type === "open") {
        if (openX != null) salesCents = openX - beginningX;
      } else if (shift.shift_type === "close" || shift.shift_type === "double") {
        const baseClose = closeSales ?? (zReport != null && priorX != null ? zReport - priorX : null);
        if (baseClose != null) {
          salesCents = baseClose + (isRolloverNight ? midnightX ?? 0 : 0);
        }
      }
      return {
        shiftId: shift.id,
        profileId: shift.profile_id,
        storeId: shift.store_id,
        shiftType: shift.shift_type,
        startedAt: shift.started_at,
        scheduleShiftId: shift.schedule_shift_id,
        salesCents,
      };
    });

    const storeSalesTotals = new Map<string, number>();
    for (const row of rawShiftSalesRows) {
      if (row.salesCents == null) continue;
      storeSalesTotals.set(row.storeId, (storeSalesTotals.get(row.storeId) ?? 0) + row.salesCents);
    }
    const storeSalesValues = Array.from(storeSalesTotals.values()).filter((v) => v > 0);
    const networkAvgStoreSales =
      storeSalesValues.length > 0
        ? storeSalesValues.reduce((sum, v) => sum + v, 0) / storeSalesValues.length
        : 0;
    const storeFactor = new Map<string, number>();
    for (const sid of activeStoreIds) {
      const total = storeSalesTotals.get(sid) ?? 0;
      storeFactor.set(sid, total > 0 && networkAvgStoreSales > 0 ? networkAvgStoreSales / total : 1);
    }

    const statsByEmployee = new Map<string, EmployeeStats>();
    function ensureStats(profileId: string): EmployeeStats {
      const existing = statsByEmployee.get(profileId);
      if (existing) return existing;
      const created: EmployeeStats = {
        profileId,
        employeeName: profileNameById.get(profileId) ?? null,
        shiftsWorked: 0,
        rawSalesValues: [],
        adjustedSalesValues: [],
        attendanceScheduled: 0,
        attendanceWorked: 0,
        lateMinutes: [],
        drawerAbsDelta: [],
        closeoutAbsVariance: [],
        cleaningCompleted: 0,
        cleaningSkipped: 0,
      };
      statsByEmployee.set(profileId, created);
      return created;
    }

    // Base shift count + sales values.
    for (const row of rawShiftSalesRows) {
      const stats = ensureStats(row.profileId);
      stats.shiftsWorked += 1;
      if (row.salesCents != null) {
        stats.rawSalesValues.push(row.salesCents);
        stats.adjustedSalesValues.push(Math.round(row.salesCents * (storeFactor.get(row.storeId) ?? 1)));
      }
    }

    // Drawer start->end delta.
    const countsByShiftId = new Map<string, { start: number | null; end: number | null }>();
    for (const row of drawerCountsRes.data ?? []) {
      const cur = countsByShiftId.get(row.shift_id) ?? { start: null, end: null };
      if (row.count_type === "start") cur.start = row.drawer_cents;
      if (row.count_type === "end") cur.end = row.drawer_cents;
      countsByShiftId.set(row.shift_id, cur);
    }
    const shiftById = new Map((rawShiftSalesRows ?? []).map((row) => [row.shiftId, row]));
    for (const [shiftId, count] of countsByShiftId.entries()) {
      if (count.start == null || count.end == null) continue;
      const shift = shiftById.get(shiftId);
      if (!shift) continue;
      const stats = ensureStats(shift.profileId);
      stats.drawerAbsDelta.push(Math.abs(count.end - count.start));
    }

    // Safe closeout variance.
    for (const row of closeoutsRes.data ?? []) {
      const profileId =
        row.shift_id && shiftById.get(row.shift_id)?.profileId
          ? (shiftById.get(row.shift_id)?.profileId as string)
          : row.profile_id;
      const stats = ensureStats(profileId);
      stats.closeoutAbsVariance.push(Math.abs(row.variance_cents ?? 0));
    }

    // Cleaning task completion.
    for (const row of cleaningRes.data ?? []) {
      if (!row.shift || !activeStoreIds.includes(row.shift.store_id)) continue;
      const stats = ensureStats(row.completed_by);
      if (row.status === "completed") stats.cleaningCompleted += 1;
      if (row.status === "skipped") stats.cleaningSkipped += 1;
    }

    // Attendance and punctuality from published schedules.
    const publishedScheduleIds = new Set(
      (schedulesRes.data ?? []).filter((s) => s.status === "published").map((s) => s.id)
    );
    const publishedScheduled = (scheduledShiftsRes.data ?? []).filter((s) =>
      publishedScheduleIds.has(s.schedule_id)
    );
    const workedByScheduleShiftId = new Map<
      string,
      { profileId: string; startedAt: string; storeId: string }
    >();
    for (const shift of rawShiftSalesRows) {
      if (!shift.scheduleShiftId) continue;
      workedByScheduleShiftId.set(shift.scheduleShiftId, {
        profileId: shift.profileId,
        startedAt: shift.startedAt,
        storeId: shift.storeId,
      });
    }
    for (const scheduleShift of publishedScheduled) {
      const stats = ensureStats(scheduleShift.profile_id);
      stats.attendanceScheduled += 1;
      const worked = workedByScheduleShiftId.get(scheduleShift.id);
      if (worked) {
        stats.attendanceWorked += 1;
        const actualMin = cstMinutesOfDay(worked.startedAt);
        const scheduledMin = parseTimeToMinutes(scheduleShift.scheduled_start);
        if (actualMin != null && scheduledMin != null) {
          stats.lateMinutes.push(Math.max(0, actualMin - scheduledMin));
        }
      }
    }

    const rawSalesPopulation = Array.from(statsByEmployee.values())
      .map((s) =>
        s.rawSalesValues.length > 0
          ? s.rawSalesValues.reduce((sum, v) => sum + v, 0) / s.rawSalesValues.length
          : null
      )
      .filter((v): v is number => v != null);
    const adjustedSalesPopulation = Array.from(statsByEmployee.values())
      .map((s) =>
        s.adjustedSalesValues.length > 0
          ? s.adjustedSalesValues.reduce((sum, v) => sum + v, 0) / s.adjustedSalesValues.length
          : null
      )
      .filter((v): v is number => v != null);

    function category(
      key: EmployeeScoreCategory["key"],
      label: string,
      maxPoints: number,
      points: number | null,
      detail: string
    ): EmployeeScoreCategory {
      return { key, label, maxPoints, points: points == null ? null : round(points), available: points != null, detail };
    }

    const rows: EmployeeScoreRow[] = Array.from(statsByEmployee.values()).map((stats) => {
      const rawAvg =
        stats.rawSalesValues.length > 0
          ? stats.rawSalesValues.reduce((sum, v) => sum + v, 0) / stats.rawSalesValues.length
          : null;
      const adjustedAvg =
        stats.adjustedSalesValues.length > 0
          ? stats.adjustedSalesValues.reduce((sum, v) => sum + v, 0) / stats.adjustedSalesValues.length
          : null;

      const salesRawPoints =
        rawAvg == null ? null : 15 * percentile(rawAvg, rawSalesPopulation);
      const salesAdjustedPoints =
        adjustedAvg == null ? null : 15 * percentile(adjustedAvg, adjustedSalesPopulation);

      const attendanceRate =
        stats.attendanceScheduled > 0 ? stats.attendanceWorked / stats.attendanceScheduled : null;
      const attendancePoints =
        attendanceRate == null ? null : 15 * clamp(attendanceRate, 0, 1);

      const avgLateMinutes =
        stats.lateMinutes.length > 0
          ? stats.lateMinutes.reduce((sum, v) => sum + v, 0) / stats.lateMinutes.length
          : null;
      const punctualityPoints =
        avgLateMinutes == null ? null : 15 * clamp(1 - avgLateMinutes / 15, 0, 1);

      const avgDrawerDelta =
        stats.drawerAbsDelta.length > 0
          ? stats.drawerAbsDelta.reduce((sum, v) => sum + v, 0) / stats.drawerAbsDelta.length
          : null;
      const accuracyPoints =
        avgDrawerDelta == null ? null : 20 * clamp(1 - avgDrawerDelta / 2000, 0, 1);

      const avgCloseoutVariance =
        stats.closeoutAbsVariance.length > 0
          ? stats.closeoutAbsVariance.reduce((sum, v) => sum + v, 0) / stats.closeoutAbsVariance.length
          : null;
      const cashHandlingPoints =
        avgCloseoutVariance == null ? null : 10 * clamp(1 - avgCloseoutVariance / 1000, 0, 1);

      const cleaningTotal = stats.cleaningCompleted + stats.cleaningSkipped;
      const completionRate =
        cleaningTotal > 0 ? stats.cleaningCompleted / cleaningTotal : null;
      const taskPoints = completionRate == null ? null : 10 * clamp(completionRate, 0, 1);

      const categories = [
        category(
          "sales_raw",
          "Raw Sales",
          15,
          salesRawPoints,
          rawAvg == null ? "No raw sales data" : `Avg/shift ${round(rawAvg / 100, 2)}`
        ),
        category(
          "sales_adjusted",
          "Adjusted Sales",
          15,
          salesAdjustedPoints,
          adjustedAvg == null ? "No adjusted sales data" : `Adj avg/shift ${round(adjustedAvg / 100, 2)}`
        ),
        category(
          "attendance",
          "Attendance",
          15,
          attendancePoints,
          attendanceRate == null
            ? "No published schedule data"
            : `${stats.attendanceWorked}/${stats.attendanceScheduled}`
        ),
        category(
          "punctuality",
          "Punctuality",
          15,
          punctualityPoints,
          avgLateMinutes == null ? "No punctuality data" : `Avg late ${round(avgLateMinutes, 1)} min`
        ),
        category(
          "accuracy",
          "Drawer Accuracy",
          20,
          accuracyPoints,
          avgDrawerDelta == null ? "No start/end drawer pairs" : `Avg delta ${round(avgDrawerDelta / 100, 2)}`
        ),
        category(
          "cash_handling",
          "Cash Handling",
          10,
          cashHandlingPoints,
          avgCloseoutVariance == null
            ? "No closeout variance data"
            : `Avg abs variance ${round(avgCloseoutVariance / 100, 2)}`
        ),
        category(
          "task_master",
          "Task Master",
          10,
          taskPoints,
          completionRate == null
            ? "No cleaning task data"
            : `${stats.cleaningCompleted}/${cleaningTotal} completed`
        ),
      ];

      const availableMax = categories
        .filter((c) => c.available)
        .reduce((sum, c) => sum + c.maxPoints, 0);
      const earned = categories
        .filter((c) => c.available)
        .reduce((sum, c) => sum + (c.points ?? 0), 0);
      const normalizedScore = availableMax > 0 ? round((earned / availableMax) * 100) : 0;
      const ranked = stats.shiftsWorked >= MIN_SHIFTS_FOR_RANKING;

      return {
        profileId: stats.profileId,
        employeeName: stats.employeeName,
        shiftsWorked: stats.shiftsWorked,
        ranked,
        score: normalizedScore,
        grade: gradeForScore(normalizedScore),
        rawAvgSalesPerShiftCents: rawAvg == null ? null : Math.round(rawAvg),
        adjustedAvgSalesPerShiftCents: adjustedAvg == null ? null : Math.round(adjustedAvg),
        categories,
      };
    });

    rows.sort((a, b) => {
      if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
      return b.score - a.score;
    });

    const response: EmployeeScoreboardResponse = {
      stores: (storesRes.data ?? []).map((s) => ({ id: s.id, name: s.name })),
      rows,
      from,
      to,
      minShiftsForRanking: MIN_SHIFTS_FOR_RANKING,
    };
    return NextResponse.json(response);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load employee scoreboard." },
      { status: 500 }
    );
  }
}
