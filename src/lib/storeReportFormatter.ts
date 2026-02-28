import type { PerformerMetric, StorePeriodSummary } from "@/lib/storeReportAnalyzer";

function dollarsFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMetric(metric: PerformerMetric | null, valueFormatter: (value: number) => string): string {
  if (!metric) return "N/A";
  return `${metric.employeeName} - ${valueFormatter(metric.value)} (${metric.shifts} shifts)`;
}

function formatDayOfWeekTable(summary: StorePeriodSummary): string[] {
  const lines: string[] = [];
  lines.push("Day-of-Week Averages:");
  lines.push("  Day | Avg Sales | Avg Txn | Avg Basket | Avg Labor | Avg RPLH | Samples");
  for (const row of summary.dayOfWeekAverages) {
    if (row.sampleDays === 0) continue;
    lines.push(
      `  ${row.day.slice(0, 3)} | ` +
        `${row.avgSalesCents != null ? dollarsFromCents(row.avgSalesCents) : "N/A"} | ` +
        `${row.avgTransactions != null ? row.avgTransactions.toFixed(1) : "N/A"} | ` +
        `${row.avgBasketSizeCents != null ? dollarsFromCents(row.avgBasketSizeCents) : "N/A"} | ` +
        `${row.avgLaborHours != null ? `${row.avgLaborHours.toFixed(1)}h` : "N/A"} | ` +
        `${row.avgRplhCents != null ? dollarsFromCents(row.avgRplhCents) : "N/A"} | ` +
        `${row.sampleDays}`
    );
  }
  return lines;
}

function formatShiftTypeTable(summary: StorePeriodSummary): string[] {
  const lines: string[] = [];
  lines.push("Shift-Type Breakdown:");
  lines.push("  Type | Avg Sales | Avg Txn | Avg Basket | Avg RPLH | n");
  for (const row of summary.shiftTypeBreakdown) {
    lines.push(
      `  ${row.shiftType} | ` +
        `${row.avgSalesCents != null ? dollarsFromCents(row.avgSalesCents) : "N/A"} | ` +
        `${row.avgTransactions != null ? row.avgTransactions.toFixed(1) : "N/A"} | ` +
        `${row.avgBasketCents != null ? dollarsFromCents(row.avgBasketCents) : "N/A"} | ` +
        `${row.avgRplhCents != null ? dollarsFromCents(row.avgRplhCents) : "N/A"} | ` +
        `${row.sampleSize}`
    );
  }
  return lines;
}

