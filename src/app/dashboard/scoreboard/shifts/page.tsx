"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { ShiftBreakdownResponse, ShiftScoreRow } from "@/types/shiftScoreRow";

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

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function scoreTone(score: number | null): string {
  if (score == null) return "text-zinc-500";
  if (score >= 85) return "text-emerald-400";
  if (score >= 70) return "text-sky-400";
  if (score >= 55) return "text-amber-400";
  return "text-red-400";
}

function metricTone(pts: number | null, max: number): string {
  if (pts == null) return "text-zinc-500";
  const ratio = pts / max;
  if (ratio >= 0.85) return "text-emerald-400";
  if (ratio >= 0.70) return "text-sky-400";
  if (ratio >= 0.55) return "text-amber-400";
  return "text-red-400";
}

function shiftTypeLabel(type: ShiftScoreRow["shiftType"]): string {
  if (!type) return "—";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

type SortKey = "date" | "score" | "punctuality" | "accuracy" | "cash" | "tasks";
type SortDir = "asc" | "desc";

function sortRows(rows: ShiftScoreRow[], key: SortKey, dir: SortDir): ShiftScoreRow[] {
  return [...rows].sort((a, b) => {
    let va: number | null;
    let vb: number | null;
    switch (key) {
      case "date":
        return dir === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      case "score":
        va = a.compositeScore; vb = b.compositeScore; break;
      case "punctuality":
        va = a.punctualityPoints; vb = b.punctualityPoints; break;
      case "accuracy":
        va = a.accuracyPoints; vb = b.accuracyPoints; break;
      case "cash":
        va = a.cashHandlingPoints; vb = b.cashHandlingPoints; break;
      case "tasks":
        va = a.taskPoints; vb = b.taskPoints; break;
      default:
        return 0;
    }
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return dir === "asc" ? va - vb : vb - va;
  });
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className={`py-2 pr-3 text-left cursor-pointer select-none whitespace-nowrap hover:text-zinc-200 ${active ? "text-white" : "text-zinc-400"} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="ml-1 text-xs">{currentDir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

function AdminShiftBreakdownPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const profileId = searchParams.get("profileId") ?? "";
  const source = searchParams.get("source") === "admin" ? "admin" : "employee";
  const defaultFrom = cstDateKey(addDays(new Date(), -29));
  const defaultTo = cstDateKey(new Date());

  const [from, setFrom] = useState(searchParams.get("from") ?? defaultFrom);
  const [to, setTo] = useState(searchParams.get("to") ?? defaultTo);
  const [storeId] = useState(searchParams.get("storeId") ?? "all");
  const [showFilters, setShowFilters] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ShiftBreakdownResponse | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "date" ? "desc" : "asc");
      return key;
    });
  }, []);

  useEffect(() => {
    if (!profileId) {
      setLoading(false);
      setError("No employee selected. Provide a profileId in the URL.");
      return;
    }

    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        if (!token) {
          router.replace(
            source === "admin"
              ? `/login?next=${encodeURIComponent(`/dashboard/scoreboard/shifts?source=admin&profileId=${profileId}&from=${from}&to=${to}&storeId=${storeId}`)}`
              : "/login?next=/dashboard/scoreboard/shifts"
          );
          return;
        }
        const qs = new URLSearchParams({ profileId, from, to, storeId });
        const res = await fetch(`/api/admin/employee-scoreboard/shift-breakdown?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load shift breakdown.");
        if (!alive) return;
        setData(json as ShiftBreakdownResponse);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load shift breakdown.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [profileId, from, to, storeId, source, router]);

  const sortedRows = data ? sortRows(data.rows, sortKey, sortDir) : [];
  const workedCount = data?.rows.filter((r) => r.attended).length ?? 0;
  const absentCount = data?.rows.filter((r) => !r.attended).length ?? 0;
  const scoredRows = data?.rows.filter((r) => r.compositeScore != null) ?? [];
  const avgScore =
    scoredRows.length > 0
      ? scoredRows.reduce((sum, r) => sum + (r.compositeScore ?? 0), 0) / scoredRows.length
      : null;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">
            Shift Breakdown
            {data?.employeeName && (
              <span className="ml-2 text-lg font-normal text-zinc-400">— {data.employeeName}</span>
            )}
          </h1>
          <Link
            href={
              source === "admin"
                ? `/admin/employee-scoreboard?from=${from}&to=${to}&storeId=${storeId}`
                : `/scoreboard?from=${from}&to=${to}&storeId=${storeId}`
            }
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            {source === "admin" ? "Back to Admin Scoreboard" : "Back to Scoreboard"}
          </Link>
        </div>

        {/* Filters */}
        <div className="card card-pad">
          <div className="flex items-center justify-between gap-2">
            <button
              className="flex-1 text-left text-sm"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <span className="font-semibold">Filters:</span> {from} to {to}
            </button>
            <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setShowFilters((v) => !v)}>
              {showFilters ? "Collapse" : "Expand"}
            </button>
          </div>
          {showFilters && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                From
                <input className="input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-sm">
                To
                <input className="input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          )}
        </div>

        {loading && <div className="card card-pad text-sm">Loading shift breakdown...</div>}
        {error && <div className="banner banner-error">{error}</div>}

        {!loading && !error && data && (
          <>
            {/* Summary strip */}
            <div className="card card-pad">
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  Shifts Worked: <b>{workedCount}</b>
                </div>
                {absentCount > 0 && (
                  <div>
                    Absent: <b className="text-red-400">{absentCount}</b>
                  </div>
                )}
                {avgScore != null && (
                  <div>
                    Avg Shift Score:{" "}
                    <b className={scoreTone(avgScore)}>{avgScore.toFixed(1)}</b>
                  </div>
                )}
                <div className="muted text-xs self-center">
                  Sales columns are informational only
                </div>
              </div>
            </div>

            {/* Table */}
            {data.rows.length === 0 ? (
              <div className="card card-pad text-sm muted">No shifts found for this employee in this period.</div>
            ) : (
              <div className="card card-pad overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <SortHeader label="Date" sortKey="date" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <th className="py-2 pr-3 text-left text-zinc-400 whitespace-nowrap">Store</th>
                      <th className="py-2 pr-3 text-left text-zinc-400 whitespace-nowrap">Type</th>
                      <th className="py-2 pr-3 text-left text-zinc-400 whitespace-nowrap">Attended</th>
                      <SortHeader label="Punctuality" sortKey="punctuality" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Accuracy" sortKey="accuracy" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Cash" sortKey="cash" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <SortHeader label="Tasks" sortKey="tasks" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                      <th className="py-2 pr-3 text-left text-zinc-400 whitespace-nowrap">Sales Raw</th>
                      <th className="py-2 pr-3 text-left text-zinc-400 whitespace-nowrap">Sales Adj</th>
                      <SortHeader label="Score" sortKey="score" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, i) => (
                      <tr
                        key={row.shiftId ?? `absent-${row.scheduleShiftId ?? i}`}
                        className={`border-b border-white/5 ${!row.attended ? "bg-red-950/20" : "hover:bg-white/[0.02]"}`}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{row.date}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-zinc-300">{row.storeName}</td>
                        <td className="py-2 pr-3">
                          {row.shiftType ? (
                            <span className="rounded px-1.5 py-0.5 text-xs bg-white/10 text-zinc-300">
                              {shiftTypeLabel(row.shiftType)}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {row.attended ? (
                            <span className="text-emerald-400 text-xs">✓ Worked</span>
                          ) : (
                            <span className="rounded px-1.5 py-0.5 text-xs bg-red-900/50 text-red-300 font-medium">
                              Absent
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {row.punctualityPoints != null ? (
                            <span className={metricTone(row.punctualityPoints, 15)}>
                              {row.punctualityPoints.toFixed(1)}
                              <span className="text-zinc-500 text-xs ml-1">
                                {row.effectiveLateMinutes != null && row.effectiveLateMinutes > 0
                                  ? `(+${row.effectiveLateMinutes}m late)`
                                  : row.scheduledStartMin != null
                                  ? "(on time)"
                                  : ""}
                              </span>
                            </span>
                          ) : row.scheduledStartMin == null ? (
                            <span className="text-zinc-600 text-xs">unscheduled</span>
                          ) : (
                            <span className="text-zinc-600 text-xs">n/a</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {row.accuracyPoints != null ? (
                            <span className={metricTone(row.accuracyPoints, 20)}>
                              {row.accuracyPoints.toFixed(1)}
                              <span className="text-zinc-500 text-xs ml-1">
                                ({formatCents(row.drawerAbsDeltaCents)} Δ)
                              </span>
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">no data</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {row.cashHandlingPoints != null ? (
                            <span className={metricTone(row.cashHandlingPoints, 10)}>
                              {row.cashHandlingPoints.toFixed(1)}
                              <span className="text-zinc-500 text-xs ml-1">
                                ({formatCents(row.closeoutVarianceCents)})
                              </span>
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">no data</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {row.taskPoints != null ? (
                            <span className={metricTone(row.taskPoints, 10)}>
                              {row.taskPoints.toFixed(1)}
                              <span className="text-zinc-500 text-xs ml-1">
                                ({row.cleaningCompleted}/{row.cleaningTotal})
                              </span>
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">no data</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-zinc-400">
                          {formatCents(row.salesRawCents)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-zinc-400">
                          {formatCents(row.salesAdjustedCents)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {row.compositeScore != null ? (
                            <span className={`font-semibold tabular-nums ${scoreTone(row.compositeScore)}`}>
                              {row.compositeScore.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="card card-pad text-xs text-zinc-500 space-y-1">
              <div className="font-medium text-zinc-400">Notes</div>
              <div>
                <b>Score</b>: Composite of attendance, punctuality, drawer accuracy, cash handling, and tasks — normalized 0–100 over available metrics. Sales are excluded (percentile-based across all employees).
              </div>
              <div>
                <b>Punctuality</b>: 5-minute grace period applied. Quadratic decay — 10+ minutes late = 0 pts.
              </div>
              <div>
                <b>Accuracy</b>: $20 drawer delta = 0 pts. <b>Cash</b>: $10 closeout variance = 0 pts.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminShiftBreakdownPageWrapper() {
  return (
    <Suspense>
      <AdminShiftBreakdownPage />
    </Suspense>
  );
}
