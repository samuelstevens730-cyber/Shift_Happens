/**
 * storeReportFormatter.ts
 *
 * Formats StorePeriodSummary data into a plain-text executive report suitable
 * for manual pasting into an LLM (Claude, ChatGPT, etc.) for deeper analysis.
 *
 * Output format matches the user-defined wireframe.
 */

import { StorePeriodSummary } from "@/lib/storeReportAnalyzer";

function d(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${value}%`;
}

function hrs(hours: number): string {
  return hours.toFixed(1);
}

export function formatStoreReport(
  summaries: StorePeriodSummary[],
  periodFrom: string,
  periodTo: string
): string {
  const lines: string[] = [];

  lines.push("=== EXECUTIVE STORE REPORT: CROSS-STORE VARIANCE ===");
  lines.push(`Period: ${periodFrom} \u2013 ${periodTo}`);

  for (const s of summaries) {
    lines.push("");
    lines.push("-".repeat(60));
    lines.push(`STORE: ${s.storeName}`);
    lines.push("");

    // Block A — Top-Line Velocity & Efficiency
    lines.push("Top-Line Health:");
    lines.push(
      `  Gross Sales: ${s.grossSalesCents != null ? d(s.grossSalesCents) : "N/A"}`
    );
    const txnStr =
      s.totalTransactions != null ? s.totalTransactions.toString() : "N/A";
    const basketStr =
      s.avgBasketSizeCents != null ? d(s.avgBasketSizeCents) : "N/A";
    lines.push(`  Total Transactions: ${txnStr} | Avg Basket Size: ${basketStr}`);
    const laborStr = hrs(s.totalLaborHours);
    const rplhStr = s.rplhCents != null ? d(s.rplhCents) : "N/A";
    lines.push(`  Total Labor Hours: ${laborStr} | RPLH: ${rplhStr}`);

    lines.push("");

    // Block B — Risk & Cash Flow
    lines.push("Risk & Cash Flow:");
    if (s.cashPct != null && s.cardPct != null) {
      lines.push(
        `  Payment Split: ${pct(s.cashPct)} Cash / ${pct(s.cardPct)} Card` +
        (s.safeCloseoutDayCount > 0
          ? ` (${s.safeCloseoutDayCount} days with safe closeout)`
          : "")
      );
    } else {
      lines.push("  Payment Split: N/A \u2014 no safe closeout data for this period");
    }
    if (s.depositVarianceCents != null) {
      const sign = s.depositVarianceCents >= 0 ? "+" : "";
      lines.push(
        `  Deposit Variance (Shrink): ${sign}${d(Math.abs(s.depositVarianceCents))} ` +
        `(${sign}${s.depositVarianceCents} cents)`
      );
    } else {
      lines.push("  Deposit Variance: N/A \u2014 no safe closeout data for this period");
    }

    lines.push("");

    // Block C — Environmental Context
    lines.push("Environmental Context:");
    if (s.weatherTrend != null) {
      lines.push(`  General Trend: ${s.weatherTrend}`);
      if (s.dominantWeatherCondition) {
        lines.push(`  Dominant Condition: ${s.dominantWeatherCondition}`);
      }
      if (s.weatherDays.length > 0) {
        lines.push("  Weather Variance:");
        for (const day of s.weatherDays) {
          const startLabel = day.startDesc ?? day.startCondition;
          const start =
            startLabel != null
              ? day.startTempF != null
                ? `${startLabel} (${day.startTempF}\u00b0F)`
                : startLabel
              : "Unknown";
          const endLabel = day.endDesc ?? day.endCondition;
          const end =
            endLabel != null
              ? day.endTempF != null
                ? `${endLabel} (${day.endTempF}\u00b0F)`
                : endLabel
              : null;
          lines.push(
            `    - ${day.date}: ${start}${end ? ` -> ${end}` : ""}`
          );
        }
      }
    } else {
      lines.push("  Weather data: N/A \u2014 no shifts with weather captured in this period");
    }

    lines.push("");

    // Velocity Map
    lines.push("Velocity Map (Averages):");
    if (s.bestDay != null) {
      const txnNote =
        s.bestDay.avgTransactions != null
          ? `, ${s.bestDay.avgTransactions} transactions`
          : "";
      lines.push(
        `  Best Day: ${s.bestDay.label} (${d(s.bestDay.avgSalesCents)} avg sales${txnNote})`
      );
    }
    if (s.worstDay != null && s.worstDay.label !== s.bestDay?.label) {
      const txnNote =
        s.worstDay.avgTransactions != null
          ? `, ${s.worstDay.avgTransactions} transactions`
          : "";
      lines.push(
        `  Worst Day: ${s.worstDay.label} (${d(s.worstDay.avgSalesCents)} avg sales${txnNote})`
      );
    }
    if (s.bestShiftType != null) {
      const txnNote =
        s.bestShiftType.avgTransactions != null
          ? `, ${s.bestShiftType.avgTransactions} transactions`
          : "";
      lines.push(
        `  Best Shift Type: ${s.bestShiftType.label} (${d(s.bestShiftType.avgSalesCents)} avg sales${txnNote})`
      );
    }
    if (s.bestDay == null && s.worstDay == null && s.bestShiftType == null) {
      lines.push("  Velocity data: N/A \u2014 no complete sales records in this period");
    }
  }

  lines.push("");
  lines.push("-".repeat(60));
  lines.push(
    `Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CST`
  );

  return lines.join("\n");
}
