/**
 * storeReportAnalyzer.ts
 *
 * Aggregates per-store data for the executive store report.
 * Pure computation — no DB access. The API route fetches all raw data;
 * this module crunches it and returns structured StorePeriodSummary objects.
 */

// ─── Input Row Types ───────────────────────────────────────────────────────────

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
  start_weather_desc:      string | null;
  start_temp_f: number | null;
  end_weather_condition: string | null;
  end_weather_desc:      string | null;
  end_temp_f: number | null;
}

export interface StoreReportSalesRow {
  store_id: string;
  business_date: string;           // YYYY-MM-DD
  open_x_report_cents: number | null;
  close_sales_cents: number | null; // PM-only net (z - priorX); most reliable per-shift figure
  z_report_cents: number | null;
  rollover_from_previous_cents: number | null;
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

// ─── Output Types ──────────────────────────────────────────────────────────────

export interface WeatherDay {
  date: string;                       // YYYY-MM-DD
  startCondition: string | null;
  startDesc:      string | null;      // detailed OWM description (e.g. "clear sky")
  startTempF: number | null;
  endCondition: string | null;
  endDesc:        string | null;      // detailed OWM description at clock-out
  endTempF: number | null;
}

export interface VelocityEntry {
  label: string;                      // day name or shift type
  avgSalesCents: number;
  avgTransactions: number | null;
  shiftCount: number;
}

export interface StorePeriodSummary {
  storeId: string;
  storeName: string;
  periodFrom: string;
  periodTo: string;

  // Block A — Top-Line Velocity & Efficiency
  grossSalesCents: number | null;
  totalTransactions: number | null;
  avgBasketSizeCents: number | null;   // grossSales / totalTransactions
  totalLaborHours: number;
  rplhCents: number | null;            // grossSales / totalLaborHours * 100 (cents)

  // Block B — Risk & Cash Flow (safe closeout only; null when no closeout data)
  cashSalesCents: number | null;
  cardSalesCents: number | null;
  cashPct: number | null;              // 0-100
  cardPct: number | null;              // 0-100
  depositVarianceCents: number | null; // sum of safe_closeouts.variance_cents
  safeCloseoutDayCount: number;        // days with non-draft closeout

  // Block C — Environmental Context
  dominantWeatherCondition: string | null;
  weatherTrend: "Stable" | "Volatile" | null; // null = no weather data
  weatherDays: WeatherDay[];

