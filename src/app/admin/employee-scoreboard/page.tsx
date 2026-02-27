"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { EmployeeScoreRow, EmployeeScoreboardResponse } from "@/types/employeeScore";

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

function money(cents: number | null): string {
  if (cents == null) return "--";
  return `$${(cents / 100).toFixed(2)}`;
}

function gradeTone(grade: EmployeeScoreRow["grade"]): string {
  if (grade === "A") return "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40";
  if (grade === "B") return "bg-sky-500/20 text-sky-200 border border-sky-500/40";
  if (grade === "C") return "bg-amber-500/20 text-amber-200 border border-amber-500/40";
  return "bg-red-500/20 text-red-200 border border-red-500/40";
}

function toCategoryPoints(row: EmployeeScoreRow, key: "sales" | "reliability" | "accuracy" | "cash" | "tasks") {
  const byKey = new Map(row.categories.map((category) => [category.key, category]));
  const value = (k: EmployeeScoreRow["categories"][number]["key"]) => byKey.get(k)?.points ?? 0;
  if (key === "sales") return value("sales_raw") + value("sales_adjusted");
  if (key === "reliability") return value("attendance") + value("punctuality");
  if (key === "accuracy") return value("accuracy");
  if (key === "cash") return value("cash_handling");
  return value("task_master");
}

export default function AdminEmployeeScoreboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EmployeeScoreboardResponse | null>(null);
  const [storeId, setStoreId] = useState("all");
  const [from, setFrom] = useState(() => cstDateKey(addDays(new Date(), -29)));
  const [to, setTo] = useState(() => cstDateKey(new Date()));

  useEffect(() => {
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
          router.replace("/login?next=/admin/employee-scoreboard");
          return;
        }
        const qs = new URLSearchParams({ from, to, storeId });
        const res = await fetch(`/api/admin/employee-scoreboard?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load employee scoreboard.");
        if (!alive) return;
        setData(json as EmployeeScoreboardResponse);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load employee scoreboard.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [from, to, storeId, router]);

  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.reduce(
      (acc, row) => ({
        total: acc.total + 1,
        ranked: acc.ranked + (row.ranked ? 1 : 0),
        avgScore: acc.avgScore + row.score,
      }),
      { total: 0, ranked: 0, avgScore: 0 }
    );
  }, [data]);

  const avgScoreDisplay =
    summary.total > 0 ? (summary.avgScore / summary.total).toFixed(1) : "--";

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Employee Scoreboard (Beta)</h1>
          <div className="flex items-center gap-2">
            <Link href="/admin/dashboard" className="btn-secondary px-3 py-1.5">
              Command Center
            </Link>
            <Link href="/admin" className="btn-secondary px-3 py-1.5">
              Back to Admin
            </Link>
          </div>
        </div>

        <div className="banner">
          Beta scoring is live for visibility and feedback. It is not the sole Employee of the
          Month decision factor yet.
        </div>

        <div className="card card-pad grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            From
            <input
              type="date"
              className="input mt-1"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            To
            <input
              type="date"
              className="input mt-1"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Store
            <select
              className="select mt-1"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="all">All Stores</option>
              {(data?.stores ?? []).map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm self-end">
            <div>
              Employees: <b>{summary.total}</b>
            </div>
            <div>
              Ranked (min {data?.minShiftsForRanking ?? 8} shifts): <b>{summary.ranked}</b>
            </div>
            <div>
              Avg score: <b>{avgScoreDisplay}</b>
            </div>
          </div>
        </div>

        {loading && <div className="card card-pad">Loading employee scores...</div>}
        {error && <div className="banner banner-error">{error}</div>}

        {!loading && !error && (
          <div className="card card-pad overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b border-white/10">
                  <th className="py-2 pr-3">Rank</th>
                  <th className="py-2 pr-3">Employee</th>
                  <th className="py-2 pr-3">Grade</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Shifts</th>
                  <th className="py-2 pr-3">Raw Avg</th>
                  <th className="py-2 pr-3">Adj Avg</th>
                  <th className="py-2 pr-3">Sales /30</th>
                  <th className="py-2 pr-3">Reliability /30</th>
                  <th className="py-2 pr-3">Accuracy /20</th>
                  <th className="py-2 pr-3">Cash /10</th>
                  <th className="py-2 pr-3">Tasks /10</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((row, index) => (
                  <tr key={row.profileId} className="border-b border-white/5 align-top">
                    <td className="py-2 pr-3">{index + 1}</td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/dashboard/scoreboard/shifts?source=admin&profileId=${row.profileId}&from=${from}&to=${to}&storeId=${storeId}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {row.employeeName ?? "Unknown"}
                      </Link>
                      {!row.ranked && (
                        <div className="text-xs text-amber-300">
                          Provisional (needs {data?.minShiftsForRanking ?? 8}+ shifts)
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${gradeTone(row.grade)}`}>
                        {row.grade}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-semibold">{row.score.toFixed(1)}</td>
                    <td className="py-2 pr-3">{row.shiftsWorked}</td>
                    <td className="py-2 pr-3">{money(row.rawAvgSalesPerShiftCents)}</td>
                    <td className="py-2 pr-3">{money(row.adjustedAvgSalesPerShiftCents)}</td>
                    <td className="py-2 pr-3">{toCategoryPoints(row, "sales").toFixed(1)}</td>
                    <td className="py-2 pr-3">{toCategoryPoints(row, "reliability").toFixed(1)}</td>
                    <td className="py-2 pr-3">{toCategoryPoints(row, "accuracy").toFixed(1)}</td>
                    <td className="py-2 pr-3">{toCategoryPoints(row, "cash").toFixed(1)}</td>
                    <td className="py-2 pr-3">{toCategoryPoints(row, "tasks").toFixed(1)}</td>
                  </tr>
                ))}
                {(data?.rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-6 text-center muted">
                      No score rows found for selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
