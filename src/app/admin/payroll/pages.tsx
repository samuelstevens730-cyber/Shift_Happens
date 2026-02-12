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

interface PayrollReportEmployeeRow {
  user_id: string;
  full_name: string | null;
  worked_hours: number;
  projected_hours: number;
  advance_hours: number;
  submit_hours: number;
}

interface PayrollReportResponse {
  employees: PayrollReportEmployeeRow[];
  totals: {
    worked_hours: number;
    projected_hours: number;
    advances_hours: number;
    submitted_hours: number;
  };
  openTotals: {
    lv1_hours: number;
    lv2_hours: number;
    total_hours: number;
  };
  reconciliationDiff: number;
  whatsappText: string;
}

interface AdvanceRow {
  id: string;
  profile_id: string;
  store_id: string | null;
  advance_date: string;
  advance_hours: string;
  cash_amount_cents: number | null;
  note: string | null;
  status: "pending_verification" | "verified" | "voided";
  created_at: string;
  profile: { id: string; name: string | null } | null;
  store: { id: string; name: string } | null;
}

type PayrollResponse =
  | {
      rows: ShiftRow[];
      page: number;
      pageSize: number;
      total: number;
      summary?: {
        byEmployee: {
          user_id: string;
          full_name: string | null;
          lv1_hours: number;
          lv2_hours: number;
          total_hours: number;
        }[];
        totals: {
          lv1_hours: number;
          lv2_hours: number;
          total_hours: number;
        };
      };
    }
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

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function PayrollAdminPage() {
  const today  = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const [from, setFrom] = useState(toISODate(monday));
  const [to, setTo] = useState(toISODate(today));
  const [asOf, setAsOf] = useState(toISODate(today));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{
    byEmployee: {
      user_id: string;
      full_name: string | null;
      lv1_hours: number;
      lv2_hours: number;
      total_hours: number;
    }[];
    totals: {
      lv1_hours: number;
      lv2_hours: number;
      total_hours: number;
    };
  } | null>(null);
  const [payrollReport, setPayrollReport] = useState<PayrollReportResponse | null>(null);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [notes, setNotes] = useState("");
  const [advanceDraft, setAdvanceDraft] = useState({
    profileId: "",
    storeId: "all",
    advanceDate: toISODate(today),
    advanceHours: "",
    cashAmountDollars: "",
    note: "",
    status: "verified" as "pending_verification" | "verified" | "voided",
  });
  const pageSize = 25;

  useEffect(() => {
    (async () => {
      const { data: profs } = await supabase.from("profiles").select("id, name").order("name", { ascending: true });
      setProfiles(profs ?? []);
      const { data: sts } = await supabase.from("stores").select("id, name").order("name", { ascending: true });
      setStores(sts ?? []);
    })();
  }, []);

  const runReport = useCallback(async (nextPage = page) => {
    try {
      setErr(null);
      setLoading(true);

      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(pageSize),
        from,
        to,
      });
      if (selectedUser !== "all") params.set("profileId", selectedUser);
      if (selectedStore !== "all") params.set("storeId", selectedStore);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) throw new Error("Unauthorized");

      const [payrollRes, reportRes, advancesRes] = await Promise.all([
        fetch(`/api/admin/payroll?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/payroll/report?${params.toString()}&asOf=${encodeURIComponent(asOf)}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/payroll/advances?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const payrollJson = (await payrollRes.json()) as PayrollResponse;
      const reportJson = (await reportRes.json()) as PayrollReportResponse | { error: string };
      const advancesJson = (await advancesRes.json()) as { rows: AdvanceRow[] } | { error: string };

      if (!payrollRes.ok || "error" in payrollJson) {
        throw new Error("error" in payrollJson ? payrollJson.error : "Failed to run report");
      }
      if (!reportRes.ok || "error" in reportJson) {
        throw new Error("error" in reportJson ? reportJson.error : "Failed to build payroll report");
      }
      if (!advancesRes.ok || "error" in advancesJson) {
        throw new Error("error" in advancesJson ? advancesJson.error : "Failed to load advances");
      }

      setRows(payrollJson.rows);
      setPage(payrollJson.page);
      setTotal(payrollJson.total);
      setSummary(payrollJson.summary ?? null);
      setPayrollReport(reportJson);
      setAdvances(advancesJson.rows ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to run report");
      setRows([]);
      setSummary(null);
      setPayrollReport(null);
      setAdvances([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, asOf, selectedUser, selectedStore, page]);

  useEffect(() => { void runReport(1); }, [from, to, asOf, selectedUser, selectedStore]);

  async function saveAdvance() {
    setErr(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) return setErr("Unauthorized");
    if (!advanceDraft.profileId || !advanceDraft.advanceHours) {
      return setErr("Profile and advance hours are required.");
    }

    const res = await fetch("/api/admin/payroll/advances", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        profileId: advanceDraft.profileId,
        storeId: advanceDraft.storeId === "all" ? null : advanceDraft.storeId,
        advanceDate: `${advanceDraft.advanceDate}T12:00:00-06:00`,
        advanceHours: Number(advanceDraft.advanceHours),
        cashAmountDollars: advanceDraft.cashAmountDollars === "" ? null : Number(advanceDraft.cashAmountDollars),
        note: advanceDraft.note || null,
        status: advanceDraft.status,
      }),
    });
    const json = await res.json();
    if (!res.ok) return setErr(json?.error || "Failed to save advance.");
    setAdvanceDraft(d => ({ ...d, advanceHours: "", cashAmountDollars: "", note: "" }));
    await runReport(1);
  }

  async function updateAdvance(id: string, patch: Record<string, unknown>) {
    setErr(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) return setErr("Unauthorized");
    const res = await fetch(`/api/admin/payroll/advances/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) return setErr(json?.error || "Failed to update advance.");
    await runReport(1);
  }

  async function deleteAdvance(id: string) {
    setErr(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) return setErr("Unauthorized");
    const res = await fetch(`/api/admin/payroll/advances/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) return setErr(json?.error || "Failed to delete advance.");
    await runReport(1);
  }

  async function copyWhatsappSummary() {
    if (!payrollReport) return;
    const notesBlock = notes.trim() ? `\n\nNotes:\n${notes.trim()}` : "";
    await navigator.clipboard.writeText(`${payrollReport.whatsappText}${notesBlock}`);
  }

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
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Payroll Admin</h1>

        <div className="card card-pad grid grid-cols-1 md:grid-cols-7 gap-3 items-end">
          <div>
            <label className="text-sm muted">From</label>
            <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">To</label>
            <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">Worked Through</label>
            <input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">User</label>
            <select className="select" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
              <option value="all">All</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name || p.id.slice(0,8)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm muted">Store</label>
            <select className="select" value={selectedStore} onChange={e => setSelectedStore(e.target.value)}>
              <option value="all">All</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
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

        {payrollReport && (
          <div className="card space-y-4 p-4">
            <div className="font-medium">Payroll Formula Report</div>
            <table className="w-full text-sm">
              <thead className="bg-black/40">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-right px-3 py-2">Worked</th>
                  <th className="text-right px-3 py-2">Projected</th>
                  <th className="text-right px-3 py-2">Advances</th>
                  <th className="text-right px-3 py-2">Submit Hours</th>
                </tr>
              </thead>
              <tbody>
                {payrollReport.employees.map(row => (
                  <tr key={row.user_id} className="border-t border-white/10">
                    <td className="px-3 py-2">{row.full_name || "Unknown"}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.worked_hours)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.projected_hours)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.advance_hours)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.submit_hours)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-black/40">
                <tr className="font-semibold">
                  <td className="px-3 py-2">Totals</td>
                  <td className="px-3 py-2 text-right">{formatNumber(payrollReport.totals.worked_hours)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(payrollReport.totals.projected_hours)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(payrollReport.totals.advances_hours)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(payrollReport.totals.submitted_hours)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="card card-pad">LV1 Open Hours: <b>{formatNumber(payrollReport.openTotals.lv1_hours)}</b></div>
              <div className="card card-pad">LV2 Open Hours: <b>{formatNumber(payrollReport.openTotals.lv2_hours)}</b></div>
              <div className="card card-pad">Total Open Hours: <b>{formatNumber(payrollReport.openTotals.total_hours)}</b></div>
            </div>
            <div className={`text-sm ${Math.abs(payrollReport.reconciliationDiff) < 0.01 ? "text-green-400" : "text-amber-300"}`}>
              Reconciliation diff (submitted - open): {formatNumber(payrollReport.reconciliationDiff)}
            </div>

            <div className="space-y-2">
              <label className="text-sm muted">Notes (included in final summary)</label>
              <textarea className="input min-h-24" value={notes} onChange={e => setNotes(e.target.value)} />
              <button className="btn-secondary px-3 py-2" onClick={copyWhatsappSummary}>Copy WhatsApp Summary</button>
            </div>
          </div>
        )}

        <div className="card space-y-4 p-4">
          <div className="font-medium">Advances</div>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            <select className="select" value={advanceDraft.profileId} onChange={e => setAdvanceDraft(d => ({ ...d, profileId: e.target.value }))}>
              <option value="">Employee</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name || p.id.slice(0,8)}</option>)}
            </select>
            <select className="select" value={advanceDraft.storeId} onChange={e => setAdvanceDraft(d => ({ ...d, storeId: e.target.value }))}>
              <option value="all">Auto Store</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" className="input" value={advanceDraft.advanceDate} onChange={e => setAdvanceDraft(d => ({ ...d, advanceDate: e.target.value }))} />
            <input className="input" placeholder="Advance hours" value={advanceDraft.advanceHours} onChange={e => setAdvanceDraft(d => ({ ...d, advanceHours: e.target.value }))} />
            <input className="input" placeholder="Cash $ (optional)" value={advanceDraft.cashAmountDollars} onChange={e => setAdvanceDraft(d => ({ ...d, cashAmountDollars: e.target.value }))} />
            <select className="select" value={advanceDraft.status} onChange={e => setAdvanceDraft(d => ({ ...d, status: e.target.value as "pending_verification" | "verified" | "voided" }))}>
              <option value="verified">Verified</option>
              <option value="pending_verification">Pending</option>
              <option value="voided">Voided</option>
            </select>
            <button className="btn-primary px-3 py-2" onClick={saveAdvance}>Add Advance</button>
          </div>
          <input className="input" placeholder="Note (optional)" value={advanceDraft.note} onChange={e => setAdvanceDraft(d => ({ ...d, note: e.target.value }))} />

          <table className="w-full text-sm">
            <thead className="bg-black/40">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Hours</th>
                <th className="text-right px-3 py-2">Cash</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {advances.map(row => (
                <tr key={row.id} className="border-t border-white/10">
                  <td className="px-3 py-2">{row.profile?.name || "Unknown"}</td>
                  <td className="px-3 py-2">{formatWhen(row.advance_date)}</td>
                  <td className="px-3 py-2 text-right">{row.advance_hours}</td>
                  <td className="px-3 py-2 text-right">{row.cash_amount_cents == null ? "--" : `$${(row.cash_amount_cents / 100).toFixed(2)}`}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2 flex gap-2">
                    {row.status !== "verified" && (
                      <button className="btn-secondary px-2 py-1" onClick={() => updateAdvance(row.id, { status: "verified" })}>Verify</button>
                    )}
                    {row.status !== "voided" && (
                      <button className="btn-secondary px-2 py-1" onClick={() => updateAdvance(row.id, { status: "voided" })}>Void</button>
                    )}
                    <button className="btn-secondary px-2 py-1" onClick={() => deleteAdvance(row.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!advances.length && (
                <tr>
                  <td className="px-3 py-4 muted text-center" colSpan={6}>No advances in selected date range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {summary && summary.byEmployee.length > 0 && (
          <div className="card">
            <div className="px-3 py-2 font-medium border-b border-white/10">Hours Summary</div>
            <table className="w-full text-sm">
              <thead className="bg-black/40">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-right px-3 py-2">LV1 Hours</th>
                  <th className="text-right px-3 py-2">LV2 Hours</th>
                  <th className="text-right px-3 py-2">Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {summary.byEmployee.map(row => (
                  <tr key={row.user_id} className="border-t border-white/10">
                    <td className="px-3 py-2">{row.full_name || "Unknown"}</td>
                    <td className="px-3 py-2 text-right">{row.lv1_hours}</td>
                    <td className="px-3 py-2 text-right">{row.lv2_hours}</td>
                    <td className="px-3 py-2 text-right font-medium">{row.total_hours}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-black/40">
                <tr className="font-semibold">
                  <td className="px-3 py-2">Totals</td>
                  <td className="px-3 py-2 text-right">{summary.totals.lv1_hours}</td>
                  <td className="px-3 py-2 text-right">{summary.totals.lv2_hours}</td>
                  <td className="px-3 py-2 text-right">{summary.totals.total_hours}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="card">
          <div className="px-3 py-2 font-medium border-b border-white/10">Worked Shifts</div>
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
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={p => runReport(p)} />
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
        <button key={p} className={p === page ? "btn-primary px-3 py-1.5" : "btn-secondary px-3 py-1.5"} onClick={() => onPageChange(p)}>
          {p}
        </button>
      ))}
      <button className="btn-secondary px-3 py-1.5" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
