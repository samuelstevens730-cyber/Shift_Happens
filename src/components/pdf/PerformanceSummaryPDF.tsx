import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
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
  page: { padding: 24, fontSize: 10, color: "#111827" },
  heading: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subheading: { fontSize: 10, color: "#4b5563", marginBottom: 14 },
  employeeBlock: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 6, padding: 10, marginBottom: 10 },
  employeeName: { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  employeeMeta: { fontSize: 9, color: "#4b5563", marginBottom: 8 },
  metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 6 },
  metric: { minWidth: 95 },
  metricLabel: { fontSize: 8, color: "#6b7280" },
  metricValue: { fontSize: 11, fontWeight: 700 },
  metricDelta: { fontSize: 8, color: "#4b5563" },
  note: { fontSize: 8, color: "#374151", marginTop: 2 },
  sectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 6, marginBottom: 2 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingBottom: 2, marginBottom: 2 },
  row: { flexDirection: "row", paddingVertical: 1 },
  colDay: { width: "30%" },
  colNum: { width: "35%", textAlign: "right" },
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
      <Page size="A4" style={styles.page}>
        <Text style={styles.heading}>Sales Performance Report</Text>
        <Text style={styles.subheading}>
          Period: {from} to {to}
        </Text>

        {summaries.map((summary) => {
          const delta = deltasByEmployeeId[summary.employeeId];
          const goalGap =
            goalBenchmarkCents != null ? summary.avgAdjustedPerShiftCents - goalBenchmarkCents : null;

          return (
            <View key={summary.employeeId} style={styles.employeeBlock}>
              <Text style={styles.employeeName}>{summary.employeeName}</Text>
              <Text style={styles.employeeMeta}>
                {summary.primaryStore} · {summary.totalShifts} shifts ({summary.countableShifts} w/ sales) ·{" "}
                {summary.totalHours.toFixed(1)} hrs
              </Text>

              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Adj Avg / Shift</Text>
                  <Text style={styles.metricValue}>{money(summary.avgAdjustedPerShiftCents)}</Text>
                  {delta ? <Text style={styles.metricDelta}>{signedMoneyDelta(delta.adjAvgDeltaCents)}</Text> : null}
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Raw Avg / Shift</Text>
                  <Text style={styles.metricValue}>{money(summary.avgRawPerShiftCents)}</Text>
                  {delta ? <Text style={styles.metricDelta}>{signedMoneyDelta(delta.rawAvgDeltaCents)}</Text> : null}
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Adj / Hr</Text>
                  <Text style={styles.metricValue}>{money(summary.avgAdjustedPerHourCents)}</Text>
                  {delta ? (
                    <Text style={styles.metricDelta}>{signedMoneyDelta(delta.adjustedPerHourDeltaCents)}</Text>
                  ) : null}
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>vs Benchmark</Text>
                  <Text style={styles.metricValue}>
                    {benchmarkCents != null && summary.gapVsBenchmarkCents != null
                      ? `${summary.gapVsBenchmarkCents >= 0 ? "+" : "-"}${money(Math.abs(summary.gapVsBenchmarkCents))}`
                      : "—"}
                  </Text>
                </View>
                {goalBenchmarkCents != null && (
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>vs Goal</Text>
                    <Text style={styles.metricValue}>
                      {goalGap != null ? `${goalGap >= 0 ? "+" : "-"}${money(Math.abs(goalGap))}` : "—"}
                    </Text>
                  </View>
                )}
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Txn / Shift</Text>
                  <Text style={styles.metricValue}>
                    {summary.avgTransactionsPerShift != null ? summary.avgTransactionsPerShift.toFixed(1) : "—"}
                  </Text>
                  {summary.avgSalesPerTransactionCents != null ? (
                    <Text style={styles.note}>{money(summary.avgSalesPerTransactionCents)}/txn</Text>
                  ) : null}
                  {delta ? (
                    <Text style={styles.metricDelta}>
                      {signedNumberDelta(delta.avgTransactionsPerShiftDelta, 1)} ·{" "}
                      {signedMoneyDelta(delta.avgSalesPerTransactionDeltaCents)}
                    </Text>
                  ) : null}
                </View>
              </View>

              {delta && delta.notableChanges.length > 0 ? (
                <View>
                  <Text style={styles.sectionTitle}>Period-over-period notes</Text>
                  {delta.notableChanges.slice(0, 4).map((note, i) => (
                    <Text key={`${summary.employeeId}-note-${i}`} style={styles.note}>
                      • {note}
                    </Text>
                  ))}
                </View>
              ) : null}

              {includeShiftDetail && summary.byShiftType.length > 0 ? (
                <View>
                  <Text style={styles.sectionTitle}>Shift Type Breakdown</Text>
                  <View style={styles.tableHeader}>
                    <Text style={styles.colDay}>Type</Text>
                    <Text style={styles.colNum}>Shifts</Text>
                    <Text style={styles.colNum}>Adj Avg</Text>
                  </View>
                  {summary.byShiftType.map((row) => (
                    <View key={`${summary.employeeId}-type-${row.type}`} style={styles.row}>
                      <Text style={styles.colDay}>{row.type}</Text>
                      <Text style={styles.colNum}>{row.shifts}</Text>
                      <Text style={styles.colNum}>{money(row.avgAdjustedCents)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

