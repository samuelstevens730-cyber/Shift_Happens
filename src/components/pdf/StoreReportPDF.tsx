"use client";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { PerformerMetric, StorePeriodSummary } from "@/lib/storeReportAnalyzer";

const styles = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingBottom: 22,
    paddingHorizontal: 26,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#D1D5DB",
    paddingBottom: 6,
  },
  title: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 8,
    color: "#6B7280",
  },
  section: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 4,
  },
  sectionHeader: {
    backgroundColor: "#1F2937",
    color: "#F9FAFB",
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionHeaderTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  sectionHeaderMeta: {
    fontSize: 8,
    color: "#D1D5DB",
  },
  body: {
    padding: 9,
    gap: 8,
  },
  blockRow: {
    flexDirection: "row",
    gap: 8,
  },
  block: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 3,
    padding: 7,
  },
  blockHalf: {
    width: "49%",
  },
  blockTitle: {
    fontSize: 7,
    color: "#6B7280",
    textTransform: "uppercase",
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  row: {
    flexDirection: "row",
    marginBottom: 2,
  },
  label: {
    width: 120,
    color: "#6B7280",
  },
  value: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
  },
  subValue: {
    fontSize: 8,
    color: "#374151",
    marginBottom: 1,
  },
  chartLegendRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  chartLegendItem: {
    fontSize: 7,
    color: "#4B5563",
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
    gap: 6,
  },
  chartDate: {
    width: 44,
    fontSize: 7,
    color: "#6B7280",
  },
  chartBars: {
    width: 170,
    gap: 1,
  },
  chartTrack: {
    width: 170,
    height: 5,
    backgroundColor: "#E5E7EB",
    borderRadius: 2,
    overflow: "hidden",
  },
  chartSalesBar: {
    height: 5,
    backgroundColor: "#22D3EE",
  },
  chartRollingBar: {
    height: 5,
    backgroundColor: "#FACC15",
  },
  chartLaborText: {
    width: 38,
    fontSize: 7,
    color: "#4B5563",
    textAlign: "right",
  },
  muted: {
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    marginBottom: 2,
    paddingBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  colDay: { width: 40 },
  colMoney: { width: 62 },
  colNum: { width: 46 },
  colWide: { width: 76 },
  footer: {
    marginTop: 8,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    fontSize: 7,
    color: "#9CA3AF",
    textAlign: "center",
  },
});

function dollarsFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${value}%`;
}

function hours(value: number): string {
  return `${value.toFixed(1)}h`;
}

function renderMetric(metric: PerformerMetric | null, renderValue: (value: number) => string): string {
  if (!metric) return "N/A";
  return `${metric.employeeName} - ${renderValue(metric.value)} (${metric.shifts} shifts)`;
}

function deltaLabel(delta: number | null, money = false): string {
  if (delta == null) return "N/A vs prev";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const abs = Math.abs(delta);
  return money ? `${sign}${dollarsFromCents(abs)} vs prev` : `${sign}${abs.toFixed(1)} vs prev`;
}

function BlockA({ summary }: { summary: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Top-Line Velocity</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Gross Sales Raw / Adj</Text>
        <Text style={styles.value}>
          {summary.grossSalesCents != null ? dollarsFromCents(summary.grossSalesCents) : "N/A"} /{" "}
          {summary.adjustedGrossSalesCents != null ? dollarsFromCents(summary.adjustedGrossSalesCents) : "N/A"}
        </Text>
      </View>
      <Text style={styles.subValue}>
        Delta raw/adj: {deltaLabel(summary.previousDeltas.grossSalesCents, true)} /{" "}
        {deltaLabel(summary.previousDeltas.adjustedGrossSalesCents, true)}
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>Transactions</Text>
        <Text style={styles.value}>
          {summary.totalTransactions != null ? summary.totalTransactions : "N/A"}
          {summary.avgBasketSizeCents != null || summary.adjustedAvgBasketSizeCents != null
            ? ` | Basket ${summary.avgBasketSizeCents != null ? dollarsFromCents(summary.avgBasketSizeCents) : "N/A"} / ${
                summary.adjustedAvgBasketSizeCents != null ? dollarsFromCents(summary.adjustedAvgBasketSizeCents) : "N/A"
              }`
            : ""}
        </Text>
      </View>
      <Text style={styles.subValue}>Transactions delta: {deltaLabel(summary.previousDeltas.totalTransactions)}</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Labor Hours</Text>
        <Text style={styles.value}>{hours(summary.totalLaborHours)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>RPLH Raw / Adj</Text>
        <Text style={styles.value}>
          {summary.rplhCents != null ? dollarsFromCents(summary.rplhCents) : "N/A"} /{" "}
          {summary.adjustedRplhCents != null ? dollarsFromCents(summary.adjustedRplhCents) : "N/A"}
        </Text>
      </View>
      <Text style={styles.subValue}>RPLH delta: {deltaLabel(summary.previousDeltas.rplhCents, true)}</Text>
      <Text style={styles.subValue}>Basket delta: {deltaLabel(summary.previousDeltas.avgBasketSizeCents, true)}</Text>
      <Text style={styles.subValue}>Normalization factor: {summary.storeScalingFactor.toFixed(1)}x</Text>
    </View>
  );
}

function BlockB({ summary }: { summary: StorePeriodSummary }) {
  const hasData = summary.cashPct != null || summary.depositVarianceCents != null;
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Risk And Cash Flow</Text>
      {!hasData ? (
        <Text style={styles.muted}>No safe closeout data for this period.</Text>
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Payment Split</Text>
            <Text style={styles.value}>
              {summary.cashPct != null && summary.cardPct != null
                ? `${pct(summary.cashPct)} cash / ${pct(summary.cardPct)} card`
                : "N/A"}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Deposit Variance</Text>
            <Text style={styles.value}>
              {summary.depositVarianceCents != null
                ? `${summary.depositVarianceCents < 0 ? "-" : summary.depositVarianceCents > 0 ? "+" : ""}${dollarsFromCents(
                    Math.abs(summary.depositVarianceCents)
                  )}`
                : "N/A"}
            </Text>
          </View>
          <Text style={styles.subValue}>{summary.safeCloseoutDayCount} safe-closeout day(s)</Text>
          <Text style={styles.subValue}>
            Variance days: {summary.cashRisk.varianceDays}
            {summary.cashRisk.varianceRatePct != null ? ` (${summary.cashRisk.varianceRatePct}%)` : ""}
          </Text>
          <Text style={styles.subValue}>
            Total variance:{" "}
            {summary.cashRisk.totalVarianceCents != null
              ? `${summary.cashRisk.totalVarianceCents < 0 ? "-" : summary.cashRisk.totalVarianceCents > 0 ? "+" : ""}${dollarsFromCents(
                  Math.abs(summary.cashRisk.totalVarianceCents)
                )}`
              : "N/A"}
          </Text>
          <Text style={styles.subValue}>
            Avg variance/day:{" "}
            {summary.cashRisk.avgVariancePerDayCents != null
              ? `${summary.cashRisk.avgVariancePerDayCents < 0 ? "-" : summary.cashRisk.avgVariancePerDayCents > 0 ? "+" : ""}${dollarsFromCents(
                  Math.abs(summary.cashRisk.avgVariancePerDayCents)
                )}`
              : "N/A"}
          </Text>
          <Text style={styles.subValue}>
            Largest single-day variance:{" "}
            {summary.cashRisk.largestSingleDayVarianceCents != null
              ? `${summary.cashRisk.largestSingleDayVarianceCents < 0 ? "-" : summary.cashRisk.largestSingleDayVarianceCents > 0 ? "+" : ""}${dollarsFromCents(
                  Math.abs(summary.cashRisk.largestSingleDayVarianceCents)
                )}`
              : "N/A"}
          </Text>
        </>
      )}
    </View>
  );
}

function WeatherBlock({ summary }: { summary: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Weather Summary</Text>
      {summary.weatherTrend == null ? (
        <Text style={styles.muted}>No weather data in this period.</Text>
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Trend</Text>
            <Text style={styles.value}>{summary.weatherTrend}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Condition Mix</Text>
            <Text style={styles.value}>
              {summary.weatherSummary.conditionMix.length > 0
                ? summary.weatherSummary.conditionMix
                    .slice(0, 4)
                    .map((entry) => `${entry.condition} ${entry.pct}%`)
                    .join(", ")
                : "N/A"}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Temp Min/Avg/Max</Text>
            <Text style={styles.value}>
              {summary.weatherSummary.tempMinF != null &&
              summary.weatherSummary.tempAvgF != null &&
              summary.weatherSummary.tempMaxF != null
                ? `${summary.weatherSummary.tempMinF}F / ${summary.weatherSummary.tempAvgF}F / ${summary.weatherSummary.tempMaxF}F`
                : "N/A"}
            </Text>
          </View>
          {summary.weatherSummary.outlierFlags.slice(0, 3).map((flag) => (
            <Text key={flag} style={styles.subValue}>
              - {flag}
            </Text>
          ))}
          {summary.weatherSummary.weatherImpactHint && (
            <Text style={styles.subValue}>- {summary.weatherSummary.weatherImpactHint}</Text>
          )}
        </>
      )}
    </View>
  );
}

function VelocityBlock({ summary }: { summary: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Velocity Map</Text>
      {summary.bestDay ? (
        <>
          <Text style={styles.subValue}>
            Best day: {summary.bestDay.label} ({dollarsFromCents(summary.bestDay.avgSalesCents)})
          </Text>
          {summary.worstDay && summary.worstDay.label !== summary.bestDay.label && (
            <Text style={styles.subValue}>
              Worst day: {summary.worstDay.label} ({dollarsFromCents(summary.worstDay.avgSalesCents)})
            </Text>
          )}
          {summary.bestShiftType && (
            <Text style={styles.subValue}>
              Best shift type: {summary.bestShiftType.label} ({dollarsFromCents(summary.bestShiftType.avgSalesCents)})
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.muted}>No velocity data for this period.</Text>
      )}
    </View>
  );
}

function VolatilityBlock({ summary }: { summary: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Distribution And Volatility</Text>
      {summary.volatility.stdDevDailySalesCents == null ? (
        <Text style={styles.muted}>Not enough daily sales data.</Text>
      ) : (
        <>
          <Text style={styles.subValue}>
            Std dev (daily sales): {dollarsFromCents(summary.volatility.stdDevDailySalesCents)}
          </Text>
          <Text style={styles.subValue}>
            Coefficient of variation:{" "}
            {summary.volatility.coefficientOfVariationPct != null
              ? `${summary.volatility.coefficientOfVariationPct}%`
              : "N/A"}
          </Text>
          <Text style={styles.subValue}>
            Outliers: {summary.volatility.belowOneSigmaDays} below -1 sigma / {summary.volatility.aboveOneSigmaDays} above +1 sigma
          </Text>
          <Text style={styles.subValue}>
            Largest 1-day swing up:{" "}
            {summary.volatility.largestUpSwingCents != null
              ? dollarsFromCents(summary.volatility.largestUpSwingCents)
              : "N/A"}
          </Text>
          <Text style={styles.subValue}>
            Largest 1-day swing down:{" "}
            {summary.volatility.largestDownSwingCents != null
              ? dollarsFromCents(summary.volatility.largestDownSwingCents)
              : "N/A"}
          </Text>
        </>
      )}
    </View>
  );
}

function TrendChartBlock({ summary }: { summary: StorePeriodSummary }) {
  const points = summary.dailyTrend.slice(-7);
  const maxSales = points.reduce(
    (max, point) => Math.max(max, point.salesCents, point.rolling7SalesCents),
    0
  );

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Daily Sales Trend Chart</Text>
      {points.length === 0 || maxSales <= 0 ? (
        <Text style={styles.muted}>No daily trend data.</Text>
      ) : (
        <>
          <View style={styles.chartLegendRow}>
            <Text style={styles.chartLegendItem}>Cyan = Daily Sales</Text>
            <Text style={styles.chartLegendItem}>Yellow = 7d Rolling Avg</Text>
            <Text style={styles.chartLegendItem}>Right label = Labor Hours</Text>
          </View>
          {points.map((point) => {
            const salesWidth = Math.max(2, Math.round((point.salesCents / maxSales) * 170));
            const rollingWidth = Math.max(2, Math.round((point.rolling7SalesCents / maxSales) * 170));
            return (
              <View key={point.date} style={styles.chartRow}>
                <Text style={styles.chartDate}>{point.date.slice(5)}</Text>
                <View style={styles.chartBars}>
                  <View style={styles.chartTrack}>
                    <View style={[styles.chartSalesBar, { width: salesWidth }]} />
                  </View>
                  <View style={styles.chartTrack}>
                    <View style={[styles.chartRollingBar, { width: rollingWidth }]} />
                  </View>
                </View>
                <Text style={styles.chartLaborText}>{point.laborHours.toFixed(1)}h</Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

function DayOfWeekBlock({ summary }: { summary: StorePeriodSummary }) {
  const rows = summary.dayOfWeekAverages.filter((row) => row.sampleDays > 0);
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Day-Of-Week Averages</Text>
      {rows.length === 0 ? (
        <Text style={styles.muted}>No day-level data.</Text>
      ) : (
        <>
          <View style={styles.tableHeader}>
            <Text style={styles.colDay}>Day</Text>
            <Text style={styles.colMoney}>Sales</Text>
            <Text style={styles.colNum}>Txn</Text>
            <Text style={styles.colMoney}>Basket</Text>
            <Text style={styles.colNum}>Labor</Text>
            <Text style={styles.colWide}>RPLH</Text>
          </View>
          {rows.map((row) => (
            <View key={row.day} style={styles.tableRow}>
              <Text style={styles.colDay}>{row.day.slice(0, 3)}</Text>
              <Text style={styles.colMoney}>{row.avgSalesCents != null ? dollarsFromCents(row.avgSalesCents) : "N/A"}</Text>
              <Text style={styles.colNum}>{row.avgTransactions != null ? row.avgTransactions.toFixed(1) : "N/A"}</Text>
              <Text style={styles.colMoney}>
                {row.avgBasketSizeCents != null ? dollarsFromCents(row.avgBasketSizeCents) : "N/A"}
              </Text>
              <Text style={styles.colNum}>{row.avgLaborHours != null ? row.avgLaborHours.toFixed(1) : "N/A"}</Text>
              <Text style={styles.colWide}>{row.avgRplhCents != null ? dollarsFromCents(row.avgRplhCents) : "N/A"}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function ShiftTypeBreakdownBlock({ summary }: { summary: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Shift-Type Breakdown</Text>
      {summary.shiftTypeBreakdown.length === 0 ? (
        <Text style={styles.muted}>No shift-type data.</Text>
      ) : (
        <>
          <View style={styles.tableHeader}>
            <Text style={styles.colDay}>Type</Text>
            <Text style={styles.colMoney}>Sales</Text>
            <Text style={styles.colNum}>Txn</Text>
            <Text style={styles.colMoney}>Basket</Text>
            <Text style={styles.colWide}>RPLH / n</Text>
          </View>
          {summary.shiftTypeBreakdown.map((row) => (
            <View key={row.shiftType} style={styles.tableRow}>
              <Text style={styles.colDay}>{row.shiftType}</Text>
              <Text style={styles.colMoney}>{row.avgSalesCents != null ? dollarsFromCents(row.avgSalesCents) : "N/A"}</Text>
              <Text style={styles.colNum}>{row.avgTransactions != null ? row.avgTransactions.toFixed(1) : "N/A"}</Text>
              <Text style={styles.colMoney}>{row.avgBasketCents != null ? dollarsFromCents(row.avgBasketCents) : "N/A"}</Text>
              <Text style={styles.colWide}>
                {row.avgRplhCents != null ? dollarsFromCents(row.avgRplhCents) : "N/A"} / {row.sampleSize}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function DataIntegrityBlock({ summary }: { summary: StorePeriodSummary }) {
  const integrity = summary.dataIntegrity;
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Data Integrity</Text>
      <Text style={styles.subValue}>Expected days: {integrity.expectedDays}</Text>
      <Text style={styles.subValue}>Missing sales days: {integrity.missingSalesDays}</Text>
      <Text style={styles.subValue}>Days missing txn count: {integrity.missingTransactionDays}</Text>
      <Text style={styles.subValue}>Days missing labor hours: {integrity.missingLaborDays}</Text>
      <Text style={styles.subValue}>Rollover-adjusted days: {integrity.rolloverAdjustedDays}</Text>
      <Text style={styles.subValue}>
        Late closeouts / overrides / audit flags: {integrity.lateCloseouts ?? "N/A"} /{" "}
        {integrity.manualOverrides ?? "N/A"} / {integrity.auditFlagsTriggered ?? "N/A"}
      </Text>
    </View>
  );
}

function TopPerformersBlock({ summary }: { summary: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Top Performers</Text>
      <Text style={styles.subValue}>
        Volume sales: {renderMetric(summary.topPerformers.volume.totalSales, (value) => dollarsFromCents(value))}
      </Text>
      <Text style={styles.subValue}>
        Volume transactions:{" "}
        {renderMetric(summary.topPerformers.volume.totalTransactions, (value) => `${Math.round(value)} txns`)}
      </Text>
      <Text style={styles.subValue}>
        Volume labor: {renderMetric(summary.topPerformers.volume.totalLaborHours, (value) => `${value.toFixed(1)}h`)}
      </Text>
      <Text style={styles.subValue}>
        Efficiency RPLH: {renderMetric(summary.topPerformers.efficiency.rplh, (value) => `${dollarsFromCents(value)}/hr`)}
      </Text>
      <Text style={styles.subValue}>
        Efficiency txn/hr:{" "}
        {renderMetric(summary.topPerformers.efficiency.transactionsPerLaborHour, (value) => `${value.toFixed(1)} txn/hr`)}
      </Text>
      <Text style={styles.subValue}>
        Efficiency basket: {renderMetric(summary.topPerformers.efficiency.basketSize, (value) => dollarsFromCents(value))}
      </Text>
    </View>
  );
}

interface Props {
  summaries: StorePeriodSummary[];
  from: string;
  to: string;
}

export function StoreReportPDF({ summaries, from, to }: Props) {
  const generated = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Executive Store Report</Text>
          <Text style={styles.subtitle}>Period: {from} - {to}</Text>
          <Text style={styles.subtitle}>Generated: {generated} CST</Text>
        </View>

        {summaries.map((summary) => (
          <View key={summary.storeId} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderTitle}>{summary.storeName}</Text>
              <Text style={styles.sectionHeaderMeta}>
                {summary.periodFrom} - {summary.periodTo}
              </Text>
            </View>
            <View style={styles.body}>
              <View style={styles.blockRow}>
                <View style={styles.blockHalf}>
                  <BlockA summary={summary} />
                </View>
                <View style={styles.blockHalf}>
                  <BlockB summary={summary} />
                </View>
              </View>
              <View style={styles.blockRow}>
                <View style={styles.blockHalf}>
                  <WeatherBlock summary={summary} />
                </View>
                <View style={styles.blockHalf}>
                  <VelocityBlock summary={summary} />
                </View>
              </View>
              <VolatilityBlock summary={summary} />
              <TrendChartBlock summary={summary} />
              <DayOfWeekBlock summary={summary} />
              <ShiftTypeBreakdownBlock summary={summary} />
              <DataIntegrityBlock summary={summary} />
              <TopPerformersBlock summary={summary} />
            </View>
          </View>
        ))}

        <Text style={styles.footer}>
          Shift Happens Store Report - {from} to {to}
        </Text>
      </Page>
    </Document>
  );
}