export function formatStoreReport(
  summaries: StorePeriodSummary[],
  periodFrom: string,
  periodTo: string
): string {
  const lines: string[] = [];

  lines.push("=== EXECUTIVE STORE REPORT ===");
  lines.push(`Period: ${periodFrom} - ${periodTo}`);

  for (const summary of summaries) {
    lines.push("");
    lines.push("-".repeat(72));
    lines.push(`STORE: ${summary.storeName}`);
    lines.push(`Window: ${summary.periodFrom} - ${summary.periodTo}`);
    lines.push("");

    lines.push("Top-Line Velocity:");
    lines.push(`  Gross Sales: ${summary.grossSalesCents != null ? dollarsFromCents(summary.grossSalesCents) : "N/A"}`);
    lines.push(
      `  Transactions: ${summary.totalTransactions ?? "N/A"} | ` +
        `Avg Basket: ${summary.avgBasketSizeCents != null ? dollarsFromCents(summary.avgBasketSizeCents) : "N/A"}`
    );
    lines.push(
      `  Labor Hours: ${summary.totalLaborHours.toFixed(1)}h | ` +
        `RPLH: ${summary.rplhCents != null ? dollarsFromCents(summary.rplhCents) : "N/A"}`
    );
    lines.push("");

    lines.push("Risk and Cash Flow:");
    lines.push(
      `  Payment Split: ${
        summary.cashPct != null && summary.cardPct != null
          ? `${summary.cashPct}% cash / ${summary.cardPct}% card`
          : "N/A"
      }`
    );
    lines.push(
      `  Deposit Variance: ${
        summary.depositVarianceCents != null
          ? `${summary.depositVarianceCents < 0 ? "-" : summary.depositVarianceCents > 0 ? "+" : ""}${dollarsFromCents(
              Math.abs(summary.depositVarianceCents)
            )}`
          : "N/A"
      }`
    );
    lines.push(`  Safe Closeout Days: ${summary.safeCloseoutDayCount}`);
    lines.push(
      `  Variance Days: ${summary.cashRisk.varianceDays}` +
        (summary.cashRisk.varianceRatePct != null ? ` (${summary.cashRisk.varianceRatePct}%)` : "")
    );
    lines.push(
      `  Total Variance: ${
        summary.cashRisk.totalVarianceCents != null
          ? `${summary.cashRisk.totalVarianceCents < 0 ? "-" : summary.cashRisk.totalVarianceCents > 0 ? "+" : ""}${dollarsFromCents(
              Math.abs(summary.cashRisk.totalVarianceCents)
            )}`
          : "N/A"
      }`
    );
    lines.push(
      `  Avg Variance/Day: ${
        summary.cashRisk.avgVariancePerDayCents != null
          ? `${summary.cashRisk.avgVariancePerDayCents < 0 ? "-" : summary.cashRisk.avgVariancePerDayCents > 0 ? "+" : ""}${dollarsFromCents(
              Math.abs(summary.cashRisk.avgVariancePerDayCents)
            )}`
          : "N/A"
      }`
    );
    lines.push(
      `  Largest Single-Day Variance: ${
        summary.cashRisk.largestSingleDayVarianceCents != null
          ? `${summary.cashRisk.largestSingleDayVarianceCents < 0 ? "-" : summary.cashRisk.largestSingleDayVarianceCents > 0 ? "+" : ""}${dollarsFromCents(
              Math.abs(summary.cashRisk.largestSingleDayVarianceCents)
            )}`
          : "N/A"
      }`
    );
    lines.push("");

    lines.push("Weather Summary:");
    lines.push(`  Trend: ${summary.weatherTrend ?? "N/A"}`);
    lines.push(
      `  Dominant Condition Mix: ${
        summary.weatherSummary.conditionMix.length > 0
          ? summary.weatherSummary.conditionMix
              .slice(0, 4)
              .map((entry) => `${entry.condition} ${entry.pct}%`)
              .join(", ")
          : "N/A"
      }`
    );
    lines.push(
      `  Temperature Min/Avg/Max: ${
        summary.weatherSummary.tempMinF != null &&
        summary.weatherSummary.tempAvgF != null &&
        summary.weatherSummary.tempMaxF != null
          ? `${summary.weatherSummary.tempMinF}F / ${summary.weatherSummary.tempAvgF}F / ${summary.weatherSummary.tempMaxF}F`
          : "N/A"
      }`
    );
    if (summary.weatherSummary.outlierFlags.length > 0) {
      lines.push("  Outlier Flags:");
      for (const flag of summary.weatherSummary.outlierFlags) {
        lines.push(`    - ${flag}`);
      }
    }
    if (summary.weatherSummary.weatherImpactHint) {
      lines.push(`  Weather Impact Hint: ${summary.weatherSummary.weatherImpactHint}`);
    }
    lines.push("");

    lines.push("Distribution and Volatility:");
    lines.push(
      `  Std Dev Daily Sales: ${
        summary.volatility.stdDevDailySalesCents != null
          ? dollarsFromCents(summary.volatility.stdDevDailySalesCents)
          : "N/A"
      }`
    );
    lines.push(
      `  Coefficient of Variation: ${
        summary.volatility.coefficientOfVariationPct != null
          ? `${summary.volatility.coefficientOfVariationPct}%`
          : "N/A"
      }`
    );
    lines.push(
      `  Outlier Counts: ${summary.volatility.belowOneSigmaDays} below -1 sigma / ` +
        `${summary.volatility.aboveOneSigmaDays} above +1 sigma`
    );
    lines.push(
      `  Largest 1-Day Swing Up: ${
        summary.volatility.largestUpSwingCents != null
          ? dollarsFromCents(summary.volatility.largestUpSwingCents)
          : "N/A"
      }`
    );
    lines.push(
      `  Largest 1-Day Swing Down: ${
        summary.volatility.largestDownSwingCents != null
          ? dollarsFromCents(summary.volatility.largestDownSwingCents)
          : "N/A"
      }`
    );
    lines.push("");

    lines.push("Velocity Map:");
    lines.push(
      `  Best Day: ${
        summary.bestDay ? `${summary.bestDay.label} (${dollarsFromCents(summary.bestDay.avgSalesCents)})` : "N/A"
      }`
    );
    lines.push(
      `  Worst Day: ${
        summary.worstDay ? `${summary.worstDay.label} (${dollarsFromCents(summary.worstDay.avgSalesCents)})` : "N/A"
      }`
    );
    lines.push(
      `  Best Shift Type: ${
        summary.bestShiftType
          ? `${summary.bestShiftType.label} (${dollarsFromCents(summary.bestShiftType.avgSalesCents)})`
          : "N/A"
      }`
    );
    lines.push("");

    lines.push("Daily Trend (last 7 days):");
    if (summary.dailyTrend.length === 0) {
      lines.push("  N/A");
    } else {
      for (const point of summary.dailyTrend.slice(-7)) {
        lines.push(
          `  ${point.date}: sales ${dollarsFromCents(point.salesCents)}, ` +
            `roll7 ${dollarsFromCents(point.rolling7SalesCents)}, ` +
            `labor ${point.laborHours.toFixed(1)}h, ` +
            `txn ${point.transactions ?? "N/A"}, ` +
            `basket ${point.basketSizeCents != null ? dollarsFromCents(point.basketSizeCents) : "N/A"}`
        );
      }
    }
    lines.push("");

    lines.push(...formatDayOfWeekTable(summary));
    lines.push("");
    lines.push(...formatShiftTypeTable(summary));
    lines.push("");

    lines.push("Data Integrity:");
    lines.push(`  Expected Days: ${summary.dataIntegrity.expectedDays}`);
    lines.push(`  Missing Sales Days: ${summary.dataIntegrity.missingSalesDays}`);
    lines.push(`  Days Missing Txn Count: ${summary.dataIntegrity.missingTransactionDays}`);
    lines.push(`  Days Missing Labor: ${summary.dataIntegrity.missingLaborDays}`);
    lines.push(`  Rollover Adjustments Applied: ${summary.dataIntegrity.rolloverAdjustedDays}`);
    lines.push(
      `  Late Closeouts / Overrides / Audit Flags: ${summary.dataIntegrity.lateCloseouts ?? "N/A"} / ` +
        `${summary.dataIntegrity.manualOverrides ?? "N/A"} / ${summary.dataIntegrity.auditFlagsTriggered ?? "N/A"}`
    );
    lines.push("");

    lines.push("Top Performers:");
    lines.push(
      `  Volume - Sales: ${formatMetric(summary.topPerformers.volume.totalSales, (value) => dollarsFromCents(value))}`
    );
    lines.push(
      `  Volume - Transactions: ${formatMetric(summary.topPerformers.volume.totalTransactions, (value) => `${Math.round(
        value
      )} txns`)}`
    );
    lines.push(
      `  Volume - Labor Hours: ${formatMetric(summary.topPerformers.volume.totalLaborHours, (value) => `${value.toFixed(
        1
      )}h`)}`
    );
    lines.push(
      `  Efficiency - RPLH: ${formatMetric(summary.topPerformers.efficiency.rplh, (value) => `${dollarsFromCents(
        value
      )}/hr`)}`
    );
    lines.push(
      `  Efficiency - Txn/Labor Hour: ${formatMetric(
        summary.topPerformers.efficiency.transactionsPerLaborHour,
        (value) => `${value.toFixed(1)} txn/hr`
      )}`
    );
    lines.push(
      `  Efficiency - Basket: ${formatMetric(summary.topPerformers.efficiency.basketSize, (value) =>
        dollarsFromCents(value)
      )}`
    );
  }

  lines.push("");
  lines.push("-".repeat(72));
  lines.push(`Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CST`);

  return lines.join("\n");
}
