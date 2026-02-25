"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { ShiftSalesResponse } from "@/types/adminShiftSales";
import type { ShiftSalesRow } from "@/types/adminShiftSales";

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

function cstDateTime(value: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "--";
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function hoursBetween(startIso: string, endIso: string | null): number | null {
  if (!endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / 3_600_000;
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export default function AdminShiftSalesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ShiftSalesResponse | null>(null);
  const [from, setFrom] = useState(() => cstDateKey(addDays(new Date(), -13)));
  const [to, setTo] = useState(() => cstDateKey(new Date()));
  const [storeId, setStoreId] = useState("all");

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
          router.replace("/login?next=/admin/shift-sales");
          return;
        }
        const qs = new URLSearchParams({ from, to, storeId });
        const res = await fetch(`/api/admin/shift-sales?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load shift sales.");
        if (!alive) return;
        setData(json as ShiftSalesResponse);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load shift sales.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [from, to, storeId, router]);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.reduce(
      (acc, row) => ({
        shifts: acc.shifts + 1,
        withSales: acc.withSales + (row.salesCents != null ? 1 : 0),
        salesCents: acc.salesCents + (row.salesCents ?? 0),
      }),
      { shifts: 0, withSales: 0, salesCents: 0 }
    );
  }, [data]);

  const leaderboard = useMemo(() => {
    const byEmployee = new Map<
      string,
      { employeeName: string; shifts: number; withSales: number; totalSalesCents: number }
    >();
    for (const row of data?.rows ?? []) {
      const key = row.profileId;
      const existing = byEmployee.get(key) ?? {
        employeeName: row.employeeName ?? "Unknown",
        shifts: 0,
        withSales: 0,
        totalSalesCents: 0,
      };
      existing.shifts += 1;
      if (row.salesCents != null) {
        existing.withSales += 1;
        existing.totalSalesCents += row.salesCents;
      }
      byEmployee.set(key, existing);
    }
    return Array.from(byEmployee.entries())
      .map(([profileId, value]) => ({
        profileId,
        ...value,
        avgSalesPerShiftCents:
          value.withSales > 0 ? Math.round(value.totalSalesCents / value.withSales) : null,
      }))
      .sort((a, b) => (b.avgSalesPerShiftCents ?? -1) - (a.avgSalesPerShiftCents ?? -1));
  }, [data]);

  const adjustedLeaderboard = useMemo(() => {
    const rows = (data?.rows ?? []).filter(
      (row): row is ShiftSalesRow & { salesCents: number } => row.salesCents != null
    );
    if (rows.length === 0) return [];

    const salesByStore = new Map<string, number>();
    for (const row of rows) {
      salesByStore.set(row.storeId, (salesByStore.get(row.storeId) ?? 0) + row.salesCents);
    }
    const storeTotals = Array.from(salesByStore.values()).filter((value) => value > 0);
    if (storeTotals.length === 0) return [];
    const networkAvgStoreTotal =
      storeTotals.reduce((sum, value) => sum + value, 0) / storeTotals.length;

    const factorByStore = new Map<string, number>();
    for (const [sid, total] of salesByStore.entries()) {
      factorByStore.set(sid, total > 0 ? networkAvgStoreTotal / total : 1);
    }

    const byEmployee = new Map<
      string,
      {
        employeeName: string;
        shiftsWithSales: number;
        rawSalesCents: number;
        adjustedSalesCents: number;
        weightedFactorTotal: number;
      }
    >();

    for (const row of rows) {
      const factor = factorByStore.get(row.storeId) ?? 1;
      const existing = byEmployee.get(row.profileId) ?? {
        employeeName: row.employeeName ?? "Unknown",
        shiftsWithSales: 0,
        rawSalesCents: 0,
        adjustedSalesCents: 0,
        weightedFactorTotal: 0,
      };
      existing.shiftsWithSales += 1;
      existing.rawSalesCents += row.salesCents;
      existing.adjustedSalesCents += Math.round(row.salesCents * factor);
      existing.weightedFactorTotal += factor;
      byEmployee.set(row.profileId, existing);
    }

    return Array.from(byEmployee.entries())
      .map(([profileId, value]) => ({
        profileId,
        employeeName: value.employeeName,
        shiftsWithSales: value.shiftsWithSales,
        rawSalesCents: value.rawSalesCents,
        adjustedSalesCents: value.adjustedSalesCents,
        rawAvgPerShiftCents:
          value.shiftsWithSales > 0 ? Math.round(value.rawSalesCents / value.shiftsWithSales) : null,
        adjustedAvgPerShiftCents:
          value.shiftsWithSales > 0
            ? Math.round(value.adjustedSalesCents / value.shiftsWithSales)
            : null,
        avgStoreFactor:
          value.shiftsWithSales > 0 ? value.weightedFactorTotal / value.shiftsWithSales : 1,
      }))
      .sort(
        (a, b) =>
          (b.adjustedAvgPerShiftCents ?? -1) - (a.adjustedAvgPerShiftCents ?? -1)
      );
  }, [data]);

  const employeeExport = useMemo(() => {
    const rows = (data?.rows ?? []).filter(
      (row): row is ShiftSalesRow & { salesCents: number } => row.salesCents != null
    );
    if (rows.length === 0) return [];

    const salesByStore = new Map<string, number>();
    for (const row of rows) {
      salesByStore.set(row.storeId, (salesByStore.get(row.storeId) ?? 0) + row.salesCents);
    }
    const storeTotals = Array.from(salesByStore.values()).filter((value) => value > 0);
    const networkAvgStoreTotal =
      storeTotals.length > 0
        ? storeTotals.reduce((sum, value) => sum + value, 0) / storeTotals.length
        : 0;
    const factorByStore = new Map<string, number>();
    for (const [sid, total] of salesByStore.entries()) {
      factorByStore.set(sid, total > 0 && networkAvgStoreTotal > 0 ? networkAvgStoreTotal / total : 1);
    }

    const normalized = rows.map((row) => {
      const factor = factorByStore.get(row.storeId) ?? 1;
      const adjustedSalesCents = Math.round(row.salesCents * factor);
      const shiftHours = hoursBetween(row.startedAt, row.endedAt);
      return {
        ...row,
        adjustedSalesCents,
        shiftHours,
        rawSalesPerHourCents:
          shiftHours && shiftHours > 0 ? Math.round(row.salesCents / shiftHours) : null,
        adjustedSalesPerHourCents:
          shiftHours && shiftHours > 0 ? Math.round(adjustedSalesCents / shiftHours) : null,
      };
    });

    const byEmployee = new Map<
      string,
      {
        profileId: string;
        employeeName: string;
        rows: typeof normalized;
        rawTotalCents: number;
        adjustedTotalCents: number;
      }
    >();

    for (const row of normalized) {
      const key = row.profileId;
      const existing = byEmployee.get(key) ?? {
        profileId: key,
        employeeName: row.employeeName ?? "Unknown",
        rows: [],
        rawTotalCents: 0,
        adjustedTotalCents: 0,
      };
      existing.rows.push(row);
      existing.rawTotalCents += row.salesCents;
      existing.adjustedTotalCents += row.adjustedSalesCents;
      byEmployee.set(key, existing);
    }

    return Array.from(byEmployee.values())
      .map((employee) => {
        const shiftCount = employee.rows.length;
        const rawAvgCents = shiftCount > 0 ? Math.round(employee.rawTotalCents / shiftCount) : 0;
        const adjustedAvgCents =
          shiftCount > 0 ? Math.round(employee.adjustedTotalCents / shiftCount) : 0;
        const totalHours = employee.rows.reduce((sum, row) => sum + (row.shiftHours ?? 0), 0);

        const rowsWithFlags = employee.rows
          .map((row) => {
            const varianceRatio = rawAvgCents > 0 ? (row.salesCents - rawAvgCents) / rawAvgCents : 0;
            const varianceFlag = varianceRatio >= 0.2 ? "HIGH" : varianceRatio <= -0.2 ? "LOW" : "NORMAL";
            return { ...row, varianceFlag };
          })
          .sort((a, b) =>
            `${a.businessDate}-${a.startedAt}`.localeCompare(`${b.businessDate}-${b.startedAt}`)
          );

        return {
          ...employee,
          rows: rowsWithFlags,
          shiftCount,
          rawAvgCents,
          adjustedAvgCents,
          totalHours,
          rawSalesPerHourCents:
            totalHours > 0 ? Math.round(employee.rawTotalCents / totalHours) : null,
          adjustedSalesPerHourCents:
            totalHours > 0 ? Math.round(employee.adjustedTotalCents / totalHours) : null,
        };
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [data]);

  function downloadEmployeeCsv() {
    if (employeeExport.length === 0) return;
    const lines: string[] = [];
    lines.push([
      csvCell("Employee Shift Sales Report"),
      csvCell(`From ${from} To ${to}`),
      csvCell(storeId === "all" ? "All Stores" : storeId),
    ].join(","));
    lines.push("");

    for (const employee of employeeExport) {
      lines.push([csvCell("Employee"), csvCell(employee.employeeName)].join(","));
      lines.push(
        [
          "Date",
          "Store",
          "Shift Type",
          "Started CST",
          "Ended CST",
          "Shift Hours",
          "Raw Sales",
          "Adjusted Sales",
          "Variance vs Employee Avg",
          "Raw Sales / Hour",
          "Adjusted Sales / Hour",
        ]
          .map((v) => csvCell(v))
          .join(",")
      );
      for (const row of employee.rows) {
        lines.push(
          [
            row.businessDate,
            row.storeName ?? "--",
            row.shiftType,
            cstDateTime(row.startedAt),
            row.endedAt ? cstDateTime(row.endedAt) : "--",
            row.shiftHours == null ? "--" : row.shiftHours.toFixed(2),
            money(row.salesCents),
            money(row.adjustedSalesCents),
            row.varianceFlag,
            money(row.rawSalesPerHourCents),
            money(row.adjustedSalesPerHourCents),
          ]
            .map((v) => csvCell(v))
            .join(",")
        );
      }
      lines.push(
        [
          "TOTAL",
          "",
          "",
          "",
          "",
          employee.totalHours > 0 ? employee.totalHours.toFixed(2) : "--",
          money(employee.rawTotalCents),
          money(employee.adjustedTotalCents),
          "",
          money(employee.rawSalesPerHourCents),
          money(employee.adjustedSalesPerHourCents),
        ]
          .map((v) => csvCell(v))
          .join(",")
      );
      lines.push(
        [
          "AVERAGE / SHIFT",
          "",
          "",
          "",
          "",
          "",
          money(employee.rawAvgCents),
          money(employee.adjustedAvgCents),
          "",
          "",
          "",
        ]
          .map((v) => csvCell(v))
          .join(",")
      );
      lines.push("");
    }

    const csv = lines.join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `employee-shift-sales-${from}-to-${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Shift Sales Report</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 disabled:opacity-50"
              onClick={downloadEmployeeCsv}
              disabled={employeeExport.length === 0}
            >
              Export Employee CSV
            </button>
            <Link href="/admin" className="btn-secondary px-3 py-1.5">
              Back to Admin
            </Link>
          </div>
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
            <div>Total Shifts: <b>{totals.shifts}</b></div>
            <div>With Sales Data: <b>{totals.withSales}</b></div>
            <div>Total Sales: <b>{money(totals.salesCents)}</b></div>
          </div>
        </div>

        {loading && <div className="card card-pad">Loading shift sales...</div>}
        {error && <div className="banner banner-error">{error}</div>}

        {!loading && !error && (
          <div className="space-y-4">
            <div className="card card-pad overflow-auto">
              <div className="mb-3 text-base font-semibold">Shift Sales Leaderboard (Avg / Shift)</div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-white/10">
                    <th className="py-2 pr-3">Rank</th>
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3">Shifts (Data)</th>
                    <th className="py-2 pr-3">Total Sales</th>
                    <th className="py-2 pr-3">Avg / Shift</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, idx) => (
                    <tr key={row.profileId} className="border-b border-white/5">
                      <td className="py-2 pr-3">#{idx + 1}</td>
                      <td className="py-2 pr-3">{row.employeeName}</td>
                      <td className="py-2 pr-3">
                        {row.withSales}/{row.shifts}
                      </td>
                      <td className="py-2 pr-3">{money(row.totalSalesCents)}</td>
                      <td className="py-2 pr-3 font-semibold">{money(row.avgSalesPerShiftCents)}</td>
                    </tr>
                  ))}
                  {leaderboard.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        No leaderboard data in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card card-pad overflow-auto">
              <div className="mb-1 text-base font-semibold">
                Volume-Adjusted Leaderboard (Fair Across Stores)
              </div>
              <div className="mb-3 text-xs text-slate-400">
                Adjusted using store sales-volume factor for selected range.
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-white/10">
                    <th className="py-2 pr-3">Rank</th>
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3">Shifts (with sales)</th>
                    <th className="py-2 pr-3">Raw Avg / Shift</th>
                    <th className="py-2 pr-3">Adj Avg / Shift</th>
                    <th className="py-2 pr-3">Avg Factor</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustedLeaderboard.map((row, idx) => (
                    <tr key={row.profileId} className="border-b border-white/5">
                      <td className="py-2 pr-3">#{idx + 1}</td>
                      <td className="py-2 pr-3">{row.employeeName}</td>
                      <td className="py-2 pr-3">{row.shiftsWithSales}</td>
                      <td className="py-2 pr-3">{money(row.rawAvgPerShiftCents)}</td>
                      <td className="py-2 pr-3 font-semibold">{money(row.adjustedAvgPerShiftCents)}</td>
                      <td className="py-2 pr-3">{row.avgStoreFactor.toFixed(2)}x</td>
                    </tr>
                  ))}
                  {adjustedLeaderboard.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        No adjusted leaderboard data in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card card-pad overflow-auto">
              <div className="mb-3 text-base font-semibold">All Shift Sales Rows</div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-white/10">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Store</th>
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Started</th>
                    <th className="py-2 pr-3">Shift Sales</th>
                    <th className="py-2 pr-3">Formula</th>
                    <th className="py-2 pr-3">Inputs</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.shiftId} className="border-b border-white/5 align-top">
                      <td className="py-2 pr-3">{row.businessDate}</td>
                      <td className="py-2 pr-3">{row.storeName ?? "--"}</td>
                      <td className="py-2 pr-3">{row.employeeName ?? "--"}</td>
                      <td className="py-2 pr-3">{row.shiftType}</td>
                      <td className="py-2 pr-3">{cstDateTime(row.startedAt)}</td>
                      <td className="py-2 pr-3 font-semibold">{money(row.salesCents)}</td>
                      <td className="py-2 pr-3">{row.formula}</td>
                      <td className="py-2 pr-3 text-xs text-slate-400">
                        <div>Begin X: {money(row.beginningXReportCents)}</div>
                        <div>End X: {money(row.openXReportCents)}</div>
                        <div>Z: {money(row.zReportCents)}</div>
                        <div>Midnight X: {money(row.midnightXReportCents)}</div>
                      </td>
                    </tr>
                  ))}
                  {(data?.rows ?? []).length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400">
                        No shifts in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
