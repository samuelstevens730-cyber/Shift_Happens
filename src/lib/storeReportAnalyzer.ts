/**
 * storeReportAnalyzer.ts
 *
 * Aggregates per-store data for the executive store report.
 * Pure computation only (no DB calls).
 */
import { applyScalingFactor, computeScalingFactors, type StoreTotals } from "@/lib/salesNormalization";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type DayName = (typeof DAY_NAMES)[number];

const BAD_WEATHER_KEYWORDS = [
  "rain",
  "drizzle",
  "thunder",
  "storm",
  "snow",
  "sleet",
  "hail",
  "freezing",
  "mist",
  "fog",
  "squall",
] as const;

export interface StoreReportShiftRow {
  id: string;
  store_id: string;
  profile_id: string;
  shift_type: "open" | "close" | "double" | "other";
  planned_start_at: string;
  started_at: string;
  ended_at: string | null;
  last_action: string | null;
  start_weather_condition: string | null;
  start_weather_desc: string | null;
  start_temp_f: number | null;
  end_weather_condition: string | null;
  end_weather_desc: string | null;
  end_temp_f: number | null;
}

export interface StoreReportSalesRow {
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
  open_transaction_count: number | null;
  close_transaction_count: number | null;
}

export interface StoreReportSafeCloseoutRow {
  store_id: string;
  business_date: string;
  status: string;
  cash_sales_cents: number;
  card_sales_cents: number;
  expected_deposit_cents: number;
  actual_deposit_cents: number;
  variance_cents: number;
}

export interface StoreReportStoreRow {
  id: string;
  name: string;
}

export interface StoreReportProfileRow {
  id: string;
  name: string | null;
}

export interface WeatherDay {
  date: string;
  startCondition: string | null;
  startDesc: string | null;
  startTempF: number | null;
  endCondition: string | null;
  endDesc: string | null;
  endTempF: number | null;
}

export interface VelocityEntry {
  label: string;
  avgSalesCents: number;
  avgTransactions: number | null;
  shiftCount: number;
}

export interface WeatherConditionMixEntry {
  condition: string;
  count: number;
  pct: number;
}

export interface WeatherSummary {
  conditionMix: WeatherConditionMixEntry[];
  tempMinF: number | null;
  tempAvgF: number | null;
  tempMaxF: number | null;
  outlierFlags: string[];
  weatherImpactHint: string | null;
}

export interface DailyTrendPoint {
  date: string;
  salesCents: number;
  adjustedSalesCents: number;
  rolling7SalesCents: number;
  adjustedRolling7SalesCents: number;
  laborHours: number;
  rplhCents: number | null;
  adjustedRplhCents: number | null;
  transactions: number | null;
  basketSizeCents: number | null;
  adjustedBasketSizeCents: number | null;
}

export interface DayOfWeekAveragesRow {
  day: DayName;
  avgSalesCents: number | null;
  avgTransactions: number | null;
  avgBasketSizeCents: number | null;
  avgLaborHours: number | null;
  avgRplhCents: number | null;
  sampleDays: number;
}

export interface PerformerMetric {
  employeeId: string;
  employeeName: string;
  value: number;
  shifts: number;
}

export interface TopPerformers {
  volume: {
    totalSales: PerformerMetric | null;
    totalTransactions: PerformerMetric | null;
    totalLaborHours: PerformerMetric | null;
  };
  efficiency: {
    rplh: PerformerMetric | null;
    transactionsPerLaborHour: PerformerMetric | null;
    basketSize: PerformerMetric | null;
  };
}

export interface StorePreviousDeltas {
  grossSalesCents: number | null;
  adjustedGrossSalesCents: number | null;
  totalTransactions: number | null;
  avgBasketSizeCents: number | null;
  rplhCents: number | null;
}

export interface VolatilitySummary {
  stdDevDailySalesCents: number | null;
  coefficientOfVariationPct: number | null;
  belowOneSigmaDays: number;
  aboveOneSigmaDays: number;
  largestUpSwingCents: number | null;
  largestDownSwingCents: number | null;
}

export interface CashRiskSummary {
  varianceDays: number;
  totalVarianceCents: number | null;
  avgVariancePerDayCents: number | null;
  largestSingleDayVarianceCents: number | null;
  varianceRatePct: number | null;
}

export interface ShiftTypeBreakdownRow {
  shiftType: string;
  avgSalesCents: number | null;
  avgTransactions: number | null;
  avgBasketCents: number | null;
  avgRplhCents: number | null;
  sampleSize: number;
}

export interface DataIntegritySummary {
  expectedDays: number;
  missingSalesDays: number;
  missingTransactionDays: number;
  missingLaborDays: number;
  rolloverAdjustedDays: number;
  lateCloseouts: number | null;
  manualOverrides: number | null;
  auditFlagsTriggered: number | null;
}

export interface StorePeriodSummary {
  storeId: string;
  storeName: string;
  periodFrom: string;
  periodTo: string;

  grossSalesCents: number | null;
  adjustedGrossSalesCents: number | null;
  storeScalingFactor: number;
  totalTransactions: number | null;
  avgBasketSizeCents: number | null;
  adjustedAvgBasketSizeCents: number | null;
  totalLaborHours: number;
  rplhCents: number | null;
  adjustedRplhCents: number | null;

  cashSalesCents: number | null;
  cardSalesCents: number | null;
  cashPct: number | null;
  cardPct: number | null;
  depositVarianceCents: number | null;
  safeCloseoutDayCount: number;

  dominantWeatherCondition: string | null;
  weatherTrend: "Stable" | "Volatile" | null;
  weatherDays: WeatherDay[];
  weatherSummary: WeatherSummary;

