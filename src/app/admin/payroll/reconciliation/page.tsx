"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };

type CheckRow = {
  key: string;
  label: string;
  ok: boolean;
  count: number;
  details: Record<string, unknown>[];
};

type ReconciliationResponse = {
  status: "ok" | "needs_attention";
  period: { from: string; to: string; asOf: string };
  thresholds: {
    payroll_variance_warn_hours: number;
    payroll_shift_drift_warn_hours: number;
  };
  operationalChecks: CheckRow[];
  staffingReconciliation: {
    openTotals: { lv1_hours: number; lv2_hours: number; total_hours: number };
    scheduledTotals: { lv1_hours: number; lv2_hours: number; total_hours: number };
    open_minus_scheduled: number;
    coverage_percent: number;
  };
  employeeSummary: {
    user_id: string;
    full_name: string | null;
    worked_hours: number;
    projected_hours: number;
    scheduled_hours: number;
    advance_hours: number;
    submit_hours: number;
  }[];
  financialReconciliation: {
    scheduled_hours: number;
    worked_hours: number;
    projected_hours: number;
    advances_hours: number;
    submitted_hours: number;
    scheduled_minus_submitted: number;
    submitted_minus_scheduled: number;
    open_minus_submitted: number;
  };
  warnings: string[];
  whatsappText: string;
};

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function renderCheckDetail(checkKey: string, detail: Record<string, unknown>) {
  if (checkKey === "unapproved_shifts") {
    return `${detail.employee ?? "Unknown"} @ ${detail.store ?? "Unknown"} | ${detail.planned_start_at ?? "--"} | ${detail.reason ?? "pending_review"}`;
  }
  if (checkKey === "missing_coverage") {
    return `${detail.shift_date ?? "--"} | ${detail.store ?? "Unknown"} | ${detail.employee ?? "Unknown"} | ${detail.shift_type ?? "shift"} not logged`;
  }
  if (checkKey === "open_shifts") {
    return `${detail.employee ?? "Unknown"} @ ${detail.store ?? "Unknown"} | open since ${detail.planned_start_at ?? "--"}`;
  }
  if (checkKey === "unexplained_variance") {
    return `${detail.shift_date ?? "--"} | ${detail.employee ?? "Unknown"} @ ${detail.store ?? "Unknown"} | scheduled ${detail.scheduled_start ?? "--"}-${detail.scheduled_end ?? "--"} | planned ${detail.planned_start_at ?? "--"} to ${detail.planned_end_at ?? "--"} | drift ${detail.drift_hours ?? "--"}h | no override note`;
  }
  return JSON.stringify(detail);
}

function checkActionLink(checkKey: string) {
  if (checkKey === "unapproved_shifts") return { href: "/admin/overrides", label: "Review Overrides" };
  if (checkKey === "missing_coverage") return { href: "/admin/shifts", label: "Review Shifts" };
  if (checkKey === "open_shifts") return { href: "/admin/open-shifts", label: "Review Open Shifts" };
  if (checkKey === "unexplained_variance") return { href: "/admin/shifts", label: "Review Shift Variances" };
  return null;
}

