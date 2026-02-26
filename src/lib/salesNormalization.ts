/**
 * salesNormalization.ts
 *
 * Shared sales normalization logic, extracted from employee-scoreboard/route.ts.
 * Both the scoreboard and the performance analyzer import from here so adjusted-sales
 * numbers are always computed identically.
 *
 * Approach: normalise each store to the network-wide average sales-per-shift, so
 * employees at a lower-volume store are not penalised vs employees at a busier store.
 *
 *   factor = networkAvgSalesPerShift / thisStoreAvgSalesPerShift
 *
 * Using avg-per-shift (rather than raw store totals) insulates the factor from
 * short-term staffing asymmetries — e.g. one store closed for a day due to weather.
 * When both stores have equal shift counts the result is identical either way.
 */

export interface StoreTotals {
  storeId: string;
  /** Sum of salesCents for all shifts with non-null sales data at this store. */
  totalSalesCents: number;
  /** Number of shifts that contributed sales data (i.e. salesCents != null). */
  shiftCount: number;
}

/**
 * Given per-store sales totals and shift counts, return a Map of
 * storeId → scaling factor.
 *
 * Stores with no sales data (totalSalesCents = 0 or shiftCount = 0) receive a
 * factor of 1 (no adjustment applied).
 */
export function computeScalingFactors(storeTotals: StoreTotals[]): Map<string, number> {
  // Step 1: per-store average sales per shift
  const storeAvgPerShift = new Map<string, number>();
  for (const { storeId, totalSalesCents, shiftCount } of storeTotals) {
    if (totalSalesCents > 0 && shiftCount > 0) {
      storeAvgPerShift.set(storeId, totalSalesCents / shiftCount);
    }
  }

  // Step 2: network-wide average of store averages
  const avgValues = Array.from(storeAvgPerShift.values()).filter((v) => v > 0);
  const networkAvg =
    avgValues.length > 0
      ? avgValues.reduce((sum, v) => sum + v, 0) / avgValues.length
      : 0;

  // Step 3: factor per store
  const factors = new Map<string, number>();
  for (const { storeId } of storeTotals) {
    const avg = storeAvgPerShift.get(storeId) ?? 0;
    factors.set(storeId, avg > 0 && networkAvg > 0 ? networkAvg / avg : 1);
  }
  return factors;
}

/**
 * Apply the pre-computed scaling factor for a given store to a raw sales value.
 * Returns adjusted sales in cents (integer, rounded).
 * Falls back to rawSalesCents unchanged if no factor is available for the store.
 */
export function applyScalingFactor(
  rawSalesCents: number,
  storeId: string,
  factors: Map<string, number>
): number {
  const factor = factors.get(storeId) ?? 1;
  return Math.round(rawSalesCents * factor);
}
