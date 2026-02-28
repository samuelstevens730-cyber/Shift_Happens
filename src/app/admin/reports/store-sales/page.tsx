"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pdf } from "@react-pdf/renderer";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StoreReportPDF } from "@/components/pdf/StoreReportPDF";
import type { PerformerMetric, StorePeriodSummary } from "@/lib/storeReportAnalyzer";
import { supabase } from "@/lib/supabaseClient";

interface StoreOption {
  id: string;
  name: string;
}

function cstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatCurrencyFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatHours(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

function formatPercent(value: number): string {
  return `${value}%`;
}

function formatMetric(
  metric: PerformerMetric | null,
  formatter: (value: number) => string
): string {
  if (!metric) return "N/A";
  return `${metric.employeeName} - ${formatter(metric.value)} (${metric.shifts} shifts)`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function BlockA({ summary }: { summary: StorePeriodSummary }) {
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Top-Line Velocity
      </p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-zinc-500">Gross Sales (Raw)</p>
          <p className="text-lg font-semibold">
            {summary.grossSalesCents != null ? formatCurrencyFromCents(summary.grossSalesCents) : "N/A"}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Gross Sales (Adjusted)</p>
          <p className="text-lg font-semibold">
            {summary.adjustedGrossSalesCents != null ? formatCurrencyFromCents(summary.adjustedGrossSalesCents) : "N/A"}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Transactions</p>
          <p className="font-medium">{summary.totalTransactions ?? "N/A"}</p>
        </div>
        <div>
          <p className="text-zinc-500">Avg Basket (Raw / Adj)</p>
          <p className="font-medium">
            {summary.avgBasketSizeCents != null ? formatCurrencyFromCents(summary.avgBasketSizeCents) : "N/A"}
            {" / "}
            {summary.adjustedAvgBasketSizeCents != null
              ? formatCurrencyFromCents(summary.adjustedAvgBasketSizeCents)
              : "N/A"}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Labor Hours</p>
          <p className="font-medium">{formatHours(summary.totalLaborHours)}</p>
        </div>
        <div>
          <p className="text-zinc-500">RPLH (Raw / Adj)</p>
          <p className="font-medium">
            {summary.rplhCents != null ? formatCurrencyFromCents(summary.rplhCents) : "N/A"}
            {" / "}
            {summary.adjustedRplhCents != null ? formatCurrencyFromCents(summary.adjustedRplhCents) : "N/A"}
          </p>
        </div>
        <div className="col-span-2 text-xs text-zinc-500">
          Store normalization factor: {summary.storeScalingFactor.toFixed(1)}x
        </div>
      </div>
    </div>
  );
}

function BlockB({ summary }: { summary: StorePeriodSummary }) {
  const hasCloseoutData = summary.cashPct != null || summary.cashRisk.totalVarianceCents != null;
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Risk And Cash Flow
      </p>
      {!hasCloseoutData ? (
        <p className="text-sm italic text-zinc-500">No safe closeout records in this period.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-zinc-500">Payment Split: </span>
            {summary.cashPct != null && summary.cardPct != null
              ? `${formatPercent(summary.cashPct)} cash / ${formatPercent(summary.cardPct)} card`
              : "N/A"}
          </p>
          <p>
            <span className="text-zinc-500">Deposit Variance: </span>
            {summary.depositVarianceCents != null
              ? `${summary.depositVarianceCents < 0 ? "-" : summary.depositVarianceCents > 0 ? "+" : ""}${formatCurrencyFromCents(
                  Math.abs(summary.depositVarianceCents)
                )}`
              : "N/A"}
          </p>
          <p>
            <span className="text-zinc-500">Variance Days: </span>
            {summary.cashRisk.varianceDays}
            {summary.cashRisk.varianceRatePct != null ? ` (${summary.cashRisk.varianceRatePct}%)` : ""}
          </p>
          <p>
            <span className="text-zinc-500">Total Variance: </span>
            {summary.cashRisk.totalVarianceCents != null
              ? `${summary.cashRisk.totalVarianceCents < 0 ? "-" : summary.cashRisk.totalVarianceCents > 0 ? "+" : ""}${formatCurrencyFromCents(
                  Math.abs(summary.cashRisk.totalVarianceCents)
                )}`
              : "N/A"}
          </p>
          <p>
            <span className="text-zinc-500">Avg Variance/Day: </span>
            {summary.cashRisk.avgVariancePerDayCents != null
              ? `${summary.cashRisk.avgVariancePerDayCents < 0 ? "-" : summary.cashRisk.avgVariancePerDayCents > 0 ? "+" : ""}${formatCurrencyFromCents(
                  Math.abs(summary.cashRisk.avgVariancePerDayCents)
                )}`
              : "N/A"}
          </p>
          <p>
            <span className="text-zinc-500">Largest 1-Day Variance: </span>
            {summary.cashRisk.largestSingleDayVarianceCents != null
              ? `${summary.cashRisk.largestSingleDayVarianceCents < 0 ? "-" : summary.cashRisk.largestSingleDayVarianceCents > 0 ? "+" : ""}${formatCurrencyFromCents(
                  Math.abs(summary.cashRisk.largestSingleDayVarianceCents)
                )}`
              : "N/A"}
          </p>
          <p className="text-xs text-zinc-500">{summary.safeCloseoutDayCount} safe-closeout day(s)</p>
        </div>
      )}
    </div>
  );
}