  bestDay: VelocityEntry | null;
  worstDay: VelocityEntry | null;
  bestShiftType: VelocityEntry | null;

  dailyTrend: DailyTrendPoint[];
  dayOfWeekAverages: DayOfWeekAveragesRow[];
  shiftTypeBreakdown: ShiftTypeBreakdownRow[];
  volatility: VolatilitySummary;
  cashRisk: CashRiskSummary;
  dataIntegrity: DataIntegritySummary;
  topPerformers: TopPerformers;
  previousDeltas: StorePreviousDeltas;
}

function cstDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayNameFromDate(dateStr: string): DayName {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return DAY_NAMES[dt.getUTCDay()];
}

function shiftHours(startAt: string, endedAt: string | null): number {
  if (!endedAt) return 0;
  const ms = new Date(endedAt).getTime() - new Date(startAt).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

function mostFrequent(items: string[]): string | null {
  if (items.length === 0) return null;
  const freq = new Map<string, number>();
  for (const item of items) freq.set(item, (freq.get(item) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of freq.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function normalizeCondition(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function isBadWeatherCondition(value: string | null): boolean {
  const normalized = normalizeCondition(value);
  if (!normalized) return false;
  return BAD_WEATHER_KEYWORDS.some((token) => normalized.includes(token));
}

function grossSalesForDay(row: StoreReportSalesRow): number | null {
  const rolloverCarryIn = row.rollover_from_previous_cents ?? 0;
  const rolloverCarryOut =
    Boolean(row.is_rollover_night) && row.closer_rollover_cents != null
      ? row.closer_rollover_cents
      : 0;
  const pmSales = row.close_sales_cents;
  const amSales =
    row.open_x_report_cents != null
      ? row.open_x_report_cents - rolloverCarryIn
      : null;

  if (amSales != null && pmSales != null) return amSales + pmSales + rolloverCarryOut;
  // If AM side is missing but Z is present, prefer Z-based reconstruction to
  // avoid undercounting full-day sales (common on some double-shift records).
  if (amSales == null && row.z_report_cents != null) {
    return row.z_report_cents - rolloverCarryIn + rolloverCarryOut;
  }
  if (pmSales != null) return pmSales + rolloverCarryOut;
  if (amSales != null) return amSales + rolloverCarryOut;
  if (row.z_report_cents != null) return row.z_report_cents - rolloverCarryIn + rolloverCarryOut;
  return null;
}

function transactionsForDay(row: StoreReportSalesRow): number | null {
  const openTxn = row.open_transaction_count ?? 0;
  const closeTxn = row.close_transaction_count ?? 0;
  const total = openTxn + closeTxn;
  return total > 0 ? total : null;
}

function computeShiftSalesCents(shiftType: string, salesRow: StoreReportSalesRow | null): number | null {
  if (!salesRow) return null;
  const rolloverFromPrev = salesRow.rollover_from_previous_cents ?? 0;
  const openX = salesRow.open_x_report_cents;
  const closeSales = salesRow.close_sales_cents;
  const zReport = salesRow.z_report_cents;
  const carryOut = Boolean(salesRow.is_rollover_night) ? salesRow.closer_rollover_cents ?? 0 : 0;

  if (shiftType === "open") {
    return openX != null ? openX - rolloverFromPrev : null;
  }
  if (shiftType === "close" || shiftType === "double") {
    const baseClose = closeSales ?? (zReport != null && openX != null ? zReport - openX : null);
    return baseClose != null ? baseClose + carryOut : null;
  }
  return null;
}

function computeShiftTransactions(shiftType: string, salesRow: StoreReportSalesRow | null): number | null {
  if (!salesRow) return null;
  if (shiftType === "open") {
    return salesRow.open_transaction_count != null && salesRow.open_transaction_count > 0
      ? salesRow.open_transaction_count
      : null;
  }
  if (shiftType === "close") {
    return salesRow.close_transaction_count != null && salesRow.close_transaction_count > 0
      ? salesRow.close_transaction_count
      : null;
  }
  if (shiftType === "double") {
    const total = (salesRow.open_transaction_count ?? 0) + (salesRow.close_transaction_count ?? 0);
    return total > 0 ? total : null;
  }
  return null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${start}T00:00:00.000Z`);
  const stop = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= stop) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function pickTopMetric<T>(
  entries: T[],
  valueSelector: (entry: T) => number | null,
  toMetric: (entry: T, value: number) => PerformerMetric
): PerformerMetric | null {
  let winner: PerformerMetric | null = null;
  for (const entry of entries) {
    const value = valueSelector(entry);
    if (value == null) continue;
    if (!winner || value > winner.value) {
      winner = toMetric(entry, value);
    }
  }
  return winner;
}

interface DayRollup {
  salesCents: number;
  transactions: number | null;
  laborHours: number;
}

interface EmployeeRollup {
  employeeId: string;
  employeeName: string;
  shifts: number;
  totalSalesCents: number;
  totalSalesWithTxnCents: number;
  totalTransactions: number;
  transactionShiftCount: number;
  totalLaborHours: number;
}

interface ShiftTypeRollup {
  shiftType: string;
  sampleSize: number;
  totalSalesCents: number;
  totalSalesWithTxnCents: number;
  totalTransactions: number;
  transactionSamples: number;
  totalLaborHours: number;
}

function analyzeStoreDataForWindow(
  shifts: StoreReportShiftRow[],
  salesRecords: StoreReportSalesRow[],
  safeCloseouts: StoreReportSafeCloseoutRow[],
  stores: StoreReportStoreRow[],
  profiles: StoreReportProfileRow[],
  periodFrom: string,
  periodTo: string
): StorePeriodSummary[] {
  const activeShifts = shifts.filter((shift) => shift.last_action !== "removed");
  const salesByStore = new Map<string, StoreReportSalesRow[]>();
  for (const row of salesRecords) {
    const rows = salesByStore.get(row.store_id) ?? [];
    rows.push(row);
    salesByStore.set(row.store_id, rows);
  }

  // Build normalization factors using the same per-shift math as employee analytics.
  const storeTotals: StoreTotals[] = stores.map((store) => {
    const storeShifts = activeShifts.filter((shift) => shift.store_id === store.id && shift.ended_at != null);
    const storeSales = salesByStore.get(store.id) ?? [];
    const byOpen = new Map<string, StoreReportSalesRow>();
    const byClose = new Map<string, StoreReportSalesRow>();
    const byDate = new Map<string, StoreReportSalesRow>();
    for (const row of storeSales) {
      if (row.open_shift_id) byOpen.set(row.open_shift_id, row);
      if (row.close_shift_id) byClose.set(row.close_shift_id, row);
      byDate.set(row.business_date, row);
    }
    let totalSalesCents = 0;
    let shiftCount = 0;
    for (const shift of storeShifts) {
      const date = cstDateKey(shift.planned_start_at);
      const row = byOpen.get(shift.id) ?? byClose.get(shift.id) ?? byDate.get(date) ?? null;
      const sales = computeShiftSalesCents(shift.shift_type, row);
      if (sales != null) {
        totalSalesCents += sales;
        shiftCount += 1;
      }
    }
    return { storeId: store.id, totalSalesCents, shiftCount };
  });
  const storeFactors = computeScalingFactors(storeTotals);

  const profileNameById = new Map(
    profiles.map((profile) => [profile.id, profile.name?.trim() || "Unknown"])
  );

  return stores.map((store) => {
    const storeShifts = shifts.filter(
      (shift) => shift.store_id === store.id && shift.last_action !== "removed"
    );
    const storeSales = salesRecords.filter((row) => row.store_id === store.id);
    const storeCloseouts = safeCloseouts.filter(
      (closeout) => closeout.store_id === store.id && closeout.status !== "draft"
    );

    const salesByOpenShiftId = new Map<string, StoreReportSalesRow>();
    const salesByCloseShiftId = new Map<string, StoreReportSalesRow>();
    const salesByDate = new Map<string, StoreReportSalesRow>();
    for (const row of storeSales) {
      if (row.open_shift_id) salesByOpenShiftId.set(row.open_shift_id, row);
      if (row.close_shift_id) salesByCloseShiftId.set(row.close_shift_id, row);
      salesByDate.set(row.business_date, row);
    }

    const closeoutSalesByDate = new Map<string, number>();
    const closeoutVarianceByDate = new Map<string, number>();
    for (const closeout of storeCloseouts) {
      closeoutSalesByDate.set(
        closeout.business_date,
        (closeoutSalesByDate.get(closeout.business_date) ?? 0) +
          closeout.cash_sales_cents +
          closeout.card_sales_cents
      );
      closeoutVarianceByDate.set(
        closeout.business_date,
        (closeoutVarianceByDate.get(closeout.business_date) ?? 0) + closeout.variance_cents
      );
    }

    const grossByDate = new Map<string, number>();
    const adjustedGrossByDate = new Map<string, number>();
    const txByDate = new Map<string, number>();
    const factor = storeFactors.get(store.id) ?? 1;
    for (const row of storeSales) {
      const daySales = grossSalesForDay(row);
      if (daySales != null) {
        grossByDate.set(row.business_date, daySales);
        adjustedGrossByDate.set(row.business_date, applyScalingFactor(daySales, store.id, storeFactors));
      }
      const dayTxn = transactionsForDay(row);
      if (dayTxn != null) txByDate.set(row.business_date, dayTxn);
    }
    for (const [date, closeoutSales] of closeoutSalesByDate.entries()) {
      if (!grossByDate.has(date)) {
        grossByDate.set(date, closeoutSales);
        adjustedGrossByDate.set(date, applyScalingFactor(closeoutSales, store.id, storeFactors));
      }
    }

    const laborHoursByDate = new Map<string, number>();
    for (const shift of storeShifts) {
      const date = cstDateKey(shift.planned_start_at);
      // Labor math uses planned start + manual end-at (ended_at), not submission timestamps.
      const hrs = shiftHours(shift.planned_start_at, shift.ended_at);
      laborHoursByDate.set(date, (laborHoursByDate.get(date) ?? 0) + hrs);
    }

    let grossSalesCents: number | null = null;
    let adjustedGrossSalesCents: number | null = null;
    for (const value of grossByDate.values()) {
      grossSalesCents = (grossSalesCents ?? 0) + value;
    }
    for (const value of adjustedGrossByDate.values()) {
      adjustedGrossSalesCents = (adjustedGrossSalesCents ?? 0) + value;
    }

    let totalTransactions: number | null = null;
    for (const value of txByDate.values()) {
      totalTransactions = (totalTransactions ?? 0) + value;
    }

    let txTrackedGrossSalesCents: number | null = null;
    let txTrackedAdjustedGrossSalesCents: number | null = null;
    for (const date of txByDate.keys()) {
      const sales = grossByDate.get(date);
      if (sales != null) txTrackedGrossSalesCents = (txTrackedGrossSalesCents ?? 0) + sales;
      const adjustedSales = adjustedGrossByDate.get(date);
      if (adjustedSales != null) {
        txTrackedAdjustedGrossSalesCents = (txTrackedAdjustedGrossSalesCents ?? 0) + adjustedSales;
      }
    }

    const totalLaborHours = storeShifts.reduce(
      (sum, shift) => sum + shiftHours(shift.planned_start_at, shift.ended_at),
      0
    );

    const avgBasketSizeCents =
      txTrackedGrossSalesCents != null && totalTransactions != null && totalTransactions > 0
        ? Math.round(txTrackedGrossSalesCents / totalTransactions)
        : null;
    const adjustedAvgBasketSizeCents =
      txTrackedAdjustedGrossSalesCents != null && totalTransactions != null && totalTransactions > 0
        ? Math.round(txTrackedAdjustedGrossSalesCents / totalTransactions)
        : null;
    const rplhCents =
      grossSalesCents != null && totalLaborHours > 0
        ? Math.round(grossSalesCents / totalLaborHours)
        : null;
    const adjustedRplhCents =
      adjustedGrossSalesCents != null && totalLaborHours > 0
        ? Math.round(adjustedGrossSalesCents / totalLaborHours)
        : null;

    let cashSalesCents: number | null = null;
    let cardSalesCents: number | null = null;
    let depositVarianceCents: number | null = null;
    const safeCloseoutDayCount = storeCloseouts.length;
    for (const closeout of storeCloseouts) {
      cashSalesCents = (cashSalesCents ?? 0) + closeout.cash_sales_cents;
      cardSalesCents = (cardSalesCents ?? 0) + closeout.card_sales_cents;
      depositVarianceCents = (depositVarianceCents ?? 0) + closeout.variance_cents;
    }

    const totalPayment =
      cashSalesCents != null && cardSalesCents != null
        ? cashSalesCents + cardSalesCents
        : null;
    const cashPct =
      totalPayment != null && totalPayment > 0 && cashSalesCents != null
        ? Math.round((cashSalesCents / totalPayment) * 100)
        : null;
    const cardPct =
      totalPayment != null && totalPayment > 0 && cardSalesCents != null
        ? Math.round((cardSalesCents / totalPayment) * 100)
        : null;
    const varianceEntries = [...closeoutVarianceByDate.values()];
    const varianceDays = varianceEntries.filter((value) => value !== 0).length;
    const totalVarianceCents =
      varianceEntries.length > 0 ? varianceEntries.reduce((sum, value) => sum + value, 0) : null;
    const avgVariancePerDayCents =
      varianceEntries.length > 0 && totalVarianceCents != null
        ? Math.round(totalVarianceCents / varianceEntries.length)
        : null;
    const largestSingleDayVarianceCents =
      varianceEntries.length > 0
        ? varianceEntries.reduce((max, value) => (Math.abs(value) > Math.abs(max) ? value : max), varianceEntries[0])
        : null;
    const varianceRatePct =
      varianceEntries.length > 0 ? Math.round((varianceDays / varianceEntries.length) * 100) : null;

    const cashRisk: CashRiskSummary = {
      varianceDays,
      totalVarianceCents,
      avgVariancePerDayCents,
      largestSingleDayVarianceCents,
      varianceRatePct,
    };

    const weatherByDate = new Map<string, WeatherDay>();
    for (const shift of storeShifts) {
      if (shift.start_weather_condition == null && shift.end_weather_condition == null) continue;
      const date = cstDateKey(shift.planned_start_at);
      const existing = weatherByDate.get(date);
      if (!existing) {
        weatherByDate.set(date, {
          date,
          startCondition: shift.start_weather_condition,
          startDesc: shift.start_weather_desc,
          startTempF: shift.start_temp_f,
          endCondition: shift.end_weather_condition,
          endDesc: shift.end_weather_desc,
          endTempF: shift.end_temp_f,
        });
      } else if (existing.endCondition == null && shift.end_weather_condition != null) {
        weatherByDate.set(date, {
          ...existing,
          endCondition: shift.end_weather_condition,
          endDesc: shift.end_weather_desc,
          endTempF: shift.end_temp_f,
        });
      }
    }
    const weatherDays = [...weatherByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const allConditions = weatherDays
      .flatMap((day) => [day.startCondition, day.endCondition])
      .filter((cond): cond is string => cond != null);
    const dominantWeatherCondition = mostFrequent(allConditions);
    const weatherTrend: StorePeriodSummary["weatherTrend"] =
      allConditions.length === 0 ? null : new Set(allConditions).size >= 3 ? "Volatile" : "Stable";

    const normalizedConditions = allConditions
      .map((value) => normalizeCondition(value))
      .filter((value): value is string => value != null);
    const conditionCounts = new Map<string, number>();
    for (const condition of normalizedConditions) {
      conditionCounts.set(condition, (conditionCounts.get(condition) ?? 0) + 1);
    }
    const conditionMix = [...conditionCounts.entries()]
      .map(([condition, count]) => ({
        condition,
        count,
        pct: Math.round((count / normalizedConditions.length) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    const tempValues = weatherDays
      .flatMap((day) => [day.startTempF, day.endTempF])
      .filter((temp): temp is number => temp != null);
    const tempMinF = tempValues.length > 0 ? Math.min(...tempValues) : null;
    const tempMaxF = tempValues.length > 0 ? Math.max(...tempValues) : null;
    const tempAvgF =
      tempValues.length > 0
        ? round1(tempValues.reduce((sum, temp) => sum + temp, 0) / tempValues.length)
        : null;

    const badWeatherDates = new Set(
      weatherDays
        .filter((day) => {
          const startIsBad = isBadWeatherCondition(day.startDesc ?? day.startCondition);
          const endIsBad = isBadWeatherCondition(day.endDesc ?? day.endCondition);
          return startIsBad || endIsBad;
        })
        .map((day) => day.date)
    );

    let sharpTempSwingDays = 0;
    for (const day of weatherDays) {
      if (day.startTempF == null || day.endTempF == null) continue;
      if (Math.abs(day.endTempF - day.startTempF) >= 18) sharpTempSwingDays += 1;
    }

    const outlierFlags: string[] = [];
    if (badWeatherDates.size >= 3) {
      outlierFlags.push(`${badWeatherDates.size} days had rain/storm/fog conditions.`);
    }
    if (tempMinF != null && tempMaxF != null && tempMaxF - tempMinF >= 25) {
      outlierFlags.push(`Temperature swing reached ${round1(tempMaxF - tempMinF)}F in this period.`);
    }
    if (sharpTempSwingDays >= 2) {
      outlierFlags.push(`${sharpTempSwingDays} days had intraday temperature swings >= 18F.`);
    }

    const avgDailySales =
      grossByDate.size > 0
        ? [...grossByDate.values()].reduce((sum, sales) => sum + sales, 0) / grossByDate.size
        : null;
    const lowAndBadDays =
      avgDailySales != null
        ? [...grossByDate.entries()].filter(
            ([date, sales]) => badWeatherDates.has(date) && sales < avgDailySales * 0.85
          ).length
        : 0;
    const weatherImpactHint =
      lowAndBadDays > 0
        ? `${lowAndBadDays} low-sales day(s) aligned with poor weather signals.`
        : null;

    const weatherSummary: WeatherSummary = {
      conditionMix,
      tempMinF,
      tempAvgF,
      tempMaxF,
      outlierFlags,
      weatherImpactHint,
    };

    const byDay = new Map<
      DayName,
      { totalSales: number; totalTxn: number; txnDays: number; count: number }
    >();
    const byShiftType = new Map<
      string,
      { totalSales: number; totalTxn: number; txnDays: number; count: number }
    >();
    const shiftTypeRollups = new Map<string, ShiftTypeRollup>();
    for (const row of storeSales) {
      const sales = grossSalesForDay(row);
      if (sales == null) continue;
      const dayName = dayNameFromDate(row.business_date);
      const txn = transactionsForDay(row);

      const dayEntry = byDay.get(dayName) ?? { totalSales: 0, totalTxn: 0, txnDays: 0, count: 0 };
      dayEntry.totalSales += sales;
      dayEntry.count += 1;
      if (txn != null) {
        dayEntry.totalTxn += txn;
        dayEntry.txnDays += 1;
      }
      byDay.set(dayName, dayEntry);
    }

    for (const shift of storeShifts) {
      if (!shift.ended_at) continue;
      const date = cstDateKey(shift.planned_start_at);
      const salesRow =
        salesByOpenShiftId.get(shift.id) ??
        salesByCloseShiftId.get(shift.id) ??
        salesByDate.get(date) ??
        null;
      const sales = computeShiftSalesCents(shift.shift_type, salesRow);
      if (sales == null) continue;
      const txn = computeShiftTransactions(shift.shift_type, salesRow);
      const labor = shiftHours(shift.planned_start_at, shift.ended_at);

      const typeEntry = byShiftType.get(shift.shift_type) ?? {
        totalSales: 0,
        totalTxn: 0,
        txnDays: 0,
        count: 0,
      };
      typeEntry.totalSales += sales;
      typeEntry.count += 1;
      if (txn != null) {
        typeEntry.totalTxn += txn;
        typeEntry.txnDays += 1;
      }
      byShiftType.set(shift.shift_type, typeEntry);

      const typeRollup = shiftTypeRollups.get(shift.shift_type) ?? {
        shiftType: shift.shift_type,
        sampleSize: 0,
        totalSalesCents: 0,
        totalSalesWithTxnCents: 0,
        totalTransactions: 0,
        transactionSamples: 0,
        totalLaborHours: 0,
      };
      typeRollup.sampleSize += 1;
      typeRollup.totalSalesCents += sales;
      typeRollup.totalLaborHours += labor;
      if (txn != null) {
        typeRollup.totalSalesWithTxnCents += sales;
        typeRollup.totalTransactions += txn;
        typeRollup.transactionSamples += 1;
      }
      shiftTypeRollups.set(shift.shift_type, typeRollup);
    }

    function toVelocityEntry(
      label: string,
      entry: { totalSales: number; totalTxn: number; txnDays: number; count: number }
    ): VelocityEntry {
      return {
        label,
        avgSalesCents: entry.count > 0 ? Math.round(entry.totalSales / entry.count) : 0,
        avgTransactions: entry.txnDays > 0 ? Math.round(entry.totalTxn / entry.txnDays) : null,
        shiftCount: entry.count,
      };
    }

    const dayEntries = [...byDay.entries()]
      .filter(([, entry]) => entry.count > 0)
      .map(([label, entry]) => toVelocityEntry(label, entry))
      .sort((a, b) => b.avgSalesCents - a.avgSalesCents);

    const shiftEntries = [...byShiftType.entries()]
      .filter(([, entry]) => entry.count > 0)
      .map(([label, entry]) => toVelocityEntry(label, entry))
      .sort((a, b) => b.avgSalesCents - a.avgSalesCents);

    const shiftTypeBreakdown: ShiftTypeBreakdownRow[] = [...shiftTypeRollups.values()]
      .map((row) => {
        const avgSalesCents = row.sampleSize > 0 ? Math.round(row.totalSalesCents / row.sampleSize) : null;
        const avgTransactions =
          row.transactionSamples > 0 ? round1(row.totalTransactions / row.transactionSamples) : null;
        const avgBasketCents =
          row.totalTransactions > 0 ? Math.round(row.totalSalesWithTxnCents / row.totalTransactions) : null;
        const avgRplhCents =
          row.totalLaborHours > 0 ? Math.round(row.totalSalesCents / row.totalLaborHours) : null;
        return {
          shiftType: row.shiftType,
          avgSalesCents,
          avgTransactions,
          avgBasketCents,
          avgRplhCents,
          sampleSize: row.sampleSize,
        };
      })
      .sort((a, b) => (b.avgSalesCents ?? 0) - (a.avgSalesCents ?? 0));

    const dailyRollups = new Map<string, DayRollup>();
    for (const [date, sales] of grossByDate.entries()) {
      dailyRollups.set(date, {
        salesCents: sales,
        transactions: txByDate.get(date) ?? null,
        laborHours: laborHoursByDate.get(date) ?? 0,
      });
    }
    for (const [date, labor] of laborHoursByDate.entries()) {
      if (!dailyRollups.has(date)) {
        dailyRollups.set(date, {
          salesCents: closeoutSalesByDate.get(date) ?? 0,
          transactions: txByDate.get(date) ?? null,
          laborHours: labor,
        });
      }
    }

    const sortedDates = [...dailyRollups.keys()].sort((a, b) => a.localeCompare(b));
    const dailyTrend: DailyTrendPoint[] = [];
    for (let idx = 0; idx < sortedDates.length; idx += 1) {
      const date = sortedDates[idx];
      const rollup = dailyRollups.get(date);
      if (!rollup) continue;
      const windowStart = Math.max(0, idx - 6);
      const window = sortedDates.slice(windowStart, idx + 1);
      const rollingSales = window.reduce(
        (sum, itemDate) => sum + (dailyRollups.get(itemDate)?.salesCents ?? 0),
        0
      );
      const rolling7SalesCents = Math.round(rollingSales / window.length);
      const adjustedSalesCents = adjustedGrossByDate.get(date) ?? applyScalingFactor(rollup.salesCents, store.id, storeFactors);
      const adjustedRollingSales = window.reduce(
        (sum, itemDate) =>
          sum + (adjustedGrossByDate.get(itemDate) ?? applyScalingFactor(dailyRollups.get(itemDate)?.salesCents ?? 0, store.id, storeFactors)),
        0
      );
      const adjustedRolling7SalesCents = Math.round(adjustedRollingSales / window.length);
      const rplh = rollup.laborHours > 0 ? Math.round(rollup.salesCents / rollup.laborHours) : null;
      const adjustedRplh = rollup.laborHours > 0 ? Math.round(adjustedSalesCents / rollup.laborHours) : null;
      const basket =
        rollup.transactions != null && rollup.transactions > 0
          ? Math.round(rollup.salesCents / rollup.transactions)
          : null;
      const adjustedBasket =
        rollup.transactions != null && rollup.transactions > 0
          ? Math.round(adjustedSalesCents / rollup.transactions)
          : null;

      dailyTrend.push({
        date,
        salesCents: rollup.salesCents,
        adjustedSalesCents,
        rolling7SalesCents,
        adjustedRolling7SalesCents,
        laborHours: round1(rollup.laborHours),
        rplhCents: rplh,
        adjustedRplhCents: adjustedRplh,
        transactions: rollup.transactions,
        basketSizeCents: basket,
        adjustedBasketSizeCents: adjustedBasket,
      });
    }

    const dayOfWeekBuckets = new Map<
      DayName,
      {
        sampleDays: number;
        totalSales: number;
        salesDays: number;
        totalTxn: number;
        txnDays: number;
        totalDailyBasket: number;
        basketDays: number;
        totalLabor: number;
        laborDays: number;
        totalRplh: number;
        rplhDays: number;
      }
    >();
    for (const day of DAY_NAMES) {
      dayOfWeekBuckets.set(day, {
        sampleDays: 0,
        totalSales: 0,
        salesDays: 0,
        totalTxn: 0,
        txnDays: 0,
        totalDailyBasket: 0,
        basketDays: 0,
        totalLabor: 0,
        laborDays: 0,
        totalRplh: 0,
        rplhDays: 0,
      });
    }
    for (const [date, rollup] of dailyRollups.entries()) {
      const day = dayNameFromDate(date);
      const bucket = dayOfWeekBuckets.get(day);
      if (!bucket) continue;
      bucket.sampleDays += 1;
      bucket.totalSales += rollup.salesCents;
      bucket.salesDays += 1;
      if (rollup.transactions != null) {
        bucket.totalTxn += rollup.transactions;
        bucket.txnDays += 1;
      }
      if (rollup.transactions != null && rollup.transactions > 0) {
        bucket.totalDailyBasket += rollup.salesCents / rollup.transactions;
        bucket.basketDays += 1;
      }
      bucket.totalLabor += rollup.laborHours;
      bucket.laborDays += 1;
      if (rollup.laborHours > 0) {
        bucket.totalRplh += rollup.salesCents / rollup.laborHours;
        bucket.rplhDays += 1;
      }
    }
    const dayOfWeekAverages: DayOfWeekAveragesRow[] = DAY_NAMES.map((day) => {
      const bucket = dayOfWeekBuckets.get(day);
      if (!bucket || bucket.sampleDays === 0) {
        return {
          day,
          avgSalesCents: null,
          avgTransactions: null,
          avgBasketSizeCents: null,
          avgLaborHours: null,
          avgRplhCents: null,
          sampleDays: 0,
        };
      }
      return {
        day,
        avgSalesCents: bucket.salesDays > 0 ? Math.round(bucket.totalSales / bucket.salesDays) : null,
        avgTransactions: bucket.txnDays > 0 ? round1(bucket.totalTxn / bucket.txnDays) : null,
        avgBasketSizeCents:
          bucket.basketDays > 0 ? Math.round(bucket.totalDailyBasket / bucket.basketDays) : null,
        avgLaborHours: bucket.laborDays > 0 ? round1(bucket.totalLabor / bucket.laborDays) : null,
        avgRplhCents: bucket.rplhDays > 0 ? Math.round(bucket.totalRplh / bucket.rplhDays) : null,
        sampleDays: bucket.sampleDays,
      };
    });

    let volatility: VolatilitySummary = {
      stdDevDailySalesCents: null,
      coefficientOfVariationPct: null,
      belowOneSigmaDays: 0,
      aboveOneSigmaDays: 0,
      largestUpSwingCents: null,
      largestDownSwingCents: null,
    };
    const salesSeries = sortedDates.map((date) => dailyRollups.get(date)?.salesCents ?? 0);
    if (salesSeries.length > 0) {
      const mean = salesSeries.reduce((sum, value) => sum + value, 0) / salesSeries.length;
      const variance =
        salesSeries.reduce((sum, value) => sum + (value - mean) ** 2, 0) / salesSeries.length;
      const stdDev = Math.sqrt(variance);
      const belowThreshold = mean - stdDev;
      const aboveThreshold = mean + stdDev;
      let largestUpSwing = Number.NEGATIVE_INFINITY;
      let largestDownSwing = Number.POSITIVE_INFINITY;
      for (let idx = 1; idx < salesSeries.length; idx += 1) {
        const delta = salesSeries[idx] - salesSeries[idx - 1];
        if (delta > largestUpSwing) largestUpSwing = delta;
        if (delta < largestDownSwing) largestDownSwing = delta;
      }

      volatility = {
        stdDevDailySalesCents: Math.round(stdDev),
        coefficientOfVariationPct: mean !== 0 ? round1((stdDev / mean) * 100) : null,
        belowOneSigmaDays: salesSeries.filter((value) => value < belowThreshold).length,
        aboveOneSigmaDays: salesSeries.filter((value) => value > aboveThreshold).length,
        largestUpSwingCents:
          salesSeries.length > 1 && largestUpSwing !== Number.NEGATIVE_INFINITY
            ? Math.round(largestUpSwing)
            : null,
        largestDownSwingCents:
          salesSeries.length > 1 && largestDownSwing !== Number.POSITIVE_INFINITY
            ? Math.round(largestDownSwing)
            : null,
      };
    }

    const expectedDates = dateRange(periodFrom, periodTo);
    const expectedDateSet = new Set(expectedDates);
    const salesDateSet = new Set(grossByDate.keys());
    const missingSalesDays = expectedDates.filter((date) => !salesDateSet.has(date)).length;
    const missingTransactionDays = expectedDates.filter(
      (date) => salesDateSet.has(date) && !txByDate.has(date)
    ).length;
    const missingLaborDays = expectedDates.filter((date) => {
      if (!salesDateSet.has(date)) return false;
      const labor = laborHoursByDate.get(date);
      return labor == null || labor <= 0;
    }).length;
    const rolloverAdjustedDays = new Set(
      storeSales
        .filter(
          (row) =>
            (row.rollover_from_previous_cents ?? 0) > 0 ||
            (Boolean(row.is_rollover_night) && (row.closer_rollover_cents ?? 0) > 0)
        )
        .map((row) => row.business_date)
        .filter((date) => expectedDateSet.has(date))
    ).size;

    const dataIntegrity: DataIntegritySummary = {
      expectedDays: expectedDates.length,
      missingSalesDays,
      missingTransactionDays,
      missingLaborDays,
      rolloverAdjustedDays,
      lateCloseouts: null,
      manualOverrides: null,
      auditFlagsTriggered: null,
    };

    const employeeMap = new Map<string, EmployeeRollup>();
    for (const shift of storeShifts) {
      if (!shift.ended_at) continue;
      const date = cstDateKey(shift.planned_start_at);
      const salesRow =
        salesByOpenShiftId.get(shift.id) ??
        salesByCloseShiftId.get(shift.id) ??
        salesByDate.get(date) ??
        null;
      const sales = computeShiftSalesCents(shift.shift_type, salesRow);
      const txn = computeShiftTransactions(shift.shift_type, salesRow);
      const labor = shiftHours(shift.planned_start_at, shift.ended_at);

      const current =
        employeeMap.get(shift.profile_id) ??
        {
          employeeId: shift.profile_id,
          employeeName: profileNameById.get(shift.profile_id) ?? "Unknown",
          shifts: 0,
          totalSalesCents: 0,
          totalSalesWithTxnCents: 0,
          totalTransactions: 0,
          transactionShiftCount: 0,
          totalLaborHours: 0,
        };
      current.shifts += 1;
      if (sales != null) current.totalSalesCents += sales;
      if (txn != null) {
        if (sales != null) current.totalSalesWithTxnCents += sales;
        current.totalTransactions += txn;
        current.transactionShiftCount += 1;
      }
      current.totalLaborHours += labor;
      employeeMap.set(shift.profile_id, current);
    }
    const employeeRollups = [...employeeMap.values()];
    const topPerformers: TopPerformers = {
      volume: {
        totalSales: pickTopMetric(
          employeeRollups,
          (entry) => (entry.totalSalesCents > 0 ? entry.totalSalesCents : null),
          (entry, value) => ({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            value,
            shifts: entry.shifts,
          })
        ),
        totalTransactions: pickTopMetric(
          employeeRollups,
          (entry) => (entry.totalTransactions > 0 ? entry.totalTransactions : null),
          (entry, value) => ({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            value,
            shifts: entry.shifts,
          })
        ),
        totalLaborHours: pickTopMetric(
          employeeRollups,
          (entry) => (entry.totalLaborHours > 0 ? entry.totalLaborHours : null),
          (entry, value) => ({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            value: Math.round(value * 100) / 100,
            shifts: entry.shifts,
          })
        ),
      },
      efficiency: {
        rplh: pickTopMetric(
          employeeRollups,
          (entry) =>
            entry.totalSalesCents > 0 && entry.totalLaborHours > 0
              ? entry.totalSalesCents / entry.totalLaborHours
              : null,
          (entry, value) => ({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            value: Math.round(value),
            shifts: entry.shifts,
          })
        ),
        transactionsPerLaborHour: pickTopMetric(
          employeeRollups,
          (entry) =>
            entry.totalTransactions > 0 && entry.totalLaborHours > 0
              ? entry.totalTransactions / entry.totalLaborHours
              : null,
          (entry, value) => ({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            value: round1(value),
            shifts: entry.shifts,
          })
        ),
        basketSize: pickTopMetric(
          employeeRollups,
          (entry) =>
            entry.totalSalesWithTxnCents > 0 && entry.totalTransactions > 0
              ? entry.totalSalesWithTxnCents / entry.totalTransactions
              : null,
          (entry, value) => ({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            value: Math.round(value),
            shifts: entry.shifts,
          })
        ),
      },
    };

    return {
      storeId: store.id,
      storeName: store.name,
      periodFrom,
      periodTo,

      grossSalesCents,
      adjustedGrossSalesCents,
      storeScalingFactor: round1(factor),
      totalTransactions,
      avgBasketSizeCents,
      adjustedAvgBasketSizeCents,
      totalLaborHours: round1(totalLaborHours),
      rplhCents,
      adjustedRplhCents,

      cashSalesCents,
      cardSalesCents,
      cashPct,
      cardPct,
      depositVarianceCents,
      safeCloseoutDayCount,

      dominantWeatherCondition,
      weatherTrend,
      weatherDays,
      weatherSummary,

      bestDay: dayEntries[0] ?? null,
      worstDay: dayEntries[dayEntries.length - 1] ?? null,
      bestShiftType: shiftEntries[0] ?? null,

      dailyTrend,
      dayOfWeekAverages,
      shiftTypeBreakdown,
      volatility,
      cashRisk,
      dataIntegrity,
      topPerformers,
      previousDeltas: {
        grossSalesCents: null,
        adjustedGrossSalesCents: null,
        totalTransactions: null,
        avgBasketSizeCents: null,
        rplhCents: null,
      },
    };
  });
}

function inDateRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function cstShiftDate(shift: StoreReportShiftRow): string {
  return cstDateKey(shift.planned_start_at);
}

function delta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}

export function analyzeStoreData(
  shifts: StoreReportShiftRow[],
  salesRecords: StoreReportSalesRow[],
  safeCloseouts: StoreReportSafeCloseoutRow[],
  stores: StoreReportStoreRow[],
  profiles: StoreReportProfileRow[],
  periodFrom: string,
  periodTo: string,
  previousFrom?: string
): StorePeriodSummary[] {
  const currentShifts = shifts.filter((shift) => inDateRange(cstShiftDate(shift), periodFrom, periodTo));
  const currentSales = salesRecords.filter((row) => inDateRange(row.business_date, periodFrom, periodTo));
  const currentCloseouts = safeCloseouts.filter((row) => inDateRange(row.business_date, periodFrom, periodTo));

  const currentSummaries = analyzeStoreDataForWindow(
    currentShifts,
    currentSales,
    currentCloseouts,
    stores,
    profiles,
    periodFrom,
    periodTo
  );

  if (!previousFrom) return currentSummaries;

  const prevToExclusive = periodFrom;
  const previousShifts = shifts.filter((shift) => {
    const date = cstShiftDate(shift);
    return date >= previousFrom && date < prevToExclusive;
  });
  const previousSales = salesRecords.filter(
    (row) => row.business_date >= previousFrom && row.business_date < prevToExclusive
  );
  const previousCloseouts = safeCloseouts.filter(
    (row) => row.business_date >= previousFrom && row.business_date < prevToExclusive
  );

  const previousSummaries = analyzeStoreDataForWindow(
    previousShifts,
    previousSales,
    previousCloseouts,
    stores,
    profiles,
    previousFrom,
    periodFrom
  );

  const previousByStoreId = new Map(previousSummaries.map((summary) => [summary.storeId, summary]));

  return currentSummaries.map((summary) => {
    const prev = previousByStoreId.get(summary.storeId);
    return {
      ...summary,
      previousDeltas: {
        grossSalesCents: delta(summary.grossSalesCents, prev?.grossSalesCents ?? null),
        adjustedGrossSalesCents: delta(
          summary.adjustedGrossSalesCents,
          prev?.adjustedGrossSalesCents ?? null
        ),
        totalTransactions: delta(summary.totalTransactions, prev?.totalTransactions ?? null),
        avgBasketSizeCents: delta(summary.avgBasketSizeCents, prev?.avgBasketSizeCents ?? null),
        rplhCents: delta(summary.rplhCents, prev?.rplhCents ?? null),
      },
    };
  });
}