export default function PayrollReconciliationPage() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const [from, setFrom] = useState(toISODate(monday));
  const [to, setTo] = useState(toISODate(today));
  const [asOf, setAsOf] = useState(toISODate(today));
  const [selectedStore, setSelectedStore] = useState("all");
  const [stores, setStores] = useState<Store[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReconciliationResponse | null>(null);

  async function run() {
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) throw new Error("Unauthorized");

      const settingsRes = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const settingsJson = await settingsRes.json();
      if (settingsRes.ok && settingsJson?.stores) {
        setStores(settingsJson.stores as Store[]);
      }

      const qs = new URLSearchParams({ from, to, asOf });
      if (selectedStore !== "all") qs.set("storeId", selectedStore);

      const res = await fetch(`/api/admin/payroll/reconciliation?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as ReconciliationResponse | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : "Failed to run reconciliation.");
      }
      setReport(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to run reconciliation.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void run();
  }, []);

  const notesBlock = useMemo(() => {
    return notes.trim() ? `\n\nNotes:\n${notes.trim()}` : "";
  }, [notes]);

  async function copyWhatsapp() {
    if (!report) return;
    await navigator.clipboard.writeText(`${report.whatsappText}${notesBlock}`);
  }

  function exportPdf() {
    if (!report) return;
    const safeNotes = notes.trim()
      ? notes
          .trim()
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll("\n", "<br/>")
      : "None";
    const rows = report.employeeSummary
      .map(r => `
        <tr>
          <td>${r.full_name || "Unknown"}</td>
          <td style="text-align:right">${formatNumber(r.worked_hours)}</td>
          <td style="text-align:right">${formatNumber(r.projected_hours)}</td>
          <td style="text-align:right">${formatNumber(r.scheduled_hours)}</td>
          <td style="text-align:right">${formatNumber(r.advance_hours)}</td>
          <td style="text-align:right;font-weight:700">${formatNumber(r.submit_hours)}</td>
        </tr>
      `)
      .join("");

    const html = `
      <html><head><title>Payroll Reconciliation</title>
      <style>
        body { font-family: Arial; padding: 20px; color: #111; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0 16px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
        th { background: #f5f5f5; text-align: left; }
      </style></head><body>
      <h1>Payroll Reconciliation Report</h1>
      <div>Period: ${report.period.from} to ${report.period.to} | Worked Through: ${report.period.asOf}</div>
      <div>Status: ${report.status === "ok" ? "OK" : "Needs Attention"}</div>
      <h2>Employee Summary</h2>
      <table>
        <thead><tr><th>Name</th><th>Worked</th><th>Projected</th><th>Scheduled</th><th>Advance</th><th>Payable</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h2>Warnings</h2>
      <ul>${report.warnings.map(w => `<li>${w}</li>`).join("") || "<li>None</li>"}</ul>
      <h2>Notes</h2>
      <div>${safeNotes}</div>
      <h2>WhatsApp Summary</h2>
      <pre>${report.whatsappText}</pre>
      </body></html>
    `;
    const w = window.open("about:blank", "_blank");
    if (!w) {
      window.alert("Popup blocked. Please allow popups for this site and try again.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.setTimeout(() => {
      w.print();
    }, 250);
  }

  return (
    <div className="app-shell">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Payroll Reconciliation</h1>
          <Link href="/admin/payroll" className="btn-secondary px-3 py-2">Back to Payroll</Link>
        </div>

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
            <label className="text-sm muted">Worked Through</label>
            <input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">Store</label>
            <select className="select" value={selectedStore} onChange={e => setSelectedStore(e.target.value)}>
              <option value="all">All managed stores</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button className="btn-primary px-4 py-2 disabled:opacity-50" disabled={loading} onClick={run}>
            {loading ? "Running..." : "Run Reconciliation"}
          </button>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        {report && (
          <div className="space-y-4">
            <div className={`card card-pad ${report.status === "ok" ? "border-green-500/30" : "border-amber-500/30"}`}>
              <div className="text-sm">
                Status: <b>{report.status === "ok" ? "OK" : "NEEDS ATTENTION"}</b>
              </div>
              <div className="text-xs muted mt-1">
                Thresholds: payroll variance {report.thresholds.payroll_variance_warn_hours}h, drift {report.thresholds.payroll_shift_drift_warn_hours}h
              </div>
            </div>

            <div className="card p-4 space-y-3">
              <div className="font-medium">Operational Checks</div>
              {report.operationalChecks.map(check => (
                (() => {
                  const action = !check.ok ? checkActionLink(check.key) : null;
                  return (
                <div
                  key={check.key}
                  className={`rounded border p-3 ${
                    check.ok ? "border-green-500/20 bg-green-500/5" : "border-amber-500/25 bg-amber-500/5"
                  }`}
                >
                  <div className="text-sm flex items-center justify-between gap-2">
                    <span>{check.ok ? "[OK]" : "[WARN]"} {check.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded bg-black/30">{check.count}</span>
                      {action && (
                        <Link
                          href={action.href}
                          className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                        >
                          {action.label}
                        </Link>
                      )}
                    </div>
                  </div>
                  {!check.ok && check.details.length > 0 && (
                    <div className="text-xs mt-2 space-y-1">
                      {check.details.slice(0, 8).map((d, idx) => (
                        <div key={`${check.key}-${idx}`} className="rounded bg-black/20 px-2 py-1 text-white/80">
                          {renderCheckDetail(check.key, d)}
                        </div>
                      ))}
                      {check.details.length > 8 && (
                        <div className="text-white/50">+{check.details.length - 8} more</div>
                      )}
                    </div>
                  )}
                </div>
                  );
                })()
              ))}
            </div>

            <div className="card p-4 space-y-2">
              <div className="font-medium">Staffing Reconciliation</div>
              <div className="text-sm">LV1 Open: <b>{formatNumber(report.staffingReconciliation.openTotals.lv1_hours)}</b> | Scheduled: <b>{formatNumber(report.staffingReconciliation.scheduledTotals.lv1_hours)}</b></div>
              <div className="text-sm">LV2 Open: <b>{formatNumber(report.staffingReconciliation.openTotals.lv2_hours)}</b> | Scheduled: <b>{formatNumber(report.staffingReconciliation.scheduledTotals.lv2_hours)}</b></div>
              <div className="text-sm">Total Open: <b>{formatNumber(report.staffingReconciliation.openTotals.total_hours)}</b> | Scheduled: <b>{formatNumber(report.staffingReconciliation.scheduledTotals.total_hours)}</b></div>
              <div className="text-sm">Coverage: <b>{report.staffingReconciliation.coverage_percent}%</b></div>
            </div>

            <div className="card p-4">
              <div className="font-medium mb-3">Employee Summary (Hours)</div>
              <table className="w-full text-sm">
                <thead className="bg-black/40">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-right px-3 py-2">Worked</th>
                    <th className="text-right px-3 py-2">Projected</th>
                    <th className="text-right px-3 py-2">Scheduled</th>
                    <th className="text-right px-3 py-2">Advance</th>
                    <th className="text-right px-3 py-2">Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {report.employeeSummary.map(row => (
                    <tr key={row.user_id} className="border-t border-white/10">
                      <td className="px-3 py-2">{row.full_name || "Unknown"}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.worked_hours)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.projected_hours)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.scheduled_hours)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.advance_hours)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.submit_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card p-4 space-y-2">
              <div className="font-medium">Financial Reconciliation</div>
              <div className="text-sm">Scheduled labor hours: <b>{formatNumber(report.financialReconciliation.scheduled_hours)}</b></div>
              <div className="text-sm">Worked + Projected: <b>{formatNumber(report.financialReconciliation.worked_hours + report.financialReconciliation.projected_hours)}</b></div>
              <div className="text-sm">Less Advances: <b>{formatNumber(report.financialReconciliation.advances_hours)}</b></div>
              <div className="text-sm">Hours to submit: <b>{formatNumber(report.financialReconciliation.submitted_hours)}</b></div>
              <div className="text-sm">Scheduled minus Submitted: <b>{formatNumber(report.financialReconciliation.scheduled_minus_submitted)}</b></div>
              <div className="text-sm">Submitted minus Scheduled: <b>{formatNumber(report.financialReconciliation.submitted_minus_scheduled)}</b></div>
              <div className="text-sm">Open minus Submitted: <b>{formatNumber(report.financialReconciliation.open_minus_submitted)}</b></div>
              {report.warnings.length > 0 && (
                <div className="banner banner-warn text-sm">
                  {report.warnings.join(" ")}
                </div>
              )}
            </div>

            <div className="card p-4 space-y-2">
              <label className="text-sm muted">Notes</label>
              <textarea className="input min-h-24" value={notes} onChange={e => setNotes(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary px-3 py-2" onClick={copyWhatsapp}>WhatsApp Copy</button>
                <button className="btn-secondary px-3 py-2" onClick={exportPdf}>PDF Export</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
