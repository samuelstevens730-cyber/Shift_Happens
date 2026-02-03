/**
 * Payroll Admin Page - Generate payroll reports with hours calculation and CSV export
 *
 * This administrative page provides payroll reporting functionality, allowing managers
 * to generate reports of employee worked hours for a specified date range. It supports
 * filtering and exports data in CSV format for import into payroll systems.
 *
 * Features:
 * - Select date range (defaults to current week starting Monday)
 * - Filter by specific employee or store
 * - View shift details including start/end times, raw minutes, and rounded hours
 * - Display running totals for minutes and rounded hours
 * - Export filtered results to CSV file for payroll system import
 * - Paginated results with 25 shifts per page
 *
 * Business Logic:
 * - Hours are calculated as raw minutes and rounded hours for payroll purposes
 * - Rounding rules are applied server-side for consistency
 * - Only completed shifts (with both start and end times) are included
 * - CSV export includes shift ID, user ID, name, store, timestamps, and hour calculations
 * - Date range uses start of day for "from" and end of day for "to" to capture full days
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Profile { id: string; name: string | null; }
interface Store   { id: string; name: string; }

interface ShiftRow {
  id: string;
  user_id: string;
  full_name: string | null;
  store_id: string;
  store_name: string | null;
  start_at: string;
  end_at: string;
  minutes: number;
  rounded_hours: number;
}

type PayrollResponse =
  | { rows: ShiftRow[]; page: number; pageSize: number; total: number }
  | { error: string };

function formatWhen(value: string | null) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }

export default function PayrollAdminPage() {
  // default range = this week
  const today  = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const [from, setFrom]               = useState(toISODate(monday));
  const [to, setTo]                   = useState(toISODate(today));
  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [stores, setStores]           = useState<Store[]>([]);
  const [selectedUser, setSelectedUser]   = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [rows, setRows]               = useState<ShiftRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState<string | null>(null);
  const [page, setPage]               = useState(1);
  const [total, setTotal]             = useState(0);
  const pageSize = 25;

  // dropdowns
  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, name")
        .order("name", { ascending: true });
      setProfiles(profs ?? []);

      const { data: sts } = await supabase
        .from("stores")
        .select("id, name")
        .order("name", { ascending: true });
      setStores(sts ?? []);
    })();
  }, []);

  const runReport = useCallback(async (nextPage = page) => {
    try {
      setErr(null);
      setLoading(true);

      const fromISO = startOfDay(new Date(from)).toISOString();
      const toISO   = endOfDay(new Date(to)).toISOString();

      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(pageSize),
        from: fromISO,
        to: toISO,
      });
      if (selectedUser !== "all") params.set("profileId", selectedUser);
      if (selectedStore !== "all") params.set("storeId", selectedStore);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) throw new Error("Unauthorized");

      const res = await fetch(`/api/admin/payroll?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as PayrollResponse;
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : "Failed to run report");
      }

      setRows(json.rows);
      setPage(json.page);
      setTotal(json.total);
    } catch (e: unknown) {
      console.error("Payroll run error:", e);
      setErr(e instanceof Error ? e.message : "Failed to run report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, selectedUser, selectedStore, page]);

  useEffect(() => { void runReport(1); }, [from, to, selectedUser, selectedStore]);

  const totalMinutes = useMemo(() => rows.reduce((a, r) => a + r.minutes, 0), [rows]);
  const totalRounded = useMemo(() => rows.reduce((a, r) => a + r.rounded_hours, 0), [rows]);

  function exportCsv() {
    const header = ["shift_id","user_id","full_name","store_id","start_at","end_at","minutes","rounded_hours"];
    const lines = [header.join(",")].concat(
      rows.map(r => [
        r.id,
        r.user_id,
        `"${(r.full_name || "Unknown").replace(/"/g,'""')}"`,
        r.store_id,
        r.start_at,
        r.end_at,
        r.minutes,
        r.rounded_hours,
      ].join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `payroll_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Payroll Admin</h1>

        <div className="card card-pad grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-sm muted">From</label>
            <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">To</label>
            <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">User</label>
            <select className="select" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
              <option value="all">All</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name || p.id.slice(0,8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm muted">Store</label>
            <select className="select" value={selectedStore} onChange={e => setSelectedStore(e.target.value)}>
              <option value="all">All</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
          </div>
          <button onClick={() => runReport(1)} className="h-12 btn-primary px-4 disabled:opacity-50" disabled={loading}>
            {loading ? "Running..." : "Run"}
          </button>
          <button onClick={exportCsv} className="h-12 btn-secondary px-4 disabled:opacity-50" disabled={!rows.length}>
            Export CSV
          </button>
        </div>

        {err && <div className="banner banner-error text-sm">{err}</div>}

        <div className="card">
          <div className="px-3 py-2 font-medium border-b border-white/10">Shifts</div>
          <table className="w-full text-sm">
            <thead className="bg-black/40">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-left px-3 py-2">Store</th>
                <th className="text-left px-3 py-2">Start</th>
                <th className="text-left px-3 py-2">End</th>
                <th className="text-right px-3 py-2">Minutes</th>
                <th className="text-right px-3 py-2">Rounded Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="px-3 py-2">{r.full_name || "Unknown"}</td>
                  <td className="px-3 py-2">{r.store_name || r.store_id}</td>
                  <td className="px-3 py-2">{formatWhen(r.start_at)}</td>
                  <td className="px-3 py-2">{formatWhen(r.end_at)}</td>
                  <td className="px-3 py-2 text-right">{r.minutes}</td>
                  <td className="px-3 py-2 text-right">{r.rounded_hours}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="px-3 py-6 text-center muted" colSpan={6}>No shifts in range.</td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-black/40">
                <tr className="font-medium">
                  <td className="px-3 py-2 text-right" colSpan={4}>Totals:</td>
                  <td className="px-3 py-2 text-right">{totalMinutes}</td>
                  <td className="px-3 py-2 text-right">{totalRounded}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {total > pageSize && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={p => runReport(p)}
          />
        )}
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  for (let i = 1; i <= totalPages; i += 1) pages.push(i);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Prev
      </button>
      {pages.map(p => (
        <button
          key={p}
          className={p === page ? "btn-primary px-3 py-1.5" : "btn-secondary px-3 py-1.5"}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      <button className="btn-secondary px-3 py-1.5" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
