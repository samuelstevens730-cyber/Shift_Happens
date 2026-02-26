import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { ShiftBreakdownResponse, ShiftScoreRow } from "@/types/shiftScoreRow";

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

function punctualityShiftScore(effectiveLateMinutes: number): number {
  if (effectiveLateMinutes <= 0) return 1;
  if (effectiveLateMinutes >= 10) return 0;
  const ratio = effectiveLateMinutes / 10;
  return clamp(1 - ratio * ratio, 0, 1);
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
      return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
    }

    const url = new URL(req.url);
    const profileId = url.searchParams.get("profileId");
    if (!profileId) {
      return NextResponse.json({ error: "profileId is required." }, { status: 400 });
    }

    const storeId = url.searchParams.get("storeId");
    if (storeId && storeId !== "all" && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store filter." }, { status: 403 });
    }
    const activeStoreIds = storeId && storeId !== "all" ? [storeId] : managerStoreIds;

    const defaultTo = cstDateKey(new Date());
    const defaultFrom = cstDateKey(addDays(new Date(), -29));
    const from = isDateOnly(url.searchParams.get("from")) ? (url.searchParams.get("from") as string) : defaultFrom;
    const to = isDateOnly(url.searchParams.get("to")) ? (url.searchParams.get("to") as string) : defaultTo;

    const [storesRes, shiftsRes, salesRes, drawerCountsRes, closeoutsRes, cleaningRes, schedulesRes, scheduledShiftsRes, profileRes] =
      await Promise.all([
        supabaseServer
          .from("stores")
          .select("id,name")
          .in("id", activeStoreIds)
          .returns<Array<{ id: string; name: string }>>(),
        supabaseServer
          .from("shifts")
          .select("id,store_id,profile_id,shift_type,planned_start_at,started_at,ended_at,schedule_shift_id,last_action")
          .in("store_id", activeStoreIds)
          .eq("profile_id", profileId)
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
          .eq("profile_id", profileId)
          .in("store_id", activeStoreIds)
          .gte("business_date", from)
          .lte("business_date", to)
          .returns<Array<{ shift_id: string | null; profile_id: string; variance_cents: number }>>(),
        supabaseServer
          .from("cleaning_task_completions")
          .select("completed_by,status,completed_at,shift_id,shift:shift_id(store_id)")
          .eq("completed_by", profileId)
          .gte("completed_at", `${from}T00:00:00.000Z`)
          .lte("completed_at", `${to}T23:59:59.999Z`)
          .returns<
            Array<{
              completed_by: string;
              status: "completed" | "skipped";
              completed_at: string;
              shift_id: string | null;
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
          .eq("profile_id", profileId)
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
        supabaseServer
          .from("profiles")
          .select("id,name")
          .eq("id", profileId)
          .single()
          .returns<{ id: string; name: string | null }>(),
      ]);

    for (const result of [storesRes, shiftsRes, salesRes, drawerCountsRes, closeoutsRes, cleaningRes, schedulesRes, scheduledShiftsRes]) {
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 });

    // Verify this employee actually works at one of the manager's stores
    const employeeShifts = shiftsRes.data ?? [];
    const employeeScheduleShifts = scheduledShiftsRes.data ?? [];
    const hasAccess =
      employeeShifts.some((s) => activeStoreIds.includes(s.store_id)) ||
      employeeScheduleShifts.some((s) => activeStoreIds.includes(s.store_id));
    if (!hasAccess && employeeShifts.length === 0 && employeeScheduleShifts.length === 0) {
      // Employee may not belong to these stores — still return empty rather than error
    }

    const storeNameById = new Map((storesRes.data ?? []).map((s) => [s.id, s.name]));
    const employeeName = profileRes.data?.name ?? null;

    const salesByOpenShiftId = new Map(
      (salesRes.data ?? []).filter((row) => Boolean(row.open_shift_id)).map((row) => [row.open_shift_id as string, row])
    );
    const salesByCloseShiftId = new Map(
      (salesRes.data ?? []).filter((row) => Boolean(row.close_shift_id)).map((row) => [row.close_shift_id as string, row])
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
        storeId: shift.store_id,
        shiftType: shift.shift_type,
        plannedStartAt: shift.planned_start_at,
        startedAt: shift.started_at,
        scheduleShiftId: shift.schedule_shift_id,
        businessDate,
        salesCents,
      };
    });

    // Store adjustment factors
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

    const countsByShiftId = new Map<string, { start: number | null; end: number | null }>();
    for (const row of drawerCountsRes.data ?? []) {
      const cur = countsByShiftId.get(row.shift_id) ?? { start: null, end: null };
      if (row.count_type === "start") cur.start = row.drawer_cents;
      if (row.count_type === "end") cur.end = row.drawer_cents;
      countsByShiftId.set(row.shift_id, cur);
    }

    const closeoutByShiftId = new Map<string, number>();
    for (const row of closeoutsRes.data ?? []) {
      if (row.shift_id) {
        closeoutByShiftId.set(row.shift_id, Math.abs(row.variance_cents ?? 0));
      }
    }

    const cleaningByShiftId = new Map<string, { completed: number; total: number }>();
    const cleaningByDate = new Map<string, { completed: number; total: number }>();
    for (const row of cleaningRes.data ?? []) {
      if (!row.shift || !activeStoreIds.includes(row.shift.store_id)) continue;
      const isCompleted = row.status === "completed";
      if (row.shift_id) {
        const cur = cleaningByShiftId.get(row.shift_id) ?? { completed: 0, total: 0 };
        if (isCompleted) cur.completed += 1;
        cur.total += 1;
        cleaningByShiftId.set(row.shift_id, cur);
      } else {
        const dateKey = cstDateKey(new Date(row.completed_at));
        const cur = cleaningByDate.get(dateKey) ?? { completed: 0, total: 0 };
        if (isCompleted) cur.completed += 1;
        cur.total += 1;
        cleaningByDate.set(dateKey, cur);
      }
    }

    type WorkingRow = {
      shiftId: string;
      scheduleShiftId: string | null;
      date: string;
      storeId: string;
      shiftType: "open" | "close" | "double" | "other";
      startedAt: string;
      salesRawCents: number | null;
      salesAdjustedCents: number | null;
      actualStartMin: number | null;
      scheduledStartMin: number | null;
      effectiveLateMinutes: number | null;
      drawerAbsDeltaCents: number | null;
      closeoutVarianceCents: number | null;
      cleaningCompleted: number;
      cleaningTotal: number;
    };

    const workedRows = new Map<string, WorkingRow>();
    for (const row of rawShiftSalesRows) {
      const drawerCounts = countsByShiftId.get(row.shiftId);
      const drawerAbsDelta =
        drawerCounts && drawerCounts.start != null && drawerCounts.end != null
          ? Math.abs(drawerCounts.end - drawerCounts.start)
          : null;
      const closeoutVariance = closeoutByShiftId.get(row.shiftId) ?? null;
      const cleaning = cleaningByShiftId.get(row.shiftId) ?? cleaningByDate.get(row.businessDate) ?? { completed: 0, total: 0 };
      const factor = storeFactor.get(row.storeId) ?? 1;
      workedRows.set(row.shiftId, {
        shiftId: row.shiftId,
        scheduleShiftId: row.scheduleShiftId,
        date: row.businessDate,
        storeId: row.storeId,
        shiftType: row.shiftType,
        startedAt: row.startedAt,
        salesRawCents: row.salesCents,
        salesAdjustedCents: row.salesCents != null ? Math.round(row.salesCents * factor) : null,
        actualStartMin: cstMinutesOfDay(row.startedAt),
        scheduledStartMin: null,
        effectiveLateMinutes: null,
        drawerAbsDeltaCents: drawerAbsDelta,
        closeoutVarianceCents: closeoutVariance,
        cleaningCompleted: cleaning.completed,
        cleaningTotal: cleaning.total,
      });
    }

    const publishedScheduleIds = new Set(
      (schedulesRes.data ?? []).filter((s) => s.status === "published").map((s) => s.id)
    );
    const publishedScheduled = (scheduledShiftsRes.data ?? []).filter((s) =>
      publishedScheduleIds.has(s.schedule_id)
    );

    const workedByScheduleShiftId = new Map<string, WorkingRow>();
    for (const row of workedRows.values()) {
      if (row.scheduleShiftId) workedByScheduleShiftId.set(row.scheduleShiftId, row);
    }

    const absentRows: ShiftScoreRow[] = [];

    for (const scheduleShift of publishedScheduled) {
      const scheduledMin = parseTimeToMinutes(scheduleShift.scheduled_start);
      const worked = workedByScheduleShiftId.get(scheduleShift.id);
      if (worked) {
        worked.scheduledStartMin = scheduledMin;
        if (worked.actualStartMin != null && scheduledMin != null) {
          worked.effectiveLateMinutes = Math.max(0, worked.actualStartMin - scheduledMin - 5);
        }
      } else {
        const storeName = storeNameById.get(scheduleShift.store_id) ?? "Unknown Store";
        absentRows.push({
          shiftId: null,
          scheduleShiftId: scheduleShift.id,
          date: scheduleShift.shift_date,
          storeName,
          shiftType: null,
          attended: false,
          salesRawCents: null,
          salesAdjustedCents: null,
          scheduledStartMin: scheduledMin,
          actualStartMin: null,
          effectiveLateMinutes: null,
          drawerAbsDeltaCents: null,
          closeoutVarianceCents: null,
          cleaningCompleted: 0,
          cleaningTotal: 0,
          attendancePoints: 0,
          punctualityPoints: null,
          accuracyPoints: null,
          cashHandlingPoints: null,
          taskPoints: null,
          compositeScore: 0,
        });
      }
    }

    const workedScoreRows: ShiftScoreRow[] = Array.from(workedRows.values()).map((row) => {
      const storeName = storeNameById.get(row.storeId) ?? "Unknown Store";

      const attendancePoints = row.scheduleShiftId != null ? 15 : null;

      let punctualityPoints: number | null = null;
      if (row.effectiveLateMinutes != null) {
        punctualityPoints = round(15 * punctualityShiftScore(row.effectiveLateMinutes));
      }

      const accuracyPoints =
        row.drawerAbsDeltaCents != null
          ? round(20 * clamp(1 - row.drawerAbsDeltaCents / 2000, 0, 1))
          : null;

      const cashHandlingPoints =
        row.closeoutVarianceCents != null
          ? round(10 * clamp(1 - row.closeoutVarianceCents / 1000, 0, 1))
          : null;

      const taskPoints =
        row.cleaningTotal > 0 ? round(10 * clamp(row.cleaningCompleted / row.cleaningTotal, 0, 1)) : null;

      const metrics: Array<{ pts: number; max: number }> = [];
      if (attendancePoints != null) metrics.push({ pts: attendancePoints, max: 15 });
      if (punctualityPoints != null) metrics.push({ pts: punctualityPoints, max: 15 });
      if (accuracyPoints != null) metrics.push({ pts: accuracyPoints, max: 20 });
      if (cashHandlingPoints != null) metrics.push({ pts: cashHandlingPoints, max: 10 });
      if (taskPoints != null) metrics.push({ pts: taskPoints, max: 10 });

      const availableMax = metrics.reduce((sum, m) => sum + m.max, 0);
      const earned = metrics.reduce((sum, m) => sum + m.pts, 0);
      const compositeScore = availableMax > 0 ? round((earned / availableMax) * 100) : null;

      return {
        shiftId: row.shiftId,
        scheduleShiftId: row.scheduleShiftId,
        date: row.date,
        storeName,
        shiftType: row.shiftType,
        attended: true,
        salesRawCents: row.salesRawCents,
        salesAdjustedCents: row.salesAdjustedCents,
        scheduledStartMin: row.scheduledStartMin,
        actualStartMin: row.actualStartMin,
        effectiveLateMinutes: row.effectiveLateMinutes,
        drawerAbsDeltaCents: row.drawerAbsDeltaCents,
        closeoutVarianceCents: row.closeoutVarianceCents,
        cleaningCompleted: row.cleaningCompleted,
        cleaningTotal: row.cleaningTotal,
        attendancePoints,
        punctualityPoints,
        accuracyPoints,
        cashHandlingPoints,
        taskPoints,
        compositeScore,
      };
    });

    const allRows: ShiftScoreRow[] = [...workedScoreRows, ...absentRows].sort((a, b) => {
      if (a.date < b.date) return 1;
      if (a.date > b.date) return -1;
      return 0;
    });

    const response: ShiftBreakdownResponse = {
      profileId,
      employeeName,
      rows: allRows,
      from,
      to,
    };
    return NextResponse.json(response);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load shift breakdown." },
      { status: 500 }
    );
  }
}