  // Velocity Map
  bestDay: VelocityEntry | null;
  worstDay: VelocityEntry | null;
  bestShiftType: VelocityEntry | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function shiftHours(startedAt: string, endedAt: string | null): number {
  if (!endedAt) return 0;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

/**
 * Gross sales for a business date row — fallback for days without a safe closeout.
 *
 * Mirrors computeShiftSalesCents from salesAnalyzer.ts:
 *   AM net  = open_x_report_cents − rollover_from_previous_cents
 *   PM net  = close_sales_cents  (stored by end-shift route as z − priorX)
 *   Full day = AM + PM
 *
 * This avoids the LV2 rollover double-count: Z − rollover incorrectly strips
 * the post-10 PM carry-over sales from the day they were actually made.
 *
 * Note: analyzeStoreData uses safe_closeouts.cash + card as the primary source
 * (same as the admin dashboard). This function is only called for days that have
 * no matching safe closeout record.
 */
function grossSalesForDay(row: StoreReportSalesRow): number | null {
  const rollover = row.rollover_from_previous_cents ?? 0;
  const pmSales  = row.close_sales_cents;
  const amSales  = row.open_x_report_cents != null
    ? row.open_x_report_cents - rollover
    : null;
  if (amSales != null && pmSales != null) return amSales + pmSales;
  if (pmSales != null) return pmSales;
  if (amSales != null) return amSales;
  // Last resort: raw Z minus rollover (single-shift days with no openX/closeSales)
  if (row.z_report_cents != null) return row.z_report_cents - rollover;
  return null;
}

/** Total transactions for a day (null if neither column has data) */
function transactionsForDay(row: StoreReportSalesRow): number | null {
  const o = row.open_transaction_count ?? 0;
  const c = row.close_transaction_count ?? 0;
  const total = o + c;
  return total > 0 ? total : null;
}

function mostFrequent(items: string[]): string | null {
  if (items.length === 0) return null;
  const freq = new Map<string, number>();
  for (const item of items) freq.set(item, (freq.get(item) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [val, count] of freq.entries()) {
    if (count > bestCount) { bestCount = count; best = val; }
  }
  return best;
}

// ─── Main Analyzer ─────────────────────────────────────────────────────────────

export function analyzeStoreData(
  shifts: StoreReportShiftRow[],
  salesRecords: StoreReportSalesRow[],
  safeCloseouts: StoreReportSafeCloseoutRow[],
  stores: StoreReportStoreRow[],
  periodFrom: string,
  periodTo: string,
): StorePeriodSummary[] {
  return stores.map((store) => {
    const storeShifts = shifts.filter(
      (s) => s.store_id === store.id && s.last_action !== "removed"
    );
    const storeSales = salesRecords.filter((r) => r.store_id === store.id);
    const storeCloseouts = safeCloseouts.filter(
      (c) => c.store_id === store.id && c.status !== "draft"
    );

    // ── Block A ───────────────────────────────────────────────────────────────

    // Build a per-date gross sales map from safe closeouts — the same source the
    // admin dashboard uses (cash_sales_cents + card_sales_cents). This sidesteps
    // all rollover accounting complexity in daily_sales_records.
    const closeoutSalesByDate = new Map<string, number>();
    for (const c of storeCloseouts) {
      closeoutSalesByDate.set(
        c.business_date,
        (closeoutSalesByDate.get(c.business_date) ?? 0) + c.cash_sales_cents + c.card_sales_cents,
      );
    }

    // Gross sales — primary: safe_closeouts total (matches dashboard + spreadsheet).
    // Fallback for days that have no safe closeout: daily_sales_records formula.
    let grossSalesCents: number | null = null;
    let totalTransactions: number | null = null;

    // Sum all closeout-backed days first.
    for (const daySales of closeoutSalesByDate.values()) {
      grossSalesCents = (grossSalesCents ?? 0) + daySales;
    }

    // Iterate daily_sales_records: always collect transactions;
    // add sales only for days not already covered by a closeout.
    for (const row of storeSales) {
      const dayTxn = transactionsForDay(row);
      if (dayTxn != null) {
        totalTransactions = (totalTransactions ?? 0) + dayTxn;
      }
      if (!closeoutSalesByDate.has(row.business_date)) {
        const daySales = grossSalesForDay(row);
        if (daySales != null) {
          grossSalesCents = (grossSalesCents ?? 0) + daySales;
        }
      }
    }

    const avgBasketSizeCents =
      grossSalesCents != null && totalTransactions != null && totalTransactions > 0
        ? Math.round(grossSalesCents / totalTransactions)
        : null;

    // Labor hours: sum of ended shifts
    const totalLaborHours = storeShifts.reduce(
      (sum, s) => sum + shiftHours(s.started_at, s.ended_at),
      0
    );

    // RPLH = gross sales cents / labor hours (result still in cents, represents $/hr * 100)
    const rplhCents =
      grossSalesCents != null && totalLaborHours > 0
        ? Math.round(grossSalesCents / totalLaborHours)
        : null;

    // ── Block B ───────────────────────────────────────────────────────────────

    let cashSalesCents: number | null = null;
    let cardSalesCents: number | null = null;
    let depositVarianceCents: number | null = null;
    const safeCloseoutDayCount = storeCloseouts.length;

    for (const c of storeCloseouts) {
      cashSalesCents = (cashSalesCents ?? 0) + c.cash_sales_cents;
      cardSalesCents = (cardSalesCents ?? 0) + c.card_sales_cents;
      depositVarianceCents = (depositVarianceCents ?? 0) + c.variance_cents;
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

    // ── Block C ───────────────────────────────────────────────────────────────

    // Collect weather per business date (use planned_start_at for date key)
    const weatherByDate = new Map<string, WeatherDay>();
    for (const s of storeShifts) {
      if (s.start_weather_condition == null) continue;
      const dateKey = s.planned_start_at.slice(0, 10); // YYYY-MM-DD
      const existing = weatherByDate.get(dateKey);
      if (!existing) {
        weatherByDate.set(dateKey, {
          date: dateKey,
          startCondition: s.start_weather_condition,
          startDesc:      s.start_weather_desc,
          startTempF:     s.start_temp_f,
          endCondition:   s.end_weather_condition,
          endDesc:        s.end_weather_desc,
          endTempF:       s.end_temp_f,
        });
      }
      // If multiple shifts on same day, prefer the one with both start + end data
      else if (existing.endCondition == null && s.end_weather_condition != null) {
        weatherByDate.set(dateKey, {
          ...existing,
          endCondition: s.end_weather_condition,
          endDesc:      s.end_weather_desc,
          endTempF:     s.end_temp_f,
        });
      }
    }

    const weatherDays = [...weatherByDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const allConditions = weatherDays
      .flatMap((d) => [d.startCondition, d.endCondition])
      .filter((c): c is string => c != null);

    const dominantWeatherCondition = mostFrequent(allConditions);

    const uniqueConditions = new Set(allConditions);
    const weatherTrend: StorePeriodSummary["weatherTrend"] =
      allConditions.length === 0
        ? null
        : uniqueConditions.size >= 3
        ? "Volatile"
        : "Stable";

    // ── Velocity Map ──────────────────────────────────────────────────────────

    // Group daily sales by day-of-week and shift type
    const byDay = new Map<string, { totalSales: number; totalTxn: number; txnDays: number; count: number }>();
    const byShiftType = new Map<string, { totalSales: number; totalTxn: number; txnDays: number; count: number }>();

    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (const row of storeSales) {
      const sales = closeoutSalesByDate.get(row.business_date) ?? grossSalesForDay(row);
      if (sales == null) continue;
      // Day of week from business_date (YYYY-MM-DD)
      const [y, m, d] = row.business_date.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dayName = DAYS[dt.getUTCDay()];
      const txn = transactionsForDay(row);

      const dayEntry = byDay.get(dayName) ?? { totalSales: 0, totalTxn: 0, txnDays: 0, count: 0 };
      dayEntry.totalSales += sales;
      dayEntry.count += 1;
      if (txn != null) { dayEntry.totalTxn += txn; dayEntry.txnDays += 1; }
      byDay.set(dayName, dayEntry);
    }

    // Aggregate by shift type using shifts (not daily records)
    for (const s of storeShifts) {
      if (!s.ended_at) continue;
      const dateKey = s.planned_start_at.slice(0, 10);
      const salesRow = storeSales.find((r) => r.business_date === dateKey);
      const sales = closeoutSalesByDate.get(dateKey) ?? (salesRow ? grossSalesForDay(salesRow) : null);
      if (sales == null) continue;
      const txn = salesRow ? transactionsForDay(salesRow) : null;

      const typeKey = s.shift_type;
      const typeEntry = byShiftType.get(typeKey) ?? { totalSales: 0, totalTxn: 0, txnDays: 0, count: 0 };
      typeEntry.totalSales += sales;
      typeEntry.count += 1;
      if (txn != null) { typeEntry.totalTxn += txn; typeEntry.txnDays += 1; }
      byShiftType.set(typeKey, typeEntry);
    }

    function toVelocityEntry(label: string, entry: { totalSales: number; totalTxn: number; txnDays: number; count: number }): VelocityEntry {
      return {
        label,
        avgSalesCents: entry.count > 0 ? Math.round(entry.totalSales / entry.count) : 0,
        avgTransactions: entry.txnDays > 0 ? Math.round(entry.totalTxn / entry.txnDays) : null,
        shiftCount: entry.count,
      };
    }

    const dayEntries = [...byDay.entries()]
      .filter(([, e]) => e.count > 0)
      .map(([label, e]) => toVelocityEntry(label, e))
      .sort((a, b) => b.avgSalesCents - a.avgSalesCents);

    const typeEntries = [...byShiftType.entries()]
      .filter(([, e]) => e.count > 0)
      .map(([label, e]) => toVelocityEntry(label, e))
      .sort((a, b) => b.avgSalesCents - a.avgSalesCents);

    return {
      storeId: store.id,
      storeName: store.name,
      periodFrom,
      periodTo,
      // Block A
      grossSalesCents,
      totalTransactions,
      avgBasketSizeCents,
      totalLaborHours,
      rplhCents,
      // Block B
      cashSalesCents,
      cardSalesCents,
      cashPct,
      cardPct,
      depositVarianceCents,
      safeCloseoutDayCount,
      // Block C
      dominantWeatherCondition,
      weatherTrend,
      weatherDays,
      // Velocity
      bestDay: dayEntries[0] ?? null,
      worstDay: dayEntries[dayEntries.length - 1] ?? null,
      bestShiftType: typeEntries[0] ?? null,
    };
  });
}
