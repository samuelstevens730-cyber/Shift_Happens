/**
 * salesAnalyzer.ts
 *
 * Core per-employee sales performance computation.
 * Pure computation — no DB access. The API route fetches data; this module
 * crunches it and returns structured EmployeePeriodSummary objects.
 *
 * Sales formula is identical to shift-sales/route.ts and employee-scoreboard/route.ts.
 * Normalization delegates to salesNormalization.ts.
 */

import { computeScalingFactors, applyScalingFactor, StoreTotals } from "@/lib/salesNormalization";

// ─── DB Row Types ──────────────────────────────────────────────────────────────

export interface RawShiftRow {
  id: string;
  store_id: string;
  profile_id: string;
  shift_type: "open" | "close" | "double" | "other";
  planned_start_at: string;
  started_at: string;
  ended_at: string | null;
  last_action: string | null;
  // Weather snapshot captured at clock-in/out. NULL for historical shifts.
  start_weather_condition: string | null;
  start_weather_desc:      string | null;
  start_temp_f: number | null;
  end_weather_condition: string | null;
  end_weather_desc:      string | null;
  end_temp_f: number | null;
}

export interface SalesRecordRow {
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
  // Transaction count fields — NULL for historical rows (no DEFAULT in DB).
  // 0 is treated as NULL by the app layer; never include in averages.
  open_transaction_count:  number | null;
  close_transaction_count: number | null;
  // Mid-day X report total (changeover). NULL = not captured for this shift.
  // Enables AM/PM sales split for double shifts.
  mid_x_report_cents: number | null;
}

export interface StoreRow { id: string; name: string; }
export interface ProfileRow { id: string; name: string | null; }

// ─── Output Types ──────────────────────────────────────────────────────────────

export interface ShiftSummary {
  shiftId: string;
  date: string;           // YYYY-MM-DD (CST business date)
  dayOfWeek: string;      // 'Monday' etc.
  storeId: string;
  storeName: string;
  shiftType: "open" | "close" | "double" | "other";
  startedAt: string;      // ISO
  endedAt: string | null;
  shiftHours: number;     // 0 if endedAt is null
  rawSalesCents: number | null;
  adjustedSalesCents: number | null;
  rawPerHour: number | null;
  adjustedPerHour: number | null;
  performanceFlag: "HIGH" | "LOW" | "NORMAL" | null;  // null if not countable
  isCountable: boolean;
  // null = no transaction data for this shift (historical or not yet entered).
  // 0 is normalized to null at computation time — never divide by 0.
  transactionCount: number | null;
  // AM/PM split — only populated for double shifts with mid_x_report_cents.
  // null means the mid-day X was not captured for this shift.
  amRawSalesCents:    number | null;
  pmRawSalesCents:    number | null;
  amTransactionCount: number | null;  // open_transaction_count (AM half)
  pmTransactionCount: number | null;  // close_transaction_count (PM half)
  // Weather at clock-in and clock-out. NULL for historical shifts.
  startWeatherCondition: string | null;
  startWeatherDesc:      string | null;
  startTempF: number | null;
  endWeatherCondition: string | null;
  endWeatherDesc:      string | null;
  endTempF: number | null;
}

export interface ShiftTypeBreakdown {
  type: string;
  shifts: number;
  avgAdjustedCents: number;
  avgAdjPerHourCents: number;
  highCount: number;
  lowCount: number;
}

export interface DayOfWeekBreakdown {
  day: string;
  shifts: number;
  avgAdjustedCents: number;
  avgAdjPerHourCents: number;
}

export interface StoreBreakdown {
  storeId: string;
  storeName: string;
  shifts: number;
  avgAdjustedCents: number;
}

export interface EmployeePeriodSummary {
  employeeId: string;
  employeeName: string;
  primaryStore: string;
  period: { from: string; to: string };

  // core metrics (monetary values in cents)
  totalShifts: number;
  countableShifts: number;
  totalHours: number;
  totalRawSalesCents: number;
  totalAdjustedSalesCents: number;
  avgRawPerShiftCents: number;
  avgAdjustedPerShiftCents: number;
  avgRawPerHourCents: number;
  avgAdjustedPerHourCents: number;

