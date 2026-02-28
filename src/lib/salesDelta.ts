/**
 * salesDelta.ts
 *
 * Period-over-period comparison between two EmployeePeriodSummary objects.
 * Pure computation — no DB access.
 *
 * All monetary delta values are in CENTS. Convert to dollars at the formatter layer only.
 */

import type { EmployeePeriodSummary } from "@/lib/salesAnalyzer";

export interface ShiftTypeChange {
  type: string;
  previousAvgCents: number;
  currentAvgCents: number;
  deltaCents: number;
  deltaPct: number;
}

export interface PeriodDelta {
  employeeId: string;
  currentPeriod: string;   // e.g. "2026-02-10 – 2026-02-23"
  previousPeriod: string;

  // Top-line metric deltas (null when previous period lacks a usable baseline)
  rawAvgDeltaCents: number | null;
  adjustedPerHourDeltaCents: number | null;
  avgTransactionsPerShiftDelta: number | null;
  avgSalesPerTransactionDeltaCents: number | null;

  // Core adj avg movement (cents)
  adjAvgDeltaCents: number;
  adjAvgDeltaPct: number;

  // Benchmark gap movement (cents; positive = gap widened above benchmark, negative = gap closed)
  gapVsBenchmarkDeltaCents: number | null;

  // Flag movement
  highFlagDelta: number;
  lowFlagDelta: number;

  // UP if adjAvgDelta > +2500 cents ($25), DOWN if < -2500, else FLAT
  trending: "UP" | "DOWN" | "FLAT";

  // Shift types that moved ≥ 20%
  shiftTypeChanges: ShiftTypeChange[];

  // Human-readable notable changes for the text report / AI context
  notableChanges: string[];
}

function fmt(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  return `$${dollars.toFixed(0)}`;
}

function pct(value: number): string {
  return `${Math.abs(value).toFixed(0)}%`;
}

/**
 * Compare current period summary against a previous period snapshot.
 * Returns a PeriodDelta describing what changed.
 */
export function computePeriodDelta(
  current: EmployeePeriodSummary,
  previous: EmployeePeriodSummary
): PeriodDelta {
  const deltaNumber = (curr: number | null | undefined, prev: number | null | undefined): number | null => {
    if (curr == null || prev == null) return null;
    return curr - prev;
  };

  const periodLabel = (s: EmployeePeriodSummary) => `${s.period.from} – ${s.period.to}`;

  const adjAvgDeltaCents = current.avgAdjustedPerShiftCents - previous.avgAdjustedPerShiftCents;
  const adjAvgDeltaPct =
    previous.avgAdjustedPerShiftCents > 0
      ? (adjAvgDeltaCents / previous.avgAdjustedPerShiftCents) * 100
      : 0;

  const gapVsBenchmarkDeltaCents =
    current.gapVsBenchmarkCents != null && previous.gapVsBenchmarkCents != null
      ? current.gapVsBenchmarkCents - previous.gapVsBenchmarkCents
      : null;

  const trending: "UP" | "DOWN" | "FLAT" =
    adjAvgDeltaCents > 2500 ? "UP" : adjAvgDeltaCents < -2500 ? "DOWN" : "FLAT";

  const highFlagDelta = current.highFlagCount - previous.highFlagCount;
  const lowFlagDelta = current.lowFlagCount - previous.lowFlagCount;

  // ── Shift type changes ────────────────────────────────────────────────────────
  const prevTypeMap = new Map(previous.byShiftType.map((b) => [b.type, b.avgAdjustedCents]));
  const currTypeMap = new Map(current.byShiftType.map((b) => [b.type, b.avgAdjustedCents]));
  const allTypes = new Set([...prevTypeMap.keys(), ...currTypeMap.keys()]);
  const shiftTypeChanges: ShiftTypeChange[] = [];
  for (const type of allTypes) {
    const prev = prevTypeMap.get(type) ?? 0;
    const curr = currTypeMap.get(type) ?? 0;
    if (prev === 0 && curr === 0) continue;
    const deltaCents = curr - prev;
    const deltaPct = prev > 0 ? (deltaCents / prev) * 100 : 0;
    if (Math.abs(deltaPct) >= 20) {
      shiftTypeChanges.push({ type, previousAvgCents: prev, currentAvgCents: curr, deltaCents, deltaPct });
    }
  }
  shiftTypeChanges.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));

  // ── Notable changes (human-readable) ─────────────────────────────────────────
  const notableChanges: string[] = [];

  // Overall trend
  if (trending !== "FLAT") {
    const dir = trending === "UP" ? "up" : "down";
    notableChanges.push(
      `Adjusted average ${dir} ${fmt(adjAvgDeltaCents)} (${pct(adjAvgDeltaPct)}%) vs last period`
    );
  }

  // Benchmark gap
  if (gapVsBenchmarkDeltaCents != null && Math.abs(gapVsBenchmarkDeltaCents) >= 500) {
    const closing = gapVsBenchmarkDeltaCents > 0;
    const word = closing ? "widening" : "closing";
    notableChanges.push(
      `Benchmark gap ${word} by ${fmt(gapVsBenchmarkDeltaCents)} — now ${fmt(current.gapVsBenchmarkCents ?? 0)} ${(current.gapVsBenchmarkCents ?? 0) >= 0 ? "above" : "below"} benchmark`
    );
  }

  // LOW flag spike
  if (lowFlagDelta >= 2) {
    notableChanges.push(
      `LOW flag count increased by ${lowFlagDelta} (${previous.lowFlagPct}% → ${current.lowFlagPct}%)`
    );
  } else if (lowFlagDelta <= -2) {
    notableChanges.push(
      `LOW flag count improved by ${Math.abs(lowFlagDelta)} (${previous.lowFlagPct}% → ${current.lowFlagPct}%)`
    );
  }

  // HIGH flag movement
  if (highFlagDelta >= 2) {
    notableChanges.push(`HIGH flag count up by ${highFlagDelta}`);
  }

  // Streak
  if (Math.abs(current.currentStreak) >= 3) {
    const dir = current.currentStreak > 0 ? "HIGH" : "LOW";
    notableChanges.push(`Currently on a ${Math.abs(current.currentStreak)}-shift ${dir} streak`);
  }

  // Shift type changes
  for (const change of shiftTypeChanges.slice(0, 3)) {
    const dir = change.deltaCents > 0 ? "improved" : "declined";
    notableChanges.push(
      `${change.type} shifts ${dir} ${fmt(change.deltaCents)} (${pct(change.deltaPct)}%) — now ${fmt(change.currentAvgCents)} adj avg`
    );
  }

  return {
    employeeId: current.employeeId,
    currentPeriod: periodLabel(current),
    previousPeriod: periodLabel(previous),
    rawAvgDeltaCents: deltaNumber(current.avgRawPerShiftCents, previous.avgRawPerShiftCents),
    adjustedPerHourDeltaCents: deltaNumber(current.avgAdjustedPerHourCents, previous.avgAdjustedPerHourCents),
    avgTransactionsPerShiftDelta: deltaNumber(current.avgTransactionsPerShift, previous.avgTransactionsPerShift),
    avgSalesPerTransactionDeltaCents: deltaNumber(current.avgSalesPerTransactionCents, previous.avgSalesPerTransactionCents),
    adjAvgDeltaCents,
    adjAvgDeltaPct: Math.round(adjAvgDeltaPct * 10) / 10,
    gapVsBenchmarkDeltaCents,
    highFlagDelta,
    lowFlagDelta,
    trending,
    shiftTypeChanges,
    notableChanges,
  };
}
