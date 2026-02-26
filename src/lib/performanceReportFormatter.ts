/**
 * performanceReportFormatter.ts
 *
 * Converts EmployeePeriodSummary (and optional PeriodDelta) into a compact
 * plain-text report suitable for:
 *  - Direct human review at a sales meeting
 *  - Pasting into an LLM (Claude/ChatGPT/Gemini) for deeper analysis
 *
 * All monetary values are converted from cents to dollars here — this is the
 * only place in the stack where that conversion happens.
 */

import type { EmployeePeriodSummary } from "@/lib/salesAnalyzer";
import type { PeriodDelta } from "@/lib/salesDelta";

function d(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function pct(value: number): string {
  return `${value.toFixed(0)}%`;
}

function bestWorst(
  items: Array<{ label: string; avgCents: number }>,
  minItems = 2
): { best: string; worst: string } | null {
  const filtered = items.filter((i) => i.avgCents > 0);
  if (filtered.length < minItems) return null;
  const sorted = [...filtered].sort((a, b) => b.avgCents - a.avgCents);
  return {
    best: `${sorted[0].label} @ ${d(sorted[0].avgCents)}`,
    worst: `${sorted[sorted.length - 1].label} @ ${d(sorted[sorted.length - 1].avgCents)}`,
  };
}

function streakLabel(streak: number): string {
  if (streak === 0) return "0 (neutral)";
  const abs = Math.abs(streak);
  const dir = streak > 0 ? "HIGH" : "LOW";
  return `${streak > 0 ? "+" : "-"}${abs} (${abs} consecutive ${dir})`;
}

export interface FormatReportOptions {
  /**
   * Include per-shift detail tables.
   * Automatically enabled when verbose = true.
   * Default: false.
   */
  includeShiftDetail?: boolean;
  /**
   * Verbose / full-analysis mode:
   *  - Shows ALL shift-type breakdowns (not just best/worst)
   *  - Shows ALL day-of-week breakdowns sorted by adj avg
   *  - Implies includeShiftDetail = true
   * Default: false.
   */
  verbose?: boolean;
}

/**
 * Format a single employee's performance summary as plain text.
 */
export function formatEmployeeSummary(
  summary: EmployeePeriodSummary,
  delta: PeriodDelta | null = null,
  options: FormatReportOptions = {}
): string {
  const lines: string[] = [];
  const verbose = options.verbose ?? false;

  const periodStr = `${summary.period.from} – ${summary.period.to}`;
  lines.push(`${summary.employeeName.toUpperCase()} — ${periodStr}`);
  lines.push(
    `Store: ${summary.primaryStore} | Shifts: ${summary.totalShifts} (${summary.countableShifts} w/ sales) | Hours: ${summary.totalHours.toFixed(1)}`
  );

  lines.push(
    `Adj Avg: ${d(summary.avgAdjustedPerShiftCents)} | Raw Avg: ${d(summary.avgRawPerShiftCents)} | Adj/Hr: ${d(summary.avgAdjustedPerHourCents)}`
  );

  if (summary.benchmarkAdjAvgCents != null && summary.gapVsBenchmarkCents != null) {
    const gapSign = summary.gapVsBenchmarkCents >= 0 ? "+" : "";
    const monthlyNote =
      summary.estimatedMonthlyGapCents != null
        ? ` | Est. monthly gap: ${d(summary.estimatedMonthlyGapCents)}`
        : "";
    lines.push(
      `Benchmark: ${d(summary.benchmarkAdjAvgCents)} | Gap: ${gapSign}${d(summary.gapVsBenchmarkCents)}/shift${monthlyNote}`
    );
  }

  if (delta) {
    const sign = delta.adjAvgDeltaCents >= 0 ? "+" : "";
    lines.push(
      `Trend vs last period: ${delta.trending} ${sign}${d(delta.adjAvgDeltaCents)} (${sign}${delta.adjAvgDeltaPct.toFixed(1)}%)`
    );
  } else {
    lines.push(`Trend vs last period: No previous period data`);
  }

  const streakStr = streakLabel(summary.currentStreak);
  lines.push(
    `Flags: ${summary.highFlagCount} HIGH (${pct(summary.highFlagPct)}) | ${summary.lowFlagCount} LOW (${pct(summary.lowFlagPct)}) | Streak: ${streakStr}`
  );

  if (verbose) {
    // ── Full shift-type breakdown ──────────────────────────────────────────────
    if (summary.byShiftType.length > 0) {
      lines.push("");
      lines.push("Shift type breakdown:");
      const sorted = [...summary.byShiftType].sort((a, b) => b.avgAdjustedCents - a.avgAdjustedCents);
      for (const b of sorted) {
        lines.push(
          `  ${b.type.padEnd(8)} ${String(b.shifts).padStart(2)} shifts | Adj avg: ${d(b.avgAdjustedCents).padStart(6)} | Adj/hr: ${d(b.avgAdjPerHourCents).padStart(6)} | Hi: ${b.highCount} Lo: ${b.lowCount}`
        );
      }
    }

    // ── Full day-of-week breakdown ─────────────────────────────────────────────
    if (summary.byDayOfWeek.length > 0) {
      lines.push("");
      lines.push("Day of week breakdown:");
      const sorted = [...summary.byDayOfWeek].sort((a, b) => b.avgAdjustedCents - a.avgAdjustedCents);
      for (const b of sorted) {
        lines.push(
          `  ${b.day.padEnd(10)} ${String(b.shifts).padStart(2)} shifts | Adj avg: ${d(b.avgAdjustedCents).padStart(6)} | Adj/hr: ${d(b.avgAdjPerHourCents).padStart(6)}`
        );
      }
    }
  } else {
    // ── Best/worst only (compact) ──────────────────────────────────────────────
    const typeItems = summary.byShiftType.map((b) => ({ label: b.type, avgCents: b.avgAdjustedCents }));
    const typeBW = bestWorst(typeItems);
    if (typeBW) {
      lines.push(`Best shift type: ${typeBW.best} adj avg`);
      lines.push(`Worst shift type: ${typeBW.worst} adj avg`);
    }

    const dowItems = summary.byDayOfWeek.map((b) => ({ label: b.day, avgCents: b.avgAdjustedCents }));
    const dowBW = bestWorst(dowItems);
    if (dowBW) {
      lines.push(`Best day: ${dowBW.best} | Worst day: ${dowBW.worst}`);
    }
  }

  // Notable changes (always shown)
  if (delta && delta.notableChanges.length > 0) {
    lines.push("");
    lines.push("Notable changes vs last period:");
    for (const change of delta.notableChanges) {
      lines.push(`  - ${change}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a full report for all employees as plain text.
 * Suitable for clipboard copy → paste into AI for analysis.
 */
export function formatPerformanceReport(
  summaries: EmployeePeriodSummary[],
  deltaMap: Map<string, PeriodDelta> = new Map(),
  benchmarkCents: number | null = null,
  options: FormatReportOptions = {}
): string {
  const lines: string[] = [];
  const verbose = options.verbose ?? false;
  const includeShiftDetail = verbose || (options.includeShiftDetail ?? false);

  if (summaries.length === 0) return "(No employee data for this period)";

  const period = summaries[0].period;
  lines.push(verbose ? `=== SALES PERFORMANCE REPORT (FULL) ===` : `=== SALES PERFORMANCE REPORT ===`);
  lines.push(`Period: ${period.from} – ${period.to}`);
  if (benchmarkCents != null) {
    lines.push(`Benchmark (adjusted avg/shift): ${d(benchmarkCents)}`);
  }
  lines.push(`Employees: ${summaries.length}`);
  lines.push("");

  // Sort by adjusted avg descending
  const sorted = [...summaries].sort(
    (a, b) => b.avgAdjustedPerShiftCents - a.avgAdjustedPerShiftCents
  );

  for (const summary of sorted) {
    const delta = deltaMap.get(summary.employeeId) ?? null;
    lines.push("-".repeat(60));
    lines.push(formatEmployeeSummary(summary, delta, options));

    if (includeShiftDetail && summary.shifts.length > 0) {
      const countable = summary.shifts.filter((s) => s.isCountable);
      if (countable.length > 0) {
        lines.push("");
        lines.push("  Shift detail:");
        lines.push(
          `  ${"Date".padEnd(12)} ${"Day".padEnd(5)} ${"Type".padEnd(8)} ${"Adj".padStart(7)} ${"Raw".padStart(7)} ${"Hrs".padStart(5)} ${"Flag".padStart(7)}`
        );
        for (const s of countable) {
          const adjStr = s.adjustedSalesCents != null ? d(s.adjustedSalesCents) : "—";
          const rawStr = s.rawSalesCents != null ? d(s.rawSalesCents) : "—";
          const hrsStr = s.shiftHours > 0 ? s.shiftHours.toFixed(1) : "—";
          const flagStr = s.performanceFlag ?? "—";
          lines.push(
            `  ${s.date.padEnd(12)} ${s.dayOfWeek.slice(0, 3).padEnd(5)} ${s.shiftType.padEnd(8)} ${adjStr.padStart(7)} ${rawStr.padStart(7)} ${hrsStr.padStart(5)} ${flagStr.padStart(7)}`
          );
        }
      }
    }

    lines.push("");
  }

  lines.push("=".repeat(60));
  lines.push(`Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CST`);

  return lines.join("\n");
}