function VolatilityCard({ summary }: { summary: StorePeriodSummary }) {
  const volatility = summary.volatility;
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Distribution And Volatility
      </p>
      {volatility.stdDevDailySalesCents == null ? (
        <p className="text-sm italic text-zinc-500">Not enough day-level sales to compute volatility.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-zinc-500">Std Dev (Daily Sales): </span>
            {formatCurrencyFromCents(volatility.stdDevDailySalesCents)}
          </p>
          <p>
            <span className="text-zinc-500">Coefficient of Variation: </span>
            {volatility.coefficientOfVariationPct != null ? `${volatility.coefficientOfVariationPct}%` : "N/A"}
          </p>
          <p>
            <span className="text-zinc-500">Outlier Days: </span>
            {volatility.belowOneSigmaDays} below -1 sigma / {volatility.aboveOneSigmaDays} above +1 sigma
          </p>
          <p>
            <span className="text-zinc-500">Largest 1-Day Swing Up: </span>
            {volatility.largestUpSwingCents != null ? formatCurrencyFromCents(volatility.largestUpSwingCents) : "N/A"}
          </p>
          <p>
            <span className="text-zinc-500">Largest 1-Day Swing Down: </span>
            {volatility.largestDownSwingCents != null ? formatCurrencyFromCents(volatility.largestDownSwingCents) : "N/A"}
          </p>
        </div>
      )}
    </div>
  );
}

function WeatherSummaryCard({ summary }: { summary: StorePeriodSummary }) {
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Weather Summary
      </p>
      {summary.weatherTrend == null ? (
        <p className="text-sm italic text-zinc-500">No weather data for this date range.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-zinc-500">Trend: </span>
            {summary.weatherTrend}
          </p>
          <p>
            <span className="text-zinc-500">Dominant Mix: </span>
            {summary.weatherSummary.conditionMix.length > 0
              ? summary.weatherSummary.conditionMix
                  .slice(0, 4)
                  .map((entry) => `${entry.condition} ${entry.pct}%`)
                  .join(", ")
              : "N/A"}
          </p>
          <p>
            <span className="text-zinc-500">Temp Min/Avg/Max: </span>
            {summary.weatherSummary.tempMinF != null &&
            summary.weatherSummary.tempAvgF != null &&
            summary.weatherSummary.tempMaxF != null
              ? `${summary.weatherSummary.tempMinF}F / ${summary.weatherSummary.tempAvgF}F / ${summary.weatherSummary.tempMaxF}F`
              : "N/A"}
          </p>
          {summary.weatherSummary.outlierFlags.length > 0 && (
            <div className="space-y-1">
              {summary.weatherSummary.outlierFlags.map((flag) => (
                <p key={flag} className="text-amber-300">
                  {flag}
                </p>
              ))}
            </div>
          )}
          {summary.weatherSummary.weatherImpactHint && (
            <p className="text-emerald-300">{summary.weatherSummary.weatherImpactHint}</p>
          )}
        </div>
      )}
    </div>
  );
}

