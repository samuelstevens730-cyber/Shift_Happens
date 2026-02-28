"use client";

/**
 * /admin/reports/performance-summary
 *
 * Sales Performance Report — view, export (copy text / print), and save snapshots.
 * Uses the /api/admin/reports/performance-summary endpoint.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { EmployeePeriodSummary } from "@/lib/salesAnalyzer";
import type { PeriodDelta } from "@/lib/salesDelta";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function d(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function signedMoneyDelta(cents: number | null | undefined): string {
  if (cents == null) return "N/A vs prev";
  const sign = cents >= 0 ? "+" : "-";
  return `${sign}${d(Math.abs(cents))} vs prev`;
}

function signedNumberDelta(value: number | null | undefined, digits = 1): string {
  if (value == null) return "N/A vs prev";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(digits)} vs prev`;
}

function pct(value: number): string {
  return `${value.toFixed(0)}%`;
}

function streakLabel(streak: number): string {
  if (streak === 0) return "—";
  const abs = Math.abs(streak);
  const dir = streak > 0 ? "HIGH" : "LOW";
  return `${streak > 0 ? "+" : "-"}${abs} (${abs}× ${dir})`;
}

function trendBadge(trending: PeriodDelta["trending"]): { label: string; cls: string } {
  if (trending === "UP") return { label: "↑ UP", cls: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" };
  if (trending === "DOWN") return { label: "↓ DOWN", cls: "bg-red-500/20 text-red-300 border border-red-500/30" };
  return { label: "→ FLAT", cls: "bg-zinc-700/60 text-zinc-300 border border-zinc-600" };
}

function streakBadgeClass(streak: number): string {
  if (streak >= 3) return "text-emerald-400";
  if (streak <= -3) return "text-red-400";
  return "text-zinc-400";
}

function flagColor(flag: EmployeePeriodSummary["shifts"][number]["performanceFlag"]): string {
  if (flag === "HIGH") return "text-emerald-400";
  if (flag === "LOW") return "text-red-400";
  return "text-zinc-400";
}

// ─── API Response Type ────────────────────────────────────────────────────────

interface ReportResponse {
  period: { from: string; to: string; label?: string; reportType: string };
  benchmark: number | null;
  storeFactors: Record<string, number>;
  employees: EmployeePeriodSummary[];
  deltas?: PeriodDelta[];
  snapshotSaved: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmployeeCard({
  summary,
  delta,
  benchmark,
  goalBenchmarkCents = null,
  showTransactions = false,
  expandAll = false,
}: {
  summary: EmployeePeriodSummary;
  delta: PeriodDelta | undefined;
  benchmark: number | null;
  goalBenchmarkCents?: number | null;
  showTransactions?: boolean;
  expandAll?: boolean;
}) {
  const [showShifts, setShowShifts] = useState(false);
  const [showBreakdowns, setShowBreakdowns] = useState(false);

  // Sync with expandAll prop: force-expand when true, collapse when false
  useEffect(() => {
    setShowShifts(expandAll);
    setShowBreakdowns(expandAll);
  }, [expandAll]);

  const gapSign = (summary.gapVsBenchmarkCents ?? 0) >= 0 ? "+" : "";
  const gapColor =
    (summary.gapVsBenchmarkCents ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

  // Goal benchmark gap (client-computed from the manually entered target)
  const goalGapCents =
    goalBenchmarkCents != null
      ? summary.avgAdjustedPerShiftCents - goalBenchmarkCents
      : null;
  const goalGapSign = (goalGapCents ?? 0) >= 0 ? "+" : "";
  const goalGapColor = (goalGapCents ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

  // Dynamic column count for the key-metrics grid
  const metricColCount = 4 + (goalBenchmarkCents != null ? 1 : 0) + (showTransactions ? 1 : 0);
  const metricsColClass = (
    { 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6" } as Record<number, string>
  )[metricColCount] ?? "sm:grid-cols-4";

  const trend = delta ? trendBadge(delta.trending) : null;

  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/50 overflow-hidden print:break-before-page print:border-0 print:shadow-none">
      {/* ── Card header ── */}
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-700/50 bg-zinc-800/80">
        <div>
          <p className="text-base font-semibold text-zinc-100 tracking-wide">
            {summary.employeeName}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {summary.primaryStore} · {summary.totalShifts} shifts ({summary.countableShifts} w/ sales) · {summary.totalHours.toFixed(1)} hrs
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {trend && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${trend.cls}`}>
              {trend.label}
            </span>
          )}
          {summary.currentStreak !== 0 && (
            <span className={`text-xs font-medium ${streakBadgeClass(summary.currentStreak)}`}>
              Streak: {streakLabel(summary.currentStreak)}
            </span>
          )}
        </div>
      </div>

      {/* ── Key metrics ── */}
      <div className={`px-5 py-4 grid gap-4 grid-cols-2 ${metricsColClass}`}>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Adj Avg / Shift</p>
          <p className="text-xl font-semibold text-zinc-100">{d(summary.avgAdjustedPerShiftCents)}</p>
          {delta && (
            <p className="text-xs text-zinc-500 mt-0.5">{signedMoneyDelta(delta.adjAvgDeltaCents)}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Raw Avg / Shift</p>
          <p className="text-xl font-semibold text-zinc-300">{d(summary.avgRawPerShiftCents)}</p>
          {delta && (
            <p className="text-xs text-zinc-500 mt-0.5">{signedMoneyDelta(delta.rawAvgDeltaCents)}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Adj / Hr</p>
          <p className="text-xl font-semibold text-zinc-300">{d(summary.avgAdjustedPerHourCents)}</p>
          {delta && (
            <p className="text-xs text-zinc-500 mt-0.5">{signedMoneyDelta(delta.adjustedPerHourDeltaCents)}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">vs Benchmark</p>
          {benchmark != null && summary.gapVsBenchmarkCents != null ? (
            <p className={`text-xl font-semibold ${gapColor}`}>
              {gapSign}{d(summary.gapVsBenchmarkCents)}
            </p>
          ) : (
            <p className="text-xl font-semibold text-zinc-500">—</p>
          )}
          {benchmark != null && (
            <p className="text-xs text-zinc-500 mt-0.5">{d(benchmark)} target</p>
          )}
        </div>
        {goalBenchmarkCents != null && (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">vs Goal</p>
            <p className={`text-xl font-semibold ${goalGapColor}`}>
              {goalGapSign}{d(goalGapCents!)}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">{d(goalBenchmarkCents)} target</p>
          </div>
        )}
        {showTransactions && (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Txn / Shift</p>
            {summary.transactionTrackedShifts > 0 && summary.avgTransactionsPerShift != null ? (
              <>
                <p className="text-xl font-semibold text-zinc-100">
                  {summary.avgTransactionsPerShift.toFixed(1)}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {summary.avgSalesPerTransactionCents != null
                    ? `${d(summary.avgSalesPerTransactionCents)}/txn · `
                    : ""}
                  {summary.transactionTrackedShifts}/{summary.totalShifts} shifts
                </p>
              </>
            ) : (
              <>
                <p className="text-xl font-semibold text-zinc-500">—</p>
                <p className="text-xs text-zinc-500 mt-0.5">no data yet</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Flag row ── */}
      <div className="px-5 pb-4 flex flex-wrap gap-4 text-sm">
        <span className="text-emerald-400 font-medium">
          ↑ {summary.highFlagCount} HIGH ({pct(summary.highFlagPct)})
        </span>
        <span className="text-red-400 font-medium">
          ↓ {summary.lowFlagCount} LOW ({pct(summary.lowFlagPct)})
        </span>
        <span className="text-zinc-400">
          · {summary.normalFlagCount} NORMAL
        </span>
        {summary.estimatedMonthlyGapCents != null && (
          <span className={`${gapColor} text-xs`}>
            Est. monthly gap: {gapSign}{d(summary.estimatedMonthlyGapCents)}
          </span>
        )}
      </div>

      {/* ── Delta notable changes ── */}
      {delta && delta.notableChanges.length > 0 && (
        <div className="mx-5 mb-4 rounded-lg bg-zinc-700/30 border border-zinc-600/40 px-4 py-3 text-xs text-zinc-300 space-y-1 print:block">
          <p className="text-zinc-400 font-medium mb-1 uppercase tracking-wider text-[10px]">vs Last Period</p>
          {delta.notableChanges.map((note, i) => (
            <p key={i}>· {note}</p>
          ))}
        </div>
      )}

      {/* ── Expandable: breakdowns ── */}
      <div className="border-t border-zinc-700/40 print:block">
        <button
          onClick={() => setShowBreakdowns((v) => !v)}
          className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30 transition-colors print:hidden"
        >
          <span>Shift type &amp; day breakdowns</span>
          <span>{showBreakdowns ? "▲" : "▼"}</span>
        </button>

        {(showBreakdowns) && (
          <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-6 print:grid print:grid-cols-2">
            {/* By shift type */}
            {summary.byShiftType.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">By Shift Type</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-700/40">
                      <th className="text-left pb-1 font-medium">Type</th>
                      <th className="text-right pb-1 font-medium">Shifts</th>
                      <th className="text-right pb-1 font-medium">Adj Avg</th>
                      <th className="text-right pb-1 font-medium">Hi/Lo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-700/30">
                    {summary.byShiftType.map((b) => (
                      <tr key={b.type} className="text-zinc-300">
                        <td className="py-1 capitalize">{b.type}</td>
                        <td className="text-right py-1">{b.shifts}</td>
                        <td className="text-right py-1">{d(b.avgAdjustedCents)}</td>
                        <td className="text-right py-1">
                          <span className="text-emerald-400">{b.highCount}</span>
                          <span className="text-zinc-500">/</span>
                          <span className="text-red-400">{b.lowCount}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* By day of week */}
            {summary.byDayOfWeek.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">By Day of Week</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-700/40">
                      <th className="text-left pb-1 font-medium">Day</th>
                      <th className="text-right pb-1 font-medium">Shifts</th>
                      <th className="text-right pb-1 font-medium">Adj Avg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-700/30">
                    {[...summary.byDayOfWeek]
                      .sort((a, b) => b.avgAdjustedCents - a.avgAdjustedCents)
                      .map((b) => (
                        <tr key={b.day} className="text-zinc-300">
                          <td className="py-1">{b.day}</td>
                          <td className="text-right py-1">{b.shifts}</td>
                          <td className="text-right py-1">{d(b.avgAdjustedCents)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Expandable: shift detail ── */}
      {summary.shifts.filter((s) => s.isCountable).length > 0 && (
        <div className="border-t border-zinc-700/40 print:block">
          <button
            onClick={() => setShowShifts((v) => !v)}
            className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30 transition-colors print:hidden"
          >
            <span>Shift detail ({summary.shifts.filter((s) => s.isCountable).length} countable)</span>
            <span>{showShifts ? "▲" : "▼"}</span>
          </button>

          {(showShifts) && (
            <div className="px-5 pb-4 overflow-x-auto print:block">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-700/40">
                    <th className="text-left pb-1 font-medium">Date</th>
                    <th className="text-left pb-1 font-medium">Day</th>
                    <th className="text-left pb-1 font-medium">Type</th>
                    <th className="text-right pb-1 font-medium">Adj</th>
                    <th className="text-right pb-1 font-medium">Raw</th>
                    <th className="text-right pb-1 font-medium">Hrs</th>
                    <th className="text-right pb-1 font-medium">Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-700/30">
                  {summary.shifts
                    .filter((s) => s.isCountable)
                    .flatMap((s) => {
                      const mainRow = (
                        <tr key={s.shiftId} className="text-zinc-300 hover:bg-zinc-700/20">
                          <td className="py-1 pr-3 whitespace-nowrap">{s.date}</td>
                          <td className="py-1 pr-3">{s.dayOfWeek.slice(0, 3)}</td>
                          <td className="py-1 pr-3 capitalize">{s.shiftType}</td>
                          <td className="text-right py-1 pr-2">
                            {s.adjustedSalesCents != null ? d(s.adjustedSalesCents) : "—"}
                          </td>
                          <td className="text-right py-1 pr-2 text-zinc-500">
                            {s.rawSalesCents != null ? d(s.rawSalesCents) : "—"}
                          </td>
                          <td className="text-right py-1 pr-2 text-zinc-500">
                            {s.shiftHours > 0 ? s.shiftHours.toFixed(1) : "—"}
                          </td>
                          <td className={`text-right py-1 font-medium ${flagColor(s.performanceFlag)}`}>
                            {s.performanceFlag ?? "—"}
                          </td>
                        </tr>
                      );
                      // Sub-rows: AM/PM split and/or weather (stacked if both apply)
                      const subRows: React.ReactNode[] = [];

                      const hasAmPm =
                        s.shiftType === "double" &&
                        (s.amRawSalesCents != null || s.pmRawSalesCents != null);
                      if (hasAmPm) {
                        const amStr = s.amRawSalesCents != null ? d(s.amRawSalesCents) : "—";
                        const pmStr = s.pmRawSalesCents != null ? d(s.pmRawSalesCents) : "—";
                        const amTxn = s.amTransactionCount != null ? ` · ${s.amTransactionCount} txn` : "";
                        const pmTxn = s.pmTransactionCount != null ? ` · ${s.pmTransactionCount} txn` : "";
                        subRows.push(
                          <tr key={`${s.shiftId}-split`} className="text-zinc-500 text-[11px]">
                            <td colSpan={7} className="pb-0.5 pl-4 italic">
                              ↳ AM: {amStr}{amTxn} &nbsp;|&nbsp; PM: {pmStr}{pmTxn}
                            </td>
                          </tr>
                        );
                      }

                      if (s.startWeatherCondition != null) {
                        const startLabel = s.startWeatherDesc ?? s.startWeatherCondition;
                        const startW = s.startTempF != null
                          ? `${startLabel} (${s.startTempF}°F)`
                          : startLabel;
                        const endLabel = s.endWeatherDesc ?? s.endWeatherCondition;
                        const endW = endLabel != null
                          ? s.endTempF != null
                            ? `${endLabel} (${s.endTempF}°F)`
                            : endLabel
                          : null;
                        subRows.push(
                          <tr key={`${s.shiftId}-weather`} className="text-zinc-500 text-[11px]">
                            <td colSpan={7} className="pb-1 pl-4 italic">
                              ☁ {startW}{endW ? ` → ${endW}` : ""}
                            </td>
                          </tr>
                        );
                      }

                      if (subRows.length === 0) return [mainRow];
                      return [mainRow, ...subRows];
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PerformanceSummaryPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  // Controls
  const [from, setFrom] = useState(() => cstDateKey(addDays(new Date(), -13)));
  const [to, setTo] = useState(() => cstDateKey(new Date()));
  const [storeId, setStoreId] = useState("all");
  const [employeeId, setEmployeeId] = useState("");
  const [reportType, setReportType] = useState<"biweekly" | "monthly" | "quarterly" | "custom">("biweekly");
  const [periodLabel, setPeriodLabel] = useState("");
  const [includeDelta, setIncludeDelta] = useState(true);
  const [saveSnapshot, setSaveSnapshot] = useState(false);
  const [benchmarkIds, setBenchmarkIds] = useState("8e6fc70a-55df-467c-9e37-0f1f74c6f2fd, b576b7ac-95d3-43e2-9a86-3027abfdef5d");
  const [goalBenchmark, setGoalBenchmark] = useState(""); // dollar amount per shift, e.g. "350"
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Employees/stores for dropdowns
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string | null }[]>([]);

  // Report state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);

  // Copy state: tracks which copy (primary|full) is in-flight or just succeeded
  const [copyStatus, setCopyStatus] = useState<{ detail: "primary" | "full"; status: "copying" | "success" } | null>(null);

  // Expand-all: when true every EmployeeCard forces both expandable sections open (used for Print Full)
  const [expandAll, setExpandAll] = useState(false);

  const reportRef = useRef<HTMLDivElement>(null);

  // Reset expandAll after the print dialog closes
  useEffect(() => {
    const handler = () => setExpandAll(false);
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, []);

  // ── Auth + load stores/employees ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const t = session?.access_token ?? "";
      if (!t) {
        router.replace("/login?next=/admin/reports/performance-summary");
        return;
      }
      setToken(t);

      // Load stores + employees for filters via the meta endpoint
      const metaRes = await fetch("/api/admin/reports/performance-summary?meta=true", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (metaRes.ok) {
        const meta = await metaRes.json() as {
          stores: { id: string; name: string }[];
          profiles: { id: string; name: string | null }[];
        };
        setStores(meta.stores ?? []);
        setEmployees(meta.profiles ?? []);
      }
    })();
  }, [router]);

  // Auto-suggest period label when type/dates change
  useEffect(() => {
    if (reportType === "quarterly") {
      const year = from.slice(0, 4);
      const month = parseInt(from.slice(5, 7), 10);
      const q = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
      setPeriodLabel(`${q} ${year}`);
    } else if (reportType === "monthly") {
      const dt = new Date(`${from}T12:00:00Z`);
      const label = dt.toLocaleString("en-US", { month: "long", year: "numeric" });
      setPeriodLabel(label);
    } else if (reportType === "biweekly") {
      // Leave as-is or suggest based on dates
    }
  }, [reportType, from]);

  // ── Generate report ──────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const qs = new URLSearchParams({
        from,
        to,
        storeId: storeId || "all",
        reportType,
        includeDelta: String(includeDelta),
        saveSnapshot: String(saveSnapshot),
      });
      if (employeeId) qs.set("employeeId", employeeId);
      if (periodLabel.trim()) qs.set("periodLabel", periodLabel.trim());
      if (benchmarkIds.trim()) qs.set("benchmarkEmployeeIds", benchmarkIds.trim());

      const res = await fetch(`/api/admin/reports/performance-summary?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string })?.error || "Failed to generate report.");
      setReport(json as ReportResponse);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate report.");
    } finally {
      setLoading(false);
    }
  }, [token, from, to, storeId, reportType, includeDelta, saveSnapshot, employeeId, periodLabel, benchmarkIds]);

  // ── Copy as text (primary = compact, full = all breakdowns + shift detail) ───
  const copyReport = useCallback(async (detail: "primary" | "full") => {
    if (!token) return;
    setCopyStatus({ detail, status: "copying" });
    try {
      const qs = new URLSearchParams({
        from,
        to,
        storeId: storeId || "all",
        reportType,
        includeDelta: String(includeDelta),
        format: "text",
      });
      if (detail === "full") qs.set("detail", "full");
      if (employeeId) qs.set("employeeId", employeeId);
      if (periodLabel.trim()) qs.set("periodLabel", periodLabel.trim());
      if (benchmarkIds.trim()) qs.set("benchmarkEmployeeIds", benchmarkIds.trim());
      // Pass goal benchmark so the text report includes the "vs Goal" line
      const _goalCents =
        goalBenchmark.trim() !== "" && !isNaN(parseFloat(goalBenchmark)) && parseFloat(goalBenchmark) > 0
          ? Math.round(parseFloat(goalBenchmark) * 100)
          : null;
      if (_goalCents != null) qs.set("goalBenchmarkCents", String(_goalCents));

      const res = await fetch(`/api/admin/reports/performance-summary?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch text report.");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopyStatus({ detail, status: "success" });
      setTimeout(() => setCopyStatus(null), 2500);
    } catch {
      setCopyStatus(null);
    }
  }, [token, from, to, storeId, reportType, includeDelta, employeeId, periodLabel, benchmarkIds, goalBenchmark]);

  // ── Print helpers ─────────────────────────────────────────────────────────────
  const printPrimary = useCallback(() => {
    // Print whatever is currently visible (no forced expansion)
    window.print();
  }, []);

  const printFull = useCallback(() => {
    // Force-expand all sections, then print once React has re-rendered
    setExpandAll(true);
    setTimeout(() => window.print(), 350);
  }, []);

  const deltaMap = new Map((report?.deltas ?? []).map((d) => [d.employeeId, d]));

  // Derive goalBenchmarkCents from the dollar input (null if blank/invalid)
  const goalBenchmarkCents =
    goalBenchmark.trim() !== "" && !isNaN(parseFloat(goalBenchmark)) && parseFloat(goalBenchmark) > 0
      ? Math.round(parseFloat(goalBenchmark) * 100)
      : null;

  // Show the Txn/Shift column only when at least one employee in the current report
  // has tracked transaction data — hides the column entirely for historical-only periods.
  const anyHasTransactions =
    report?.employees.some((emp) => emp.transactionTrackedShifts > 0) ?? false;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Print CSS ── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; color: black; }
          .print-card { break-before: page; border: 1px solid #ccc; margin-bottom: 16px; }
        }
      `}</style>

      <div className="min-h-screen bg-zinc-900 text-zinc-100 pb-24">
        <div className="max-w-5xl mx-auto px-4 py-8">

          {/* ── Page header ── */}
          <div className="mb-8 no-print">
            <h1 className="text-2xl font-bold text-zinc-100">Sales Performance Report</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Analyze employee sales by period. Generate, review, and export reports for sales meetings.
            </p>
          </div>

          {/* ── Controls ── */}
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/50 p-5 mb-6 no-print">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {/* Date range */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">From</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">To</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              {/* Store */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Store</label>
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="all">All Stores</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Employee */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Employee</label>
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">All Employees</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name ?? e.id}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
              {/* Report type */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Report Type</label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as typeof reportType)}
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* Period label */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Period Label (optional)</label>
                <input
                  type="text"
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  placeholder={`e.g. "February Biweekly 1"`}
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              {/* Goal Benchmark */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Goal Benchmark ($/shift)
                  <span className="ml-1 text-zinc-500 font-normal">— achievable target</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none">$</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={goalBenchmark}
                    onChange={(e) => setGoalBenchmark(e.target.value)}
                    placeholder="e.g. 350"
                    className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 pl-7 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-1">Leave blank to hide vs-goal column.</p>
              </div>

              {/* Checkboxes */}
              <div className="flex flex-col justify-end gap-2 pb-0.5">
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeDelta}
                    onChange={(e) => setIncludeDelta(e.target.checked)}
                    className="rounded border-zinc-500 bg-zinc-700 text-sky-500 focus:ring-sky-500"
                  />
                  Include period-over-period delta
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveSnapshot}
                    onChange={(e) => setSaveSnapshot(e.target.checked)}
                    className="rounded border-zinc-500 bg-zinc-700 text-sky-500 focus:ring-sky-500"
                  />
                  Save snapshot after generating
                </label>
              </div>
            </div>

            {/* Advanced options */}
            <div className="mb-4">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {showAdvanced ? "▲ Hide" : "▼ Show"} advanced options
              </button>
              {showAdvanced && (
                <div className="mt-3">
                  <label className="block text-xs text-zinc-400 mb-1">
                    Benchmark Employee IDs (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={benchmarkIds}
                    onChange={(e) => setBenchmarkIds(e.target.value)}
                    placeholder="uuid1, uuid2, ..."
                    className="w-full rounded-lg border border-zinc-600 bg-zinc-700/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    Leave blank to skip benchmark computation. Paste employee UUIDs to set the benchmark average.
                  </p>
                </div>
              )}
            </div>

            {/* Generate button */}
            <button
              onClick={generate}
              disabled={loading}
              className="px-6 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
            >
              {loading ? "Generating…" : "Generate Report"}
            </button>
          </div>

          {/* ── Error state ── */}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-300 mb-6 no-print">
              {error}
            </div>
          )}

          {/* ── Results ── */}
          {report && (
            <div ref={reportRef}>
              {/* Period header */}
              <div className="mb-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-100 print-title">
                      {report.period.label
                        ? `${report.period.label} — `
                        : ""}
                      {report.period.from} – {report.period.to}
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5 capitalize">
                      {report.period.reportType} report · {report.employees.length} employee(s)
                      {report.benchmark != null && (
                        <> · Benchmark: {d(report.benchmark)}/shift</>
                      )}
                      {goalBenchmarkCents != null && (
                        <span className="text-amber-400/80"> · Goal: {d(goalBenchmarkCents)}/shift</span>
                      )}
                      {report.snapshotSaved && (
                        <span className="ml-2 text-emerald-400">· Snapshot saved ✓</span>
                      )}
                    </p>
                  </div>

                  {/* Export bar — four actions in two groups */}
                  <div className="flex items-center gap-1 flex-wrap no-print">
                    {/* Copy group */}
                    <button
                      onClick={() => copyReport("primary")}
                      disabled={copyStatus?.status === "copying"}
                      className="px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-700/60 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {copyStatus?.detail === "primary" && copyStatus.status === "copying"
                        ? "Copying…"
                        : copyStatus?.detail === "primary" && copyStatus.status === "success"
                          ? "✓ Copied!"
                          : "Copy Primary"}
                    </button>
                    <button
                      onClick={() => copyReport("full")}
                      disabled={copyStatus?.status === "copying"}
                      className="px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-700/60 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {copyStatus?.detail === "full" && copyStatus.status === "copying"
                        ? "Copying…"
                        : copyStatus?.detail === "full" && copyStatus.status === "success"
                          ? "✓ Copied!"
                          : "Copy Full"}
                    </button>

                    <span className="text-zinc-600 px-0.5 select-none">|</span>

                    {/* Print group */}
                    <button
                      onClick={printPrimary}
                      className="px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-700/60 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors whitespace-nowrap"
                    >
                      Print Primary
                    </button>
                    <button
                      onClick={printFull}
                      className="px-3 py-2 rounded-lg border border-zinc-600 bg-zinc-700/60 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors whitespace-nowrap"
                    >
                      Print Full
                    </button>
                  </div>
                </div>

                {/* Store normalization factors (if multiple stores) */}
                {Object.keys(report.storeFactors).length > 1 && (
                  <div className="text-xs text-zinc-500 no-print">
                    Normalization factors:{" "}
                    {Object.entries(report.storeFactors)
                      .map(([sid, f]) => {
                        const store = stores.find((s) => s.id === sid);
                        return `${store?.name ?? sid}: ×${f.toFixed(3)}`;
                      })
                      .join(" · ")}
                  </div>
                )}
              </div>

              {/* Employee cards */}
              <div className="space-y-4">
                {report.employees.map((emp) => (
                  <EmployeeCard
                    key={emp.employeeId}
                    summary={emp}
                    delta={deltaMap.get(emp.employeeId)}
                    benchmark={report.benchmark}
                    goalBenchmarkCents={goalBenchmarkCents}
                    showTransactions={anyHasTransactions}
                    expandAll={expandAll}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Empty state ── */}
          {!report && !loading && !error && (
            <div className="text-center text-zinc-500 py-16 no-print">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-sm">Set your filters above and click <strong className="text-zinc-300">Generate Report</strong> to begin.</p>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
