import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { pdfStyles } from "@/components/pdf/PdfStyles";
import type { EmployeePeriodSummary } from "@/lib/salesAnalyzer";
import type { PeriodDelta } from "@/lib/salesDelta";

type Props = {
  from: string;
  to: string;
  benchmarkCents: number | null;
  goalBenchmarkCents?: number | null;
  summaries: EmployeePeriodSummary[];
  deltasByEmployeeId?: Record<string, PeriodDelta | undefined>;
  includeShiftDetail?: boolean;
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
  },
  cardHeader: {
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    paddingBottom: 4,
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: 700,
  },
  cardMeta: {
    fontSize: 8,
    color: "#4B5563",
    marginTop: 2,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 4,
  },
  metricCell: {
    width: "33.33%",
    paddingRight: 8,
    paddingBottom: 4,
  },
  metricLabel: {
    fontSize: 7,
    color: "#6B7280",
    textTransform: "uppercase",
    marginBottom: 1,
  },
  metricValue: {
    fontSize: 10,
    fontWeight: 700,
  },
  metricDelta: {
    fontSize: 7,
    color: "#4B5563",
    marginTop: 1,
  },
  notesWrap: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 4,
  },
  notesTitle: {
    fontSize: 8,
    fontWeight: 700,
    marginBottom: 2,
  },
  noteRow: {
    fontSize: 8,
    color: "#374151",
    marginBottom: 1,
  },
  splitTable: {
    marginTop: 5,
  },
  splitColType: { width: "40%" },
  splitColShifts: { width: "20%", textAlign: "right" },
  splitColAvg: { width: "40%", textAlign: "right" },
});

const money = (cents: number) => `$${(cents / 100).toFixed(0)}`;
const signedMoneyDelta = (cents: number | null | undefined) => {
  if (cents == null) return "N/A vs prev";
  const sign = cents >= 0 ? "+" : "-";
  return `${sign}${money(Math.abs(cents))} vs prev`;
};
const signedNumberDelta = (value: number | null | undefined, digits = 1) => {
  if (value == null) return "N/A vs prev";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(digits)} vs prev`;
};

function metric(label: string, value: string, delta?: string) {
  return (
    <View style={styles.metricCell}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {delta ? <Text style={styles.metricDelta}>{delta}</Text> : null}
    </View>
  );
}

export function PerformanceSummaryPDF({
  from,
  to,
  benchmarkCents,
  goalBenchmarkCents = null,
  summaries,
  deltasByEmployeeId = {},
  includeShiftDetail = false,
}: Props) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.pagePortrait}>
        <Text style={pdfStyles.title}>Sales Performance Report</Text>
        <Text style={pdfStyles.subtitle}>Period: {from} to {to}</Text>
        <Text style={[pdfStyles.subtitle, { marginBottom: 8 }]}>
          Employees: {summaries.length}
        </Text>

        {summaries.map((summary) => {
          const delta = deltasByEmployeeId[summary.employeeId];
          const goalGap =
            goalBenchmarkCents != null ? summary.avgAdjustedPerShiftCents - goalBenchmarkCents : null;
          const benchmarkGap =
            benchmarkCents != null && summary.gapVsBenchmarkCents != null
              ? `${summary.gapVsBenchmarkCents >= 0 ? "+" : "-"}${money(Math.abs(summary.gapVsBenchmarkCents))}`
              : "N/A";

          return (
            <View key={summary.employeeId} style={styles.card} wrap={false}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{summary.employeeName}</Text>
                <Text style={styles.cardMeta}>
                  {summary.primaryStore} - {summary.totalShifts} shifts ({summary.countableShifts} with sales) -{" "}
                  {summary.totalHours.toFixed(1)} hours
                </Text>
              </View>

              <View style={styles.metricGrid}>
                {metric("Adj Avg / Shift", money(summary.avgAdjustedPerShiftCents), delta ? signedMoneyDelta(delta.adjAvgDeltaCents) : undefined)}
                {metric("Raw Avg / Shift", money(summary.avgRawPerShiftCents), delta ? signedMoneyDelta(delta.rawAvgDeltaCents) : undefined)}
                {metric("Adj / Hr", money(summary.avgAdjustedPerHourCents), delta ? signedMoneyDelta(delta.adjustedPerHourDeltaCents) : undefined)}
                {metric("vs Benchmark", benchmarkGap)}
                {goalBenchmarkCents != null
                  ? metric(
                      "vs Goal",
                      goalGap != null ? `${goalGap >= 0 ? "+" : "-"}${money(Math.abs(goalGap))}` : "N/A"
                    )
                  : null}
                {metric(
                  "Txn / Shift",
                  summary.avgTransactionsPerShift != null ? summary.avgTransactionsPerShift.toFixed(1) : "N/A",
                  delta
                    ? `${signedNumberDelta(delta.avgTransactionsPerShiftDelta, 1)} | ${signedMoneyDelta(
                        delta.avgSalesPerTransactionDeltaCents
                      )}`
                    : summary.avgSalesPerTransactionCents != null
                    ? `${money(summary.avgSalesPerTransactionCents)}/txn`
                    : undefined
                )}
              </View>

              {delta && delta.notableChanges.length > 0 ? (
                <View style={styles.notesWrap}>
                  <Text style={styles.notesTitle}>Period-over-period Notes</Text>
                  {delta.notableChanges.slice(0, 4).map((note, i) => (
                    <Text key={`${summary.employeeId}-note-${i}`} style={styles.noteRow}>
                      - {note}
                    </Text>
                  ))}
                </View>
              ) : null}

              {includeShiftDetail && summary.byShiftType.length > 0 ? (
                <View style={styles.splitTable}>
                  <Text style={pdfStyles.sectionTitle}>Shift Type Breakdown</Text>
                  <View style={pdfStyles.table}>
                    <View style={pdfStyles.tableRow}>
                      <Text style={[pdfStyles.th, styles.splitColType]}>Type</Text>
                      <Text style={[pdfStyles.th, styles.splitColShifts]}>Shifts</Text>
                      <Text style={[pdfStyles.th, styles.splitColAvg]}>Adj Avg</Text>
                    </View>
                    {summary.byShiftType.map((row) => (
                      <View key={`${summary.employeeId}-type-${row.type}`} style={pdfStyles.tableRow}>
                        <Text style={[pdfStyles.td, styles.splitColType]}>{row.type}</Text>
                        <Text style={[pdfStyles.td, styles.splitColShifts]}>{row.shifts}</Text>
                        <Text style={[pdfStyles.td, styles.splitColAvg]}>{money(row.avgAdjustedCents)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