function VelocityCard({ summary }: { summary: StorePeriodSummary }) {
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Velocity Map</p>
      {summary.bestDay || summary.bestShiftType ? (
        <div className="space-y-1 text-sm">
          {summary.bestDay && (
            <p>
              <span className="text-zinc-500">Best Day: </span>
              {summary.bestDay.label} - {formatCurrencyFromCents(summary.bestDay.avgSalesCents)}
            </p>
          )}
          {summary.worstDay && summary.worstDay.label !== summary.bestDay?.label && (
            <p>
              <span className="text-zinc-500">Worst Day: </span>
              {summary.worstDay.label} - {formatCurrencyFromCents(summary.worstDay.avgSalesCents)}
            </p>
          )}
          {summary.bestShiftType && (
            <p>
              <span className="text-zinc-500">Best Shift Type: </span>
              <span className="capitalize">{summary.bestShiftType.label}</span> -{" "}
              {formatCurrencyFromCents(summary.bestShiftType.avgSalesCents)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm italic text-zinc-500">No velocity data in this range.</p>
      )}
    </div>
  );
}

function DailyTrendChart({ summary }: { summary: StorePeriodSummary }) {
  if (summary.dailyTrend.length === 0) {
    return (
      <div className="rounded border border-zinc-700 p-4">
        <p className="text-sm italic text-zinc-500">No daily trend data available.</p>
      </div>
    );
  }

  const data = summary.dailyTrend.map((point) => ({
    date: point.date.slice(5),
    sales: Number((point.salesCents / 100).toFixed(2)),
    adjustedSales: Number((point.adjustedSalesCents / 100).toFixed(2)),
    rolling: Number((point.rolling7SalesCents / 100).toFixed(2)),
    adjustedRolling: Number((point.adjustedRolling7SalesCents / 100).toFixed(2)),
    labor: Number(point.laborHours.toFixed(1)),
  }));

  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Daily Sales Trend
      </p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="date" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="sales" stroke="#a1a1aa" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="labor" orientation="right" stroke="#71717a" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", color: "#fafafa" }}
              formatter={(value: unknown, name?: string) => {
                const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                const label = name ?? "Value";
                if (label === "Labor Hours") return [numericValue.toFixed(1), label];
                return [`$${numericValue.toFixed(2)}`, label];
              }}
            />
            <Legend
              verticalAlign="top"
              align="left"
              iconType="circle"
              wrapperStyle={{ fontSize: 11, color: "#d4d4d8" }}
            />
            <Bar yAxisId="labor" dataKey="labor" name="Labor Hours" fill="#3f3f46" opacity={0.55} />
            <Line yAxisId="sales" type="monotone" dataKey="sales" name="Daily Sales" stroke="#22d3ee" strokeWidth={2} dot={false} />
            <Line yAxisId="sales" type="monotone" dataKey="adjustedSales" name="Adjusted Daily Sales" stroke="#38bdf8" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
            <Line
              yAxisId="sales"
              type="monotone"
              dataKey="rolling"
              name="7d Rolling Avg (Raw)"
              stroke="#facc15"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="sales"
              type="monotone"
              dataKey="adjustedRolling"
              name="7d Rolling Avg (Adjusted)"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="4 4"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DayOfWeekTable({ summary }: { summary: StorePeriodSummary }) {
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Day-of-Week Averages
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-2 pr-3">Day</th>
              <th className="py-2 pr-3">Avg Sales</th>
              <th className="py-2 pr-3">Avg Txn</th>
              <th className="py-2 pr-3">Avg Basket</th>
              <th className="py-2 pr-3">Avg Labor</th>
              <th className="py-2 pr-3">Avg RPLH</th>
              <th className="py-2 pr-3">Samples</th>
            </tr>
          </thead>
          <tbody>
            {summary.dayOfWeekAverages.map((row) => (
              <tr key={row.day} className="border-t border-zinc-800">
                <td className="py-2 pr-3">{row.day.slice(0, 3)}</td>
                <td className="py-2 pr-3">{row.avgSalesCents != null ? formatCurrencyFromCents(row.avgSalesCents) : "N/A"}</td>
                <td className="py-2 pr-3">{row.avgTransactions != null ? row.avgTransactions.toFixed(1) : "N/A"}</td>
                <td className="py-2 pr-3">
                  {row.avgBasketSizeCents != null ? formatCurrencyFromCents(row.avgBasketSizeCents) : "N/A"}
                </td>
                <td className="py-2 pr-3">{row.avgLaborHours != null ? formatHours(row.avgLaborHours) : "N/A"}</td>
                <td className="py-2 pr-3">{row.avgRplhCents != null ? formatCurrencyFromCents(row.avgRplhCents) : "N/A"}</td>
                <td className="py-2 pr-3">{row.sampleDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopPerformersCard({ summary }: { summary: StorePeriodSummary }) {
  const { volume, efficiency } = summary.topPerformers;
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Top Performers
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm">
          <p className="font-medium text-zinc-300">Volume Leaders</p>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Total Sales</p>
            <p>{formatMetric(volume.totalSales, (value) => formatCurrencyFromCents(value))}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Total Transactions</p>
            <p>{formatMetric(volume.totalTransactions, (value) => `${Math.round(value)} txns`)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Total Labor Hours</p>
            <p>{formatMetric(volume.totalLaborHours, (value) => `${value.toFixed(1)}h`)}</p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-medium text-zinc-300">Efficiency Leaders</p>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">RPLH (Sales Per Labor Hour)</p>
            <p>{formatMetric(efficiency.rplh, (value) => `${formatCurrencyFromCents(value)}/hr`)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Transactions Per Labor Hour</p>
            <p>{formatMetric(efficiency.transactionsPerLaborHour, (value) => `${value.toFixed(1)} txn/hr`)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Basket Size</p>
            <p>{formatMetric(efficiency.basketSize, (value) => formatCurrencyFromCents(value))}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftTypeBreakdownTable({ summary }: { summary: StorePeriodSummary }) {
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Shift-Type Breakdown
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-2 pr-3">Shift Type</th>
              <th className="py-2 pr-3">Avg Sales</th>
              <th className="py-2 pr-3">Avg Txn</th>
              <th className="py-2 pr-3">Avg Basket</th>
              <th className="py-2 pr-3">Avg RPLH</th>
              <th className="py-2 pr-3">Sample (n)</th>
            </tr>
          </thead>
          <tbody>
            {summary.shiftTypeBreakdown.map((row) => (
              <tr key={row.shiftType} className="border-t border-zinc-800">
                <td className="py-2 pr-3 capitalize">{row.shiftType}</td>
                <td className="py-2 pr-3">{row.avgSalesCents != null ? formatCurrencyFromCents(row.avgSalesCents) : "N/A"}</td>
                <td className="py-2 pr-3">{row.avgTransactions != null ? row.avgTransactions.toFixed(1) : "N/A"}</td>
                <td className="py-2 pr-3">{row.avgBasketCents != null ? formatCurrencyFromCents(row.avgBasketCents) : "N/A"}</td>
                <td className="py-2 pr-3">{row.avgRplhCents != null ? formatCurrencyFromCents(row.avgRplhCents) : "N/A"}</td>
                <td className="py-2 pr-3">{row.sampleSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataIntegrityCard({ summary }: { summary: StorePeriodSummary }) {
  const integrity = summary.dataIntegrity;
  return (
    <div className="rounded border border-zinc-700 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Data Integrity
      </p>
      <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        <p>
          <span className="text-zinc-500">Expected Days: </span>
          {integrity.expectedDays}
        </p>
        <p>
          <span className="text-zinc-500">Missing Sales Days: </span>
          {integrity.missingSalesDays}
        </p>
        <p>
          <span className="text-zinc-500">Days Missing Txn Count: </span>
          {integrity.missingTransactionDays}
        </p>
        <p>
          <span className="text-zinc-500">Days Missing Labor: </span>
          {integrity.missingLaborDays}
        </p>
        <p>
          <span className="text-zinc-500">Rollover Adjustments Applied: </span>
          {integrity.rolloverAdjustedDays}
        </p>
        <p>
          <span className="text-zinc-500">Late Closeouts / Overrides / Audit Flags: </span>
          {integrity.lateCloseouts ?? "N/A"} / {integrity.manualOverrides ?? "N/A"} /{" "}
          {integrity.auditFlagsTriggered ?? "N/A"}
        </p>
      </div>
    </div>
  );
}

function StoreCard({ summary }: { summary: StorePeriodSummary }) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-700">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-700 bg-zinc-800 px-4 py-3">
        <h2 className="text-lg font-semibold">{summary.storeName}</h2>
        <p className="text-xs text-zinc-500">
          {summary.periodFrom} - {summary.periodTo}
        </p>
      </header>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BlockA summary={summary} />
          <BlockB summary={summary} />
          <WeatherSummaryCard summary={summary} />
          <VelocityCard summary={summary} />
          <VolatilityCard summary={summary} />
          <DataIntegrityCard summary={summary} />
        </div>
        <DailyTrendChart summary={summary} />
        <DayOfWeekTable summary={summary} />
        <ShiftTypeBreakdownTable summary={summary} />
        <TopPerformersCard summary={summary} />
      </div>
    </section>
  );
}

export default function StoreReportPage() {
  const router = useRouter();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);

  const today = useMemo(() => cstDateKey(new Date()), []);
  const twoWeeksAgo = useMemo(() => cstDateKey(addDays(new Date(), -13)), []);
  const [from, setFrom] = useState(twoWeeksAgo);
  const [to, setTo] = useState(today);
  const [storeId, setStoreId] = useState("all");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<StorePeriodSummary[] | null>(null);
  const [llmText, setLlmText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token ?? null;
      setAuthToken(token);
      if (!token) {
        router.push("/admin/login");
        return;
      }
      fetch("/api/admin/reports/store-sales?meta=true", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((json) => setStores(json.stores ?? []))
        .catch(() => setStores([]));
    });
  }, [router]);

  const generate = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setError(null);
    setSummaries(null);
    setLlmText(null);
    try {
      const params = new URLSearchParams({ from, to, storeId, format: "json" });
      const res = await fetch(`/api/admin/reports/store-sales?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to load report.");
        return;
      }
      setSummaries(json.summaries ?? []);

      const textParams = new URLSearchParams({ from, to, storeId, format: "text" });
      const textRes = await fetch(`/api/admin/reports/store-sales?${textParams.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (textRes.ok) {
        setLlmText(await textRes.text());
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [authToken, from, to, storeId]);

  const handleCopy = useCallback(async () => {
    if (!llmText) return;
    try {
      await navigator.clipboard.writeText(llmText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      if (textareaRef.current) {
        textareaRef.current.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }
  }, [llmText]);

  const handlePdf = useCallback(async () => {
    if (!summaries) return;
    setPdfLoading(true);
    try {
      const blob = await pdf(<StoreReportPDF summaries={summaries} from={from} to={to} />).toBlob();
      downloadBlob(blob, `store-report-${from}-to-${to}.pdf`);
    } catch (err) {
      console.error("PDF generation failed", err);
    } finally {
      setPdfLoading(false);
    }
  }, [from, summaries, to]);

  return (
    <div className="mx-auto min-h-screen max-w-6xl space-y-6 bg-zinc-900 p-4 text-zinc-100 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Store Report</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Rollover-aware store performance, weather summary, trend chart, and top performers.
        </p>
      </header>

      <section className="rounded-lg border border-zinc-700 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-zinc-500">From</span>
            <input
              type="date"
              className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-zinc-500">To</span>
            <input
              type="date"
              className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-xs text-zinc-500">Store</span>
            <select
              className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm"
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
            >
              <option value="all">Both Stores</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate Report"}
          </button>
          {summaries && summaries.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800"
              >
                {copied ? "Copied" : "Copy LLM Export"}
              </button>
              <button
                type="button"
                onClick={handlePdf}
                disabled={pdfLoading}
                className="rounded border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
              >
                {pdfLoading ? "Building PDF..." : "Download PDF"}
              </button>
            </>
          )}
        </div>
      </section>

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {summaries && summaries.length > 0 && (
        <div className="space-y-6">
          {summaries.map((summary) => (
            <StoreCard key={summary.storeId} summary={summary} />
          ))}
          {llmText && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-500">LLM Export</p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded border border-zinc-600 px-3 py-1 text-xs hover:bg-zinc-800"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <textarea
                ref={textareaRef}
                readOnly
                value={llmText}
                className="h-64 w-full resize-y rounded border border-zinc-700 bg-zinc-900 p-3 font-mono text-xs text-zinc-300"
              />
            </section>
          )}
        </div>
      )}

      {summaries && summaries.length === 0 && (
        <div className="rounded border border-zinc-700 p-6 text-center text-sm text-zinc-500">
          No data found for the selected filters.
        </div>
      )}
    </div>
  );
}
