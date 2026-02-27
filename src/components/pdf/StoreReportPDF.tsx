"use client";

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { StorePeriodSummary } from "@/lib/storeReportAnalyzer";

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 28,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  reportHeader: {
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#D1D5DB",
    paddingBottom: 8,
  },
  reportTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  reportSubtitle: {
    fontSize: 8,
    color: "#6B7280",
  },
  storeSection: {
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 4,
    overflow: "hidden",
  },
  storeHeader: {
    backgroundColor: "#1F2937",
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  storeName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#F9FAFB",
  },
  storePeriod: {
    fontSize: 8,
    color: "#9CA3AF",
  },
  storeBody: {
    padding: 10,
    gap: 10,
  },
  blockTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: "#6B7280",
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  block: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 3,
    padding: 8,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    marginBottom: 2,
  },
  label: {
    color: "#6B7280",
    width: 120,
  },
  value: {
    fontFamily: "Helvetica-Bold",
    flex: 1,
  },
  weatherEntry: {
    fontSize: 8,
    color: "#374151",
    fontFamily: "Courier",
    marginBottom: 1,
  },
  naText: {
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  footer: {
    marginTop: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    fontSize: 7,
    color: "#9CA3AF",
    textAlign: "center",
  },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function d(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${value}%`;
}

function hrs(hours: number): string {
  return `${hours.toFixed(1)} hrs`;
}

// ─── Block Components ──────────────────────────────────────────────────────────

function BlockA({ s }: { s: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Block A — Top-Line Velocity &amp; Efficiency</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Gross Sales</Text>
        <Text style={styles.value}>{s.grossSalesCents != null ? d(s.grossSalesCents) : "—"}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Total Transactions</Text>
        <Text style={styles.value}>
          {s.totalTransactions != null ? s.totalTransactions.toString() : "—"}
          {s.avgBasketSizeCents != null ? `  |  Avg Basket: ${d(s.avgBasketSizeCents)}` : ""}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Total Labor Hours</Text>
        <Text style={styles.value}>{hrs(s.totalLaborHours)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>RPLH</Text>
        <Text style={styles.value}>{s.rplhCents != null ? d(s.rplhCents) : "—"}</Text>
      </View>
    </View>
  );
}

function BlockB({ s }: { s: StorePeriodSummary }) {
  const hasData = s.cashPct != null || s.depositVarianceCents != null;
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Block B — Risk &amp; Cash Flow</Text>
      {hasData ? (
        <>
          {s.cashPct != null && s.cardPct != null ? (
            <View style={styles.row}>
              <Text style={styles.label}>Payment Split</Text>
              <Text style={styles.value}>
                {pct(s.cashPct)} Cash / {pct(s.cardPct)} Card  ({s.safeCloseoutDayCount} days)
              </Text>
            </View>
          ) : (
            <View style={styles.row}>
              <Text style={styles.label}>Payment Split</Text>
              <Text style={[styles.value, styles.naText]}>N/A — no safe closeout data</Text>
            </View>
          )}
          {s.depositVarianceCents != null ? (
            <View style={styles.row}>
              <Text style={styles.label}>Deposit Variance</Text>
              <Text style={styles.value}>
                {s.depositVarianceCents >= 0 ? "+" : ""}{d(Math.abs(s.depositVarianceCents))}
              </Text>
            </View>
          ) : (
            <View style={styles.row}>
              <Text style={styles.label}>Deposit Variance</Text>
              <Text style={[styles.value, styles.naText]}>N/A — no safe closeout data</Text>
            </View>
          )}
        </>
      ) : (
        <Text style={styles.naText}>No safe closeout data for this period.</Text>
      )}
    </View>
  );
}

function BlockC({ s }: { s: StorePeriodSummary }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Block C — Environmental Context</Text>
      {s.weatherTrend != null ? (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>General Trend</Text>
            <Text style={styles.value}>{s.weatherTrend}</Text>
          </View>
          {s.dominantWeatherCondition && (
            <View style={styles.row}>
              <Text style={styles.label}>Dominant Condition</Text>
              <Text style={styles.value}>{s.dominantWeatherCondition}</Text>
            </View>
          )}
          {s.weatherDays.length > 0 && (
            <View style={{ marginTop: 4 }}>
              <Text style={[styles.label, { marginBottom: 2 }]}>Weather Variance</Text>
              {s.weatherDays.map((day) => {
                const startLabel = day.startDesc ?? day.startCondition;
                const start = day.startTempF != null
                  ? `${startLabel} (${day.startTempF}°F)`
                  : startLabel ?? "—";
                const endLabel = day.endDesc ?? day.endCondition;
                const end = endLabel != null
                  ? day.endTempF != null
                    ? `${endLabel} (${day.endTempF}°F)`
                    : endLabel
                  : null;
                return (
                  <Text key={day.date} style={styles.weatherEntry}>
                    {day.date}: {start}{end ? ` → ${end}` : ""}
                  </Text>
                );
              })}
            </View>
          )}
        </>
      ) : (
        <Text style={styles.naText}>No weather data for this period.</Text>
      )}
    </View>
  );
}

function VelocityBlock({ s }: { s: StorePeriodSummary }) {
  const hasAny = s.bestDay || s.worstDay || s.bestShiftType;
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Velocity Map (Averages)</Text>
      {hasAny ? (
        <>
          {s.bestDay && (
            <View style={styles.row}>
              <Text style={styles.label}>Best Day</Text>
              <Text style={styles.value}>
                {s.bestDay.label} — {d(s.bestDay.avgSalesCents)} avg
                {s.bestDay.avgTransactions != null ? `, ${s.bestDay.avgTransactions} txn` : ""}
              </Text>
            </View>
          )}
          {s.worstDay && s.worstDay.label !== s.bestDay?.label && (
            <View style={styles.row}>
              <Text style={styles.label}>Worst Day</Text>
              <Text style={styles.value}>
                {s.worstDay.label} — {d(s.worstDay.avgSalesCents)} avg
                {s.worstDay.avgTransactions != null ? `, ${s.worstDay.avgTransactions} txn` : ""}
              </Text>
            </View>
          )}
          {s.bestShiftType && (
            <View style={styles.row}>
              <Text style={styles.label}>Best Shift Type</Text>
              <Text style={styles.value}>
                {s.bestShiftType.label} — {d(s.bestShiftType.avgSalesCents)} avg
                {s.bestShiftType.avgTransactions != null ? `, ${s.bestShiftType.avgTransactions} txn` : ""}
              </Text>
            </View>
          )}
        </>
      ) : (
        <Text style={styles.naText}>No complete sales records for velocity analysis.</Text>
      )}
    </View>
  );
}

// ─── Main PDF Component ───────────────────────────────────────────────────────

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
        {/* Report header */}
        <View style={styles.reportHeader}>
          <Text style={styles.reportTitle}>Executive Store Report: Cross-Store Variance</Text>
          <Text style={styles.reportSubtitle}>Period: {from} – {to}</Text>
          <Text style={styles.reportSubtitle}>Generated: {generated} CST</Text>
        </View>

        {/* One section per store */}
        {summaries.map((s) => (
          <View key={s.storeId} style={styles.storeSection}>
            <View style={styles.storeHeader}>
              <Text style={styles.storeName}>{s.storeName}</Text>
              <Text style={styles.storePeriod}>{s.periodFrom} – {s.periodTo}</Text>
            </View>
            <View style={styles.storeBody}>
              <BlockA s={s} />
              <BlockB s={s} />
              <BlockC s={s} />
              <VelocityBlock s={s} />
            </View>
          </View>
        ))}

        <Text style={styles.footer}>
          Shift Happens — Store Report — {from} to {to}
        </Text>
      </Page>
    </Document>
  );
}