  // variance flags
  highFlagCount: number;
  lowFlagCount: number;
  normalFlagCount: number;
  highFlagPct: number;
  lowFlagPct: number;

  // streak: positive = consecutive HIGHs, negative = consecutive LOWs
  currentStreak: number;

  // transaction count aggregates (only populated when transactionTrackedShifts > 0)
  transactionTrackedShifts:    number;        // shifts where transactionCount > 0
  avgTransactionsPerShift:     number | null; // null when no tracked shifts
  avgSalesPerTransactionCents: number | null; // null when no tracked shifts

  // breakdowns
  byShiftType: ShiftTypeBreakdown[];
  byDayOfWeek: DayOfWeekBreakdown[];
  byStore: StoreBreakdown[];

  // benchmark (passed in externally, in cents)
  benchmarkAdjAvgCents: number | null;
  gapVsBenchmarkCents: number | null;
  estimatedMonthlyGapCents: number | null;

  shifts: ShiftSummary[];
}

export interface AnalyzerOptions {
  /** If provided, compute benchmark from these employees' adjusted averages. */
  benchmarkEmployeeIds?: string[];
  /**
   * Projected shifts per month for gap extrapolation.
   * Defaults to: countableShifts / periodDays * 30
   */
  projectedMonthlyShifts?: number;
}

export interface AnalyzerResult {
  summaries: EmployeePeriodSummary[];
  /** Average adjusted sales per shift across benchmark employees (cents), or null. */
  benchmarkCents: number | null;
  /** The store scaling factors used (storeId → factor), for transparency. */
  storeFactors: Map<string, number>;
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

function cstDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOfWeekFromDateStr(dateStr: string): string {
  // Parse YYYY-MM-DD at noon UTC to avoid DST/timezone day-shift issues
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return DAY_NAMES[dt.getUTCDay()];
}

function shiftHoursFromIso(startedAt: string, endedAt: string | null): number {
  if (!endedAt) return 0;
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60));
}

/** Same sales formula as shift-sales/route.ts and employee-scoreboard/route.ts. */
function computeShiftSalesCents(
  shiftType: string,
  salesRecord: SalesRecordRow | null
): number | null {
  if (!salesRecord) return null;
  const beginningX = salesRecord.rollover_from_previous_cents ?? 0;
  const openX = salesRecord.open_x_report_cents ?? null;
  const closeSales = salesRecord.close_sales_cents ?? null;
  const zReport = salesRecord.z_report_cents ?? null;
  const priorX = openX;
  const midnightX = salesRecord.closer_rollover_cents ?? null;
  const isRolloverNight = Boolean(salesRecord.is_rollover_night);

  if (shiftType === "open") {
    return openX != null ? openX - beginningX : null;
  }
  if (shiftType === "close" || shiftType === "double") {
    const baseClose = closeSales ?? (zReport != null && priorX != null ? zReport - priorX : null);
    if (baseClose == null) return null;
    return baseClose + (isRolloverNight ? midnightX ?? 0 : 0);
  }
  return null; // 'other' shifts have no sales formula
}

/** Primary store = store where most shifts were worked.
 *  Tie-break: higher total adjusted sales. Further tie: alphabetical by store name. */
function computePrimaryStore(
  shifts: ShiftSummary[],
  storeNameById: Map<string, string>
): string {
  if (shifts.length === 0) return "Unknown";
  const countByStore = new Map<string, number>();
  const adjByStore = new Map<string, number>();
  for (const s of shifts) {
    countByStore.set(s.storeId, (countByStore.get(s.storeId) ?? 0) + 1);
    adjByStore.set(s.storeId, (adjByStore.get(s.storeId) ?? 0) + (s.adjustedSalesCents ?? 0));
  }
  const maxCount = Math.max(...countByStore.values());
  const tied = Array.from(countByStore.entries())
    .filter(([, c]) => c === maxCount)
    .map(([sid]) => sid);
  if (tied.length === 1) return storeNameById.get(tied[0]) ?? tied[0];
  // Tie: sort by adjusted sales desc, then name asc
  tied.sort((a, b) => {
    const adjDiff = (adjByStore.get(b) ?? 0) - (adjByStore.get(a) ?? 0);
    if (adjDiff !== 0) return adjDiff;
    return (storeNameById.get(a) ?? a).localeCompare(storeNameById.get(b) ?? b);
  });
  return storeNameById.get(tied[0]) ?? tied[0];
}

/** Streak: positive = consecutive HIGHs from most recent, negative = consecutive LOWs. */
function computeStreak(flaggedShifts: Array<{ date: string; flag: "HIGH" | "LOW" | "NORMAL" }>): number {
  if (flaggedShifts.length === 0) return 0;
  const sorted = [...flaggedShifts].sort((a, b) => a.date.localeCompare(b.date));
  const lastFlag = sorted[sorted.length - 1].flag;
  if (lastFlag === "NORMAL") return 0;
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].flag === lastFlag) count++;
    else break;
  }
  return lastFlag === "HIGH" ? count : -count;
}

// ─── Main Export ───────────────────────────────────────────────────────────────

/**
 * Analyse shift-sales data for a set of employees over a period.
 *
 * All monetary values in the output are in CENTS (integers).
 * Convert to dollars only at the formatter / display layer.
 *
 * @param shifts        All shifts for the period (pre-filtered by store scope, not removed)
 * @param salesRecords  All daily_sales_records for the period
 * @param stores        Store metadata (id + name)
 * @param profiles      Profile metadata (id + name)
 * @param from          Period start, YYYY-MM-DD
 * @param to            Period end, YYYY-MM-DD
 * @param options       Benchmark employee IDs, projected monthly shifts override
 */
export function analyzeEmployeeSales(
  shifts: RawShiftRow[],
  salesRecords: SalesRecordRow[],
  stores: StoreRow[],
  profiles: ProfileRow[],
  from: string,
  to: string,
  options: AnalyzerOptions = {}
): AnalyzerResult {
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));
  const profileNameById = new Map(profiles.map((p) => [p.id, p.name ?? null]));

  // Build sales record lookup maps (same pattern as shift-sales/route.ts)
  const salesByOpenShiftId = new Map(
    salesRecords.filter((r) => Boolean(r.open_shift_id)).map((r) => [r.open_shift_id as string, r])
  );
  const salesByCloseShiftId = new Map(
    salesRecords.filter((r) => Boolean(r.close_shift_id)).map((r) => [r.close_shift_id as string, r])
  );
  const salesByStoreDate = new Map(
    salesRecords.map((r) => [`${r.store_id}|${r.business_date}`, r])
  );

  // ── Pass 1: compute raw shift data ──────────────────────────────────────────
  interface IntermediateShift {
    shiftId: string;
    profileId: string;
    storeId: string;
    storeName: string;
    shiftType: "open" | "close" | "double" | "other";
    date: string;
    dayOfWeek: string;
    startedAt: string;
    endedAt: string | null;
    shiftHours: number;
    rawSalesCents: number | null;
    adjustedSalesCents: number | null; // filled after normalization
    isCountable: boolean;
    transactionCount: number | null;   // null = no data; 0 normalized to null
    // AM/PM split (double shifts only, requires mid_x_report_cents)
    amRawSalesCents:    number | null;
    pmRawSalesCents:    number | null;
    amTransactionCount: number | null;
    pmTransactionCount: number | null;
    // Weather snapshot from OWM at clock-in/out. NULL for historical shifts.
    startWeatherCondition: string | null;
    startWeatherDesc:      string | null;
    startTempF:            number | null;
    endWeatherCondition:   string | null;
    endWeatherDesc:        string | null;
    endTempF:              number | null;
  }

  const intermediate: IntermediateShift[] = shifts.map((shift) => {
    const businessDate = cstDateKey(shift.planned_start_at);
    const salesRecord =
      salesByOpenShiftId.get(shift.id) ??
      salesByCloseShiftId.get(shift.id) ??
      salesByStoreDate.get(`${shift.store_id}|${businessDate}`) ??
      null;
    const rawSalesCents = computeShiftSalesCents(shift.shift_type, salesRecord);
    const hours = shiftHoursFromIso(shift.started_at, shift.ended_at);

    // Read the appropriate transaction count column based on shift type.
    // Double shifts: the same employee handles both open and close, so we sum
    // both counts when available (consistent with the sales formula that spans
    // the full day). If only one is present the other is treated as 0.
    const rawTxCount: number | null = (() => {
      if (!salesRecord) return null;
      if (shift.shift_type === "open") return salesRecord.open_transaction_count;
      if (shift.shift_type === "close") return salesRecord.close_transaction_count;
      if (shift.shift_type === "double") {
        const o = salesRecord.open_transaction_count ?? 0;
        const c = salesRecord.close_transaction_count ?? 0;
        const total = o + c;
        return total > 0 ? total : null;
      }
      return null;
    })();
    // CRITICAL: 0 is treated as "no data" — identical to NULL for historical rows.
    // This prevents zero-default records from contaminating per-transaction averages.
    const transactionCount = rawTxCount != null && rawTxCount > 0 ? rawTxCount : null;

    // ── AM/PM split (double shifts with mid_x_report_cents only) ────────────
    let amRawSalesCents:    number | null = null;
    let pmRawSalesCents:    number | null = null;
    let amTransactionCount: number | null = null;
    let pmTransactionCount: number | null = null;

    if (shift.shift_type === "double" && salesRecord) {
      const midX   = salesRecord.mid_x_report_cents ?? null;
      const openX  = salesRecord.open_x_report_cents ?? null;
      const zRep   = salesRecord.z_report_cents ?? null;
      const rollov = salesRecord.closer_rollover_cents ?? 0;
      const isRoll = Boolean(salesRecord.is_rollover_night);

      if (midX != null) {
        // AM = register delta from open-X to mid-X.
        // openX (open_x_report_cents) is the starting drawer value recorded by
        // the opener. Without it we cannot establish the baseline, so
        // amRawSalesCents remains null intentionally — there is no meaningful
        // fallback when the starting X is missing. pmRawSalesCents is
        // independent of openX and can be computed even when AM is null.
        amRawSalesCents = openX != null ? midX - openX : null;
        // PM = register delta from mid-X to close (+ rollover carry if applicable)
        pmRawSalesCents = zRep != null ? zRep - midX + (isRoll ? rollov : 0) : null;
      }

      // AM transactions = what was entered at changeover (open column)
      const rawAm = salesRecord.open_transaction_count;
      amTransactionCount = rawAm != null && rawAm > 0 ? rawAm : null;

      // PM transactions = what was entered at end of day (close column)
      const rawPm = salesRecord.close_transaction_count;
      pmTransactionCount = rawPm != null && rawPm > 0 ? rawPm : null;
    }

    return {
      shiftId: shift.id,
      profileId: shift.profile_id,
      storeId: shift.store_id,
      storeName: storeNameById.get(shift.store_id) ?? shift.store_id,
      shiftType: shift.shift_type,
      date: businessDate,
      dayOfWeek: dayOfWeekFromDateStr(businessDate),
      startedAt: shift.started_at,
      endedAt: shift.ended_at,
      shiftHours: hours,
      rawSalesCents,
      adjustedSalesCents: null, // filled below
      // Countable = has sales data + shift is closed (ended_at not null)
      isCountable: rawSalesCents != null && shift.ended_at != null,
      transactionCount,
      amRawSalesCents,
      pmRawSalesCents,
      amTransactionCount,
      pmTransactionCount,
      startWeatherCondition: shift.start_weather_condition,
      startWeatherDesc:      shift.start_weather_desc,
      startTempF:            shift.start_temp_f,
      endWeatherCondition:   shift.end_weather_condition,
      endWeatherDesc:        shift.end_weather_desc,
      endTempF:              shift.end_temp_f,
    };
  });

  // ── Normalization ────────────────────────────────────────────────────────────
  // Build StoreTotals from countable shifts
  const storeRawTotals = new Map<string, { total: number; count: number }>();
  for (const s of intermediate) {
    if (!s.isCountable || s.rawSalesCents == null) continue;
    const entry = storeRawTotals.get(s.storeId) ?? { total: 0, count: 0 };
    entry.total += s.rawSalesCents;
    entry.count += 1;
    storeRawTotals.set(s.storeId, entry);
  }
  const storeTotals: StoreTotals[] = stores.map((store) => {
    const entry = storeRawTotals.get(store.id) ?? { total: 0, count: 0 };
    return { storeId: store.id, totalSalesCents: entry.total, shiftCount: entry.count };
  });
  const storeFactors = computeScalingFactors(storeTotals);

  // Apply factors
  for (const s of intermediate) {
    if (s.rawSalesCents != null) {
      s.adjustedSalesCents = applyScalingFactor(s.rawSalesCents, s.storeId, storeFactors);
    }
  }

  // ── Group shifts by employee ─────────────────────────────────────────────────
  const byEmployee = new Map<string, IntermediateShift[]>();
  for (const s of intermediate) {
    const arr = byEmployee.get(s.profileId) ?? [];
    arr.push(s);
    byEmployee.set(s.profileId, arr);
  }

  // Ensure benchmark employees are included even if they have no shifts in the
  // requested period — they'll produce summaries with zero countable shifts
  const allEmployeeIds = new Set(byEmployee.keys());
  for (const id of options.benchmarkEmployeeIds ?? []) {
    if (!allEmployeeIds.has(id)) byEmployee.set(id, []);
  }

  // ── Pass 2: per-employee summary ─────────────────────────────────────────────
  const periodDays = Math.max(
    1,
    (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24) + 1
  );

  const summaries: EmployeePeriodSummary[] = [];

  for (const [profileId, empShifts] of byEmployee.entries()) {
    const countable = empShifts.filter((s) => s.isCountable && s.adjustedSalesCents != null);
    const totalAdj = countable.reduce((sum, s) => sum + (s.adjustedSalesCents ?? 0), 0);
    const totalRaw = countable.reduce((sum, s) => sum + (s.rawSalesCents ?? 0), 0);
    const totalHours = empShifts.reduce((sum, s) => sum + s.shiftHours, 0);
    const countableHours = countable.reduce((sum, s) => sum + s.shiftHours, 0);

    const avgAdjPerShift = countable.length > 0 ? totalAdj / countable.length : 0;
    const avgRawPerShift = countable.length > 0 ? totalRaw / countable.length : 0;
    const avgAdjPerHour = countableHours > 0 ? totalAdj / countableHours : 0;
    const avgRawPerHour = countableHours > 0 ? totalRaw / countableHours : 0;

    // ── Performance flags (requires avgAdjPerShift to be known first) ──────────
    const flaggedForStreak: Array<{ date: string; flag: "HIGH" | "LOW" | "NORMAL" }> = [];
    let highCount = 0;
    let lowCount = 0;
    let normalCount = 0;

    const shiftSummaries: ShiftSummary[] = empShifts.map((s) => {
      let flag: "HIGH" | "LOW" | "NORMAL" | null = null;
      if (s.isCountable && s.adjustedSalesCents != null && avgAdjPerShift > 0) {
        if (s.adjustedSalesCents > avgAdjPerShift * 1.2) {
          flag = "HIGH"; highCount++;
        } else if (s.adjustedSalesCents < avgAdjPerShift * 0.8) {
          flag = "LOW"; lowCount++;
        } else {
          flag = "NORMAL"; normalCount++;
        }
        flaggedForStreak.push({ date: s.date, flag });
      }
      return {
        shiftId: s.shiftId,
        date: s.date,
        dayOfWeek: s.dayOfWeek,
        storeId: s.storeId,
        storeName: s.storeName,
        shiftType: s.shiftType,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        shiftHours: s.shiftHours,
        rawSalesCents: s.rawSalesCents,
        adjustedSalesCents: s.adjustedSalesCents,
        rawPerHour: s.shiftHours > 0 && s.rawSalesCents != null ? s.rawSalesCents / s.shiftHours : null,
        adjustedPerHour: s.shiftHours > 0 && s.adjustedSalesCents != null ? s.adjustedSalesCents / s.shiftHours : null,
        performanceFlag: flag,
        isCountable: s.isCountable,
        transactionCount: s.transactionCount,
        amRawSalesCents: s.amRawSalesCents,
        pmRawSalesCents: s.pmRawSalesCents,
        amTransactionCount: s.amTransactionCount,
        pmTransactionCount: s.pmTransactionCount,
        startWeatherCondition: s.startWeatherCondition,
        startWeatherDesc:      s.startWeatherDesc,
        startTempF:            s.startTempF,
        endWeatherCondition:   s.endWeatherCondition,
        endWeatherDesc:        s.endWeatherDesc,
        endTempF:              s.endTempF,
      };
    });

    // ── Streak ────────────────────────────────────────────────────────────────
    const streak = computeStreak(flaggedForStreak);

    // ── byShiftType breakdown ─────────────────────────────────────────────────
    const typeAgg = new Map<string, { count: number; totalAdj: number; totalAdjHr: number; hi: number; lo: number }>();
    for (const s of shiftSummaries) {
      if (!s.isCountable || s.adjustedSalesCents == null) continue;
      const e = typeAgg.get(s.shiftType) ?? { count: 0, totalAdj: 0, totalAdjHr: 0, hi: 0, lo: 0 };
      e.count++;
      e.totalAdj += s.adjustedSalesCents;
      e.totalAdjHr += s.adjustedPerHour ?? 0;
      if (s.performanceFlag === "HIGH") e.hi++;
      if (s.performanceFlag === "LOW") e.lo++;
      typeAgg.set(s.shiftType, e);
    }
    const byShiftType: ShiftTypeBreakdown[] = Array.from(typeAgg.entries()).map(([type, e]) => ({
      type,
      shifts: e.count,
      avgAdjustedCents: e.count > 0 ? Math.round(e.totalAdj / e.count) : 0,
      avgAdjPerHourCents: e.count > 0 ? Math.round(e.totalAdjHr / e.count) : 0,
      highCount: e.hi,
      lowCount: e.lo,
    }));

    // ── byDayOfWeek breakdown ────────────────────────────────────────────────
    const dowAgg = new Map<string, { count: number; totalAdj: number; totalAdjHr: number }>();
    for (const s of shiftSummaries) {
      if (!s.isCountable || s.adjustedSalesCents == null) continue;
      const e = dowAgg.get(s.dayOfWeek) ?? { count: 0, totalAdj: 0, totalAdjHr: 0 };
      e.count++;
      e.totalAdj += s.adjustedSalesCents;
      e.totalAdjHr += s.adjustedPerHour ?? 0;
      dowAgg.set(s.dayOfWeek, e);
    }
    const byDayOfWeek: DayOfWeekBreakdown[] = Array.from(dowAgg.entries()).map(([day, e]) => ({
      day,
      shifts: e.count,
      avgAdjustedCents: e.count > 0 ? Math.round(e.totalAdj / e.count) : 0,
      avgAdjPerHourCents: e.count > 0 ? Math.round(e.totalAdjHr / e.count) : 0,
    }));

    // ── byStore breakdown ────────────────────────────────────────────────────
    const storeAgg = new Map<string, { name: string; count: number; totalAdj: number }>();
    for (const s of shiftSummaries) {
      if (!s.isCountable || s.adjustedSalesCents == null) continue;
      const e = storeAgg.get(s.storeId) ?? { name: s.storeName, count: 0, totalAdj: 0 };
      e.count++;
      e.totalAdj += s.adjustedSalesCents;
      storeAgg.set(s.storeId, e);
    }
    const byStore: StoreBreakdown[] = Array.from(storeAgg.entries()).map(([storeId, e]) => ({
      storeId,
      storeName: e.name,
      shifts: e.count,
      avgAdjustedCents: e.count > 0 ? Math.round(e.totalAdj / e.count) : 0,
    }));

    // ── Transaction count aggregates ─────────────────────────────────────────
    // Only use shifts where transactionCount > 0. Both 0 and null = no data.
    // Dollar metrics (isCountable, avgAdjustedPerShiftCents, etc.) are unaffected.
    const txShifts = shiftSummaries.filter(
      (s) => s.transactionCount != null && s.transactionCount > 0
    );
    const transactionTrackedShifts = txShifts.length;
    const totalTransactions = txShifts.reduce((sum, s) => sum + s.transactionCount!, 0);

    const avgTransactionsPerShift: number | null =
      transactionTrackedShifts > 0
        ? Math.round((totalTransactions / transactionTrackedShifts) * 10) / 10
        : null;

    // Use only the tracked-shift adjusted totals so numerator/denominator match
    const totalAdjTracked = txShifts.reduce(
      (sum, s) => sum + (s.adjustedSalesCents ?? 0),
      0
    );
    const avgSalesPerTransactionCents: number | null =
      transactionTrackedShifts > 0 && totalTransactions > 0
        ? Math.round(totalAdjTracked / totalTransactions)
        : null;

    // ── Projected monthly shifts ──────────────────────────────────────────────
    const projectedMonthly =
      options.projectedMonthlyShifts ?? (countable.length > 0 ? (countable.length / periodDays) * 30 : 0);

    summaries.push({
      employeeId: profileId,
      employeeName: profileNameById.get(profileId) ?? "Unknown",
      primaryStore: computePrimaryStore(shiftSummaries, storeNameById),
      period: { from, to },
      totalShifts: empShifts.length,
      countableShifts: countable.length,
      totalHours: Math.round(totalHours * 100) / 100,
      totalRawSalesCents: totalRaw,
      totalAdjustedSalesCents: totalAdj,
      avgRawPerShiftCents: Math.round(avgRawPerShift),
      avgAdjustedPerShiftCents: Math.round(avgAdjPerShift),
      avgRawPerHourCents: Math.round(avgRawPerHour),
      avgAdjustedPerHourCents: Math.round(avgAdjPerHour),
      highFlagCount: highCount,
      lowFlagCount: lowCount,
      normalFlagCount: normalCount,
      highFlagPct: countable.length > 0 ? Math.round((highCount / countable.length) * 100) : 0,
      lowFlagPct: countable.length > 0 ? Math.round((lowCount / countable.length) * 100) : 0,
      currentStreak: streak,
      transactionTrackedShifts,
      avgTransactionsPerShift,
      avgSalesPerTransactionCents,
      byShiftType,
      byDayOfWeek,
      byStore,
      // Benchmark fields filled in below after all summaries are computed
      benchmarkAdjAvgCents: null,
      gapVsBenchmarkCents: null,
      estimatedMonthlyGapCents: null,
      shifts: shiftSummaries.sort((a, b) => a.date.localeCompare(b.date)),
    });

    // Store projected for benchmark gap calculation (attach to summary after)
    (summaries[summaries.length - 1] as EmployeePeriodSummary & { _projectedMonthly: number })._projectedMonthly = projectedMonthly;
  }

  // ── Benchmark ────────────────────────────────────────────────────────────────
  let benchmarkCents: number | null = null;
  if (options.benchmarkEmployeeIds && options.benchmarkEmployeeIds.length > 0) {
    const benchmarkAvgs = summaries
      .filter((s) => options.benchmarkEmployeeIds!.includes(s.employeeId) && s.avgAdjustedPerShiftCents > 0)
      .map((s) => s.avgAdjustedPerShiftCents);
    benchmarkCents =
      benchmarkAvgs.length > 0
        ? Math.round(benchmarkAvgs.reduce((sum, v) => sum + v, 0) / benchmarkAvgs.length)
        : null;
  }

  // ── Apply benchmark gap ───────────────────────────────────────────────────────
  for (const summary of summaries) {
    const projected = (summary as EmployeePeriodSummary & { _projectedMonthly?: number })._projectedMonthly ?? 0;
    delete (summary as unknown as Record<string, unknown>)._projectedMonthly;

    if (benchmarkCents != null && summary.countableShifts > 0) {
      summary.benchmarkAdjAvgCents = benchmarkCents;
      summary.gapVsBenchmarkCents = summary.avgAdjustedPerShiftCents - benchmarkCents;
      summary.estimatedMonthlyGapCents =
        projected > 0 ? Math.round(summary.gapVsBenchmarkCents * projected) : null;
    }
  }

  return { summaries, benchmarkCents, storeFactors };
}
