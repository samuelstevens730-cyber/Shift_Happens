"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  name: string | null;
  active: boolean;
  storeIds: string[];
}
interface Store { id: string; name: string; }

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
  /** worked_hours + projected_hours — used for reconciliation vs Open. */
  grossHours: number;
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

interface ShiftAuditRow {
  shift_id: string;
  shift_date: string;
  store_id: string;
  store_name: string | null;
  profile_id: string;
  employee_name: string | null;
  shift_type: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_logged_in_at: string;
  actual_logged_out_at: string;
  scheduled_length_hours: number;
  actual_length_hours: number;
  start_drift_minutes: number;
  end_drift_minutes: number;
  length_drift_hours: number;
  is_mismatch: boolean;
}

interface OperationalCheck {
  key: string;
  label: string;
  ok: boolean;
  count: number;
  details: Array<Record<string, unknown>>;
}

interface ReconcAudit {
  shiftAudit: { rows: ShiftAuditRow[] };
  operationalChecks: OperationalCheck[];
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
        totals: { lv1_hours: number; lv2_hours: number; total_hours: number };
      };
    }
  | { error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function toLocalInputValueFromISO(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: "Period Setup" },
  { n: 2, label: "Pre-Flight" },
  { n: 3, label: "Hours Review" },
  { n: 4, label: "Export" },
] as const;

function StepIndicator({
  currentStep,
  hasData,
  onStep,
}: {
  currentStep: number;
  hasData: boolean;
  onStep: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto rounded border border-slate-800 bg-slate-900">
      {STEPS.map((s, i) => {
        const active = currentStep === s.n;
        const enabled = hasData || s.n === 1;
        return (
          <div key={s.n} className="flex items-center flex-shrink-0">
            {i > 0 && <div className="w-4 h-0.5 bg-slate-700" />}
            <button
              onClick={() => enabled && onStep(s.n)}
              disabled={!enabled}
              className={`flex items-center gap-2 px-4 py-3 text-sm transition-colors
                ${active
                  ? "bg-cyan-700 text-white font-semibold"
                  : enabled
                    ? "text-slate-300 hover:bg-slate-800 cursor-pointer"
                    : "text-slate-600 cursor-not-allowed"
                }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                ${active ? "bg-white text-cyan-700" : "bg-slate-700 text-slate-300"}`}>
                {s.n}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Shift Slide-Over (inline editing without leaving payroll) ────────────────

function ShiftSlideOver({
  shiftId,
  token,
  onClose,
  onSaved,
}: {
  shiftId: string;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plannedStartAt, setPlannedStartAt] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [shiftNote, setShiftNote] = useState("");
  const [editReason, setEditReason] = useState("");
  const [shiftLabel, setShiftLabel] = useState("");
  const [requiresOverride, setRequiresOverride] = useState(false);
  const [overrideApproved, setOverrideApproved] = useState(false);
  const [overrideNoteInput, setOverrideNoteInput] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/shifts/${shiftId}/detail`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (!active) return;
        if (json.error) { setError(json.error); setLoading(false); return; }
        const s = json.shift;
        setPlannedStartAt(toLocalInputValueFromISO(s.plannedStartAt));
        setStartedAt(toLocalInputValueFromISO(s.startedAt));
        setEndedAt(toLocalInputValueFromISO(s.endedAt));
        setShiftNote(s.shiftNote ?? "");
        setRequiresOverride(Boolean(s.requiresOverride));
        setOverrideApproved(Boolean(s.overrideAt));
        setShiftLabel(`${json.profile?.name ?? "Unknown"} · ${json.store?.name ?? "Unknown"}`);
        setLoading(false);
      })
      .catch(e => {
        if (!active) return;
        setError(e.message ?? "Failed to load shift.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [shiftId, token]);

  async function save() {
    const reason = editReason.trim();
    if (!reason) { setError("Edit reason is required."); return; }
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/admin/shifts/${shiftId}/detail`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reason,
          shift: {
            plannedStartAt: plannedStartAt ? new Date(plannedStartAt).toISOString() : undefined,
            startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
            endedAt: endedAt ? new Date(endedAt).toISOString() : null,
            shiftNote: shiftNote.trim() || null,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save shift.");
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save shift.");
    } finally {
      setSaving(false);
    }
  }

  async function approveOverride() {
    const note = overrideNoteInput.trim();
    if (!note) { setError("An approval note is required."); return; }
    try {
      setOverrideSaving(true);
      setError(null);
      const res = await fetch(`/api/admin/shifts/${shiftId}/detail`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reason: `Override approved: ${note}`,
          override: { action: "approve", note },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string })?.error || "Failed to approve override.");
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to approve override.");
    } finally {
      setOverrideSaving(false);
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-slate-950 border-l border-slate-800 shadow-2xl overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-950">
        <div>
          <div className="font-semibold text-slate-100 text-sm">Quick Edit Shift</div>
          {shiftLabel && <div className="text-xs text-slate-400 mt-0.5">{shiftLabel}</div>}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-100 text-xl leading-none px-1"
        >
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {loading ? (
          <div className="text-slate-400 text-sm">Loading shift...</div>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-slate-400">Planned Start</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                value={plannedStartAt}
                onChange={e => setPlannedStartAt(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Actual Start</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                value={startedAt}
                onChange={e => setStartedAt(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">End</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                value={endedAt}
                onChange={e => setEndedAt(e.target.value)}
              />
            </label>
            {requiresOverride && !overrideApproved && (
              <div className="rounded border border-amber-700/50 bg-amber-950/20 p-3 space-y-2">
                <div className="text-xs font-semibold text-amber-300">⚠ Override Required</div>
                <label className="block text-sm">
                  <span className="text-slate-400">Override Note (required)</span>
                  <textarea
                    className="mt-1 w-full rounded border border-amber-700/60 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
                    rows={2}
                    placeholder="Reason for approving this override…"
                    value={overrideNoteInput}
                    onChange={e => setOverrideNoteInput(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => void approveOverride()}
                  disabled={overrideSaving}
                  className="w-full rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-60"
                >
                  {overrideSaving ? "Approving…" : "Approve Override"}
                </button>
              </div>
            )}
            {requiresOverride && overrideApproved && (
              <div className="rounded border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
                ✓ Override approved
              </div>
            )}
            <label className="block text-sm">
              <span className="text-slate-400">Shift Note</span>
              <textarea
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                rows={2}
                value={shiftNote}
                onChange={e => setShiftNote(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Edit Reason (required)</span>
              <textarea
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
                rows={2}
                placeholder="What changed and why?"
                value={editReason}
                onChange={e => setEditReason(e.target.value)}
              />
            </label>
            {error && <div className="rounded bg-red-950/50 border border-red-700/50 px-3 py-2 text-sm text-red-300">{error}</div>}
            <div className="flex gap-2">
              <button
                onClick={() => void save()}
                disabled={saving}
                className="flex-1 rounded bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <Link
                href={`/admin/shifts/${shiftId}`}
                target="_blank"
                className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Full Detail →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PayrollAdminPage() {
  const today  = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  // Period / filter state
  const [from, setFrom] = useState(toISODate(monday));
  const [to, setTo] = useState(toISODate(today));
  const [asOf, setAsOf] = useState(toISODate(today));
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [selectedStore, setSelectedStore] = useState<string>("all");

  // People/stores loaded once on mount
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);

  // Report data
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
    totals: { lv1_hours: number; lv2_hours: number; total_hours: number };
  } | null>(null);
  const [payrollReport, setPayrollReport] = useState<PayrollReportResponse | null>(null);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);

  // Advance draft form (for Step 2)
  const [advanceDraft, setAdvanceDraft] = useState({
    profileId: "",
    storeId: "",
    advanceDate: toISODate(today),
    advanceHours: "",
    cashAmountDollars: "",
    note: "",
    status: "verified" as "pending_verification" | "verified" | "voided",
  });

  // Export / notes (for Step 4)
  const [notes, setNotes] = useState("");

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [slideOverShiftId, setSlideOverShiftId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [reconcAudit, setReconcAudit] = useState<ReconcAudit | null>(null);
  const [auditMismatchOnly, setAuditMismatchOnly] = useState(true);

  const pageSize = 25;

  // Load auth token (needed for slide-over)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionToken(session?.access_token ?? "");
    });
  }, []);

  // Load stores + profiles once
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) return;
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as
        | { stores: Store[]; users: Array<{ id: string; name: string; active: boolean; storeIds: string[] }> }
        | { error: string };
      if (!res.ok || "error" in json) return;
      setStores(json.stores ?? []);
      setProfiles(
        (json.users ?? [])
          .filter(u => u.active)
          .map(u => ({ id: u.id, name: u.name, active: u.active, storeIds: u.storeIds ?? [] }))
      );
    })();
  }, []);

  const visibleProfiles = useMemo(() => {
    if (selectedStore === "all") return profiles;
    return profiles.filter(p => p.storeIds.includes(selectedStore));
  }, [profiles, selectedStore]);

  useEffect(() => {
    if (selectedUser === "all") return;
    if (!visibleProfiles.some(p => p.id === selectedUser)) setSelectedUser("all");
  }, [selectedUser, visibleProfiles]);

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
      setSessionToken(token);
      if (!token) throw new Error("Unauthorized");

      // Build reconciliation query (same period + filters)
      const reconQs = new URLSearchParams({ from, to, asOf });
      if (selectedStore !== "all") reconQs.set("storeId", selectedStore);
      if (selectedUser !== "all") reconQs.set("profileId", selectedUser);

      const [payrollRes, reportRes, advancesRes, reconRes] = await Promise.all([
        fetch(`/api/admin/payroll?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/payroll/report?${params.toString()}&asOf=${encodeURIComponent(asOf)}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/payroll/advances?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { Authorization: `Bearer ${token}` } }),
        // Non-fatal — network errors resolve to null
        fetch(`/api/admin/payroll/reconciliation?${reconQs.toString()}`, { headers: { Authorization: `Bearer ${token}` } }).catch((): Response | null => null),
      ]);

      const payrollJson = (await payrollRes.json()) as PayrollResponse;
      const reportJson = (await reportRes.json()) as PayrollReportResponse | { error: string };
      const advancesJson = (await advancesRes.json()) as { rows: AdvanceRow[] } | { error: string };

      if (!payrollRes.ok || "error" in payrollJson) throw new Error("error" in payrollJson ? payrollJson.error : "Failed to run report");
      if (!reportRes.ok || "error" in reportJson) throw new Error("error" in reportJson ? reportJson.error : "Failed to build payroll report");
      if (!advancesRes.ok || "error" in advancesJson) throw new Error("error" in advancesJson ? advancesJson.error : "Failed to load advances");

      setRows(payrollJson.rows);
      setPage(payrollJson.page);
      setTotal(payrollJson.total);
      setSummary(payrollJson.summary ?? null);
      setPayrollReport(reportJson as PayrollReportResponse);
      setAdvances(advancesJson.rows ?? []);

      // Non-fatal: parse shift audit + operational checks
      if (reconRes?.ok) {
        try {
          const reconJson = await reconRes.json() as ReconcAudit | { error: string };
          setReconcAudit(!("error" in reconJson) ? (reconJson as ReconcAudit) : null);
        } catch { setReconcAudit(null); }
      } else {
        setReconcAudit(null);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to run report");
      setRows([]);
      setSummary(null);
      setPayrollReport(null);
      setAdvances([]);
      setReconcAudit(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, asOf, selectedUser, selectedStore, page]);

  async function handleLoadData() {
    await runReport(1);
    setWizardStep(2);
  }

  async function saveAdvance() {
    setErr(null);
    if (!advanceDraft.storeId) return setErr("Please select a store.");
    if (!advanceDraft.profileId || !advanceDraft.advanceHours) return setErr("Employee and advance hours are required.");
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) return setErr("Unauthorized");
    const res = await fetch("/api/admin/payroll/advances", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        profileId: advanceDraft.profileId,
        storeId: advanceDraft.storeId,
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

  function exportPayrollPacketPdf() {
    if (!payrollReport) return;

    const safeNotes = notes.trim()
      ? notes.trim().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br/>")
      : "None";

    const employeeRows = payrollReport.employees
      .map(row => `
        <tr>
          <td>${row.full_name || "Unknown"}</td>
          <td style="text-align:right;">${formatNumber(row.worked_hours)}</td>
          <td style="text-align:right;">${formatNumber(row.projected_hours)}</td>
          <td style="text-align:right;">${formatNumber(row.advance_hours)}</td>
          <td style="text-align:right;font-weight:700;">${formatNumber(row.submit_hours)}</td>
        </tr>
      `)
      .join("");

    const now = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
    const gross = payrollReport.grossHours ?? (payrollReport.totals.worked_hours + payrollReport.totals.projected_hours);
    const openMinusGross = payrollReport.openTotals.total_hours - gross;
    const grossMinusOpen = gross - payrollReport.openTotals.total_hours;

    const html = `
      <html>
        <head>
          <title>Payroll Packet ${from} to ${to}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1, h2 { margin: 0 0 12px 0; }
            .muted { color: #555; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
            th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
            th { background: #f5f5f5; text-align: left; }
            .cards { margin: 8px 0 16px 0; }
            .cards div { margin-bottom: 4px; }
          </style>
        </head>
        <body>
          <h1>Payroll Packet</h1>
          <div class="muted">Range: ${from} to ${to} | Worked Through: ${asOf} | Generated: ${now} (CST)</div>
          <h2>Payroll Formula</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th style="text-align:right;">Worked</th>
                <th style="text-align:right;">Projected</th>
                <th style="text-align:right;">Advances</th>
                <th style="text-align:right;">Submit Hours</th>
              </tr>
            </thead>
            <tbody>${employeeRows}</tbody>
            <tfoot>
              <tr>
                <th>Totals</th>
                <th style="text-align:right;">${formatNumber(payrollReport.totals.worked_hours)}</th>
                <th style="text-align:right;">${formatNumber(payrollReport.totals.projected_hours)}</th>
                <th style="text-align:right;">${formatNumber(payrollReport.totals.advances_hours)}</th>
                <th style="text-align:right;">${formatNumber(payrollReport.totals.submitted_hours)}</th>
              </tr>
            </tfoot>
          </table>
          <div class="cards">
            <div><b>LV1 Open Hours:</b> ${formatNumber(payrollReport.openTotals.lv1_hours)}</div>
            <div><b>LV2 Open Hours:</b> ${formatNumber(payrollReport.openTotals.lv2_hours)}</div>
            <div><b>Total Open Hours:</b> ${formatNumber(payrollReport.openTotals.total_hours)}</div>
            <div><b>Gross Hours (worked + projected):</b> ${formatNumber(gross)}</div>
            <div><b>Open minus Gross:</b> ${formatNumber(openMinusGross)}</div>
            <div><b>Gross minus Open:</b> ${formatNumber(grossMinusOpen)}</div>
            ${payrollReport.totals.advances_hours > 0 ? `<div><b>Advances Deducted:</b> ${formatNumber(payrollReport.totals.advances_hours)} hrs → Submit: ${formatNumber(payrollReport.totals.submitted_hours)} hrs</div>` : ""}
          </div>
          <h2>Notes</h2>
          <div>${safeNotes}</div>
          <h2>WhatsApp Summary</h2>
          <pre style="white-space: pre-wrap; border: 1px solid #ddd; padding: 8px;">${payrollReport.whatsappText}</pre>
        </body>
      </html>
    `;

    const w = window.open("", "_blank");
    if (!w) {
      window.alert("Popup blocked. Please allow popups for this site and try again.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.setTimeout(() => { w.print(); }, 250);
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

  const pendingAdvanceCount = advances.filter(a => a.status === "pending_verification").length;
  const gross = payrollReport
    ? (payrollReport.grossHours ?? payrollReport.totals.worked_hours + payrollReport.totals.projected_hours)
    : 0;
  const hoursBalanced = payrollReport ? Math.abs(payrollReport.reconciliationDiff) < 0.01 : false;

  // Unified problem rows built from reconciliation operational checks
  type ProblemItem = { shift_id: string; issue: string; issueKind: "open" | "override" | "drift"; employee: string; store: string; dateStr: string; extra: string };
  const problemRows = useMemo((): ProblemItem[] => {
    if (!reconcAudit) return [];
    const items: ProblemItem[] = [];
    const sp = (d: Record<string, unknown>, k: string) => {
      const v = d[k];
      return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
    };
    for (const d of reconcAudit.operationalChecks.find(c => c.key === "open_shifts")?.details ?? []) {
      const sid = sp(d, "shift_id");
      if (!sid) continue;
      items.push({ shift_id: sid, issue: "Not clocked out", issueKind: "open", employee: sp(d, "employee") || "Unknown", store: sp(d, "store") || "—", dateStr: formatWhen(sp(d, "planned_start_at") || null), extra: "" });
    }
    for (const d of reconcAudit.operationalChecks.find(c => c.key === "unapproved_shifts")?.details ?? []) {
      const sid = sp(d, "shift_id");
      if (!sid) continue;
      const reason = sp(d, "reason");
      items.push({ shift_id: sid, issue: reason === "manual_close_pending_review" ? "Manual close review" : "Override pending", issueKind: "override", employee: sp(d, "employee") || "Unknown", store: sp(d, "store") || "—", dateStr: formatWhen(sp(d, "planned_start_at") || null), extra: "" });
    }
    for (const d of reconcAudit.operationalChecks.find(c => c.key === "unexplained_variance")?.details ?? []) {
      const sid = sp(d, "shift_id");
      if (!sid) continue;
      items.push({ shift_id: sid, issue: `Drift ${sp(d, "drift_hours")}h — no note`, issueKind: "drift", employee: sp(d, "employee") || "Unknown", store: sp(d, "store") || "—", dateStr: formatWhen(sp(d, "planned_start_at") || sp(d, "shift_date") || null), extra: `Sched ${sp(d, "scheduled_start") || "?"}–${sp(d, "scheduled_end") || "?"}` });
    }
    // open first, then override, then drift
    return items.sort((a, b) =>
      (a.issueKind === "open" ? 0 : a.issueKind === "override" ? 1 : 2) -
      (b.issueKind === "open" ? 0 : b.issueKind === "override" ? 1 : 2)
    );
  }, [reconcAudit]);

  const auditRowsFiltered = useMemo(
    () => auditMismatchOnly
      ? (reconcAudit?.shiftAudit.rows ?? []).filter(r => r.is_mismatch)
      : (reconcAudit?.shiftAudit.rows ?? []),
    [reconcAudit, auditMismatchOnly]
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      {/* Slide-over: portal to document.body so fixed positioning is never
          broken by a parent transform / will-change / contain on app-shell */}
      {slideOverShiftId && createPortal(
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setSlideOverShiftId(null)}
          />
          <ShiftSlideOver
            shiftId={slideOverShiftId}
            token={sessionToken}
            onClose={() => setSlideOverShiftId(null)}
            onSaved={() => { setSlideOverShiftId(null); void runReport(1); }}
          />
        </>,
        document.body
      )}

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Payroll</h1>
          <div className="flex gap-2">
            {payrollReport && (
              <button
                onClick={() => void runReport(1)}
                disabled={loading}
                className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {loading ? "Refreshing..." : "↻ Refresh"}
              </button>
            )}
            <Link href="/admin/payroll/reconciliation" className="btn-secondary px-3 py-1.5 text-sm">
              Full Reconciliation
            </Link>
          </div>
        </div>

        {/* Step indicator */}
        <StepIndicator currentStep={wizardStep} hasData={!!payrollReport} onStep={setWizardStep} />

        {err && <div className="banner banner-error text-sm">{err}</div>}

        {/* ── Step 1: Period Setup ─────────────────────────────────────────── */}
        {wizardStep === 1 && (
          <div className="card card-pad space-y-4">
            <div className="font-medium text-slate-100">Set Pay Period & Filters</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm muted">Pay Period From</label>
                <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-sm muted">Pay Period To</label>
                <input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
              </div>
              <div>
                <label className="text-sm muted">Worked Through (asOf)</label>
                <input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} />
                <p className="text-xs muted mt-1">Shifts up to this date are counted as worked; remaining are projected.</p>
              </div>
              <div>
                <label className="text-sm muted">Filter by Employee</label>
                <select className="select" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
                  <option value="all">All Employees</option>
                  {visibleProfiles.map(p => <option key={p.id} value={p.id}>{p.name || p.id.slice(0,8)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm muted">Filter by Store</label>
                <select className="select" value={selectedStore} onChange={e => setSelectedStore(e.target.value)}>
                  <option value="all">All Stores</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void handleLoadData()}
                className="btn-primary px-6 py-2 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? "Loading..." : "Load Payroll Data →"}
              </button>
              {payrollReport && (
                <button onClick={() => setWizardStep(2)} className="btn-secondary px-4 py-2">
                  Skip — Use Previous Data →
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Pre-Flight Checks ────────────────────────────────────── */}
        {wizardStep === 2 && payrollReport && (
          <div className="space-y-4">
            {/* Status cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={`card card-pad space-y-1 ${hoursBalanced ? "border border-green-700/40" : "border border-amber-700/40"}`}>
                <div className={`font-medium text-sm ${hoursBalanced ? "text-green-400" : "text-amber-300"}`}>
                  {hoursBalanced ? "✓ Hours Balance" : "⚠ Hours Off"}
                </div>
                <div className="text-xs muted">
                  Gross: <b className="text-slate-200">{formatNumber(gross)} hrs</b>
                  {" · "}Open: <b className="text-slate-200">{formatNumber(payrollReport.openTotals.total_hours)} hrs</b>
                  {!hoursBalanced && (
                    <span className="text-amber-300 ml-1">
                      ({payrollReport.reconciliationDiff > 0 ? "+" : ""}{formatNumber(payrollReport.reconciliationDiff)} hrs diff)
                    </span>
                  )}
                </div>
                {!hoursBalanced && (
                  <p className="text-xs text-slate-400 mt-1">Review the Hours Review step to find discrepancies.</p>
                )}
              </div>

              <div className={`card card-pad space-y-1 ${pendingAdvanceCount === 0 ? "border border-green-700/40" : "border border-amber-700/40"}`}>
                <div className={`font-medium text-sm ${pendingAdvanceCount === 0 ? "text-green-400" : "text-amber-300"}`}>
                  {pendingAdvanceCount === 0
                    ? "✓ Advances Clear"
                    : `⚠ ${pendingAdvanceCount} Advance${pendingAdvanceCount > 1 ? "s" : ""} Pending Verification`}
                </div>
                <div className="text-xs muted">
                  {pendingAdvanceCount === 0
                    ? "All advances are verified or none exist."
                    : "Unverified advances are NOT counted in payroll. Verify or void below."}
                </div>
                {payrollReport.totals.advances_hours > 0 && (
                  <div className="text-xs text-slate-400">
                    Total verified advances: <b className="text-slate-200">{formatNumber(payrollReport.totals.advances_hours)} hrs</b>
                  </div>
                )}
              </div>
            </div>

            {/* Advances table */}
            <div className="card space-y-4 p-4">
              <div className="font-medium">Advances Management</div>
              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                <select className="select" value={advanceDraft.profileId} onChange={e => setAdvanceDraft(d => ({ ...d, profileId: e.target.value }))}>
                  <option value="">Employee</option>
                  {visibleProfiles.map(p => <option key={p.id} value={p.id}>{p.name || p.id.slice(0,8)}</option>)}
                </select>
                <select className="select" value={advanceDraft.storeId} onChange={e => setAdvanceDraft(d => ({ ...d, storeId: e.target.value }))}>
                  <option value="" disabled>Select Store</option>
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
                <button className="btn-primary px-3 py-2" onClick={() => void saveAdvance()}>Add</button>
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
                    <tr key={row.id} className={`border-t border-white/10 ${row.status === "pending_verification" ? "bg-amber-950/20" : ""}`}>
                      <td className="px-3 py-2">{row.profile?.name || "Unknown"}</td>
                      <td className="px-3 py-2">{formatWhen(row.advance_date)}</td>
                      <td className="px-3 py-2 text-right">{row.advance_hours}</td>
                      <td className="px-3 py-2 text-right">{row.cash_amount_cents == null ? "--" : `$${(row.cash_amount_cents / 100).toFixed(2)}`}</td>
                      <td className={`px-3 py-2 text-xs font-medium ${row.status === "verified" ? "text-green-400" : row.status === "voided" ? "text-red-400" : "text-amber-300"}`}>
                        {row.status.replace("_", " ").toUpperCase()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {row.status !== "verified" && (
                            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => void updateAdvance(row.id, { status: "verified" })}>Verify</button>
                          )}
                          {row.status !== "voided" && (
                            <button className="btn-secondary px-2 py-1 text-xs" onClick={() => void updateAdvance(row.id, { status: "voided" })}>Void</button>
                          )}
                          <button className="btn-secondary px-2 py-1 text-xs" onClick={() => void deleteAdvance(row.id)}>Delete</button>
                        </div>
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

            <div className="flex gap-3">
              <button onClick={() => setWizardStep(1)} className="btn-secondary px-4 py-2">← Period Setup</button>
              <button onClick={() => setWizardStep(3)} className="btn-primary px-6 py-2">Hours Review →</button>
            </div>
          </div>
        )}

        {/* ── Step 3: Hours Review ─────────────────────────────────────────── */}
        {wizardStep === 3 && payrollReport && (
          <div className="space-y-4">
            {/* Payroll Formula Report */}
            <div className="card space-y-4 p-4">
              <div className="font-medium">Payroll Formula — {from} to {to}</div>
              <table className="w-full text-sm">
                <thead className="bg-black/40">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-right px-3 py-2">Worked</th>
                    <th className="text-right px-3 py-2">Projected</th>
                    <th className="text-right px-3 py-2">Advances</th>
                    <th className="text-right px-3 py-2">Submit Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollReport.employees.map(row => (
                    <tr key={row.user_id} className="border-t border-white/10">
                      <td className="px-3 py-2">{row.full_name || "Unknown"}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.worked_hours)}</td>
                      <td className="px-3 py-2 text-right">{row.projected_hours > 0 ? <span className="text-cyan-400">{formatNumber(row.projected_hours)}</span> : "—"}</td>
                      <td className="px-3 py-2 text-right">{row.advance_hours > 0 ? <span className="text-amber-300">-{formatNumber(row.advance_hours)}</span> : "—"}</td>
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

              {/* Open Hours cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="card card-pad">LV1 Open: <b>{formatNumber(payrollReport.openTotals.lv1_hours)} hrs</b></div>
                <div className="card card-pad">LV2 Open: <b>{formatNumber(payrollReport.openTotals.lv2_hours)} hrs</b></div>
                <div className="card card-pad">Total Open: <b>{formatNumber(payrollReport.openTotals.total_hours)} hrs</b></div>
              </div>

              {/* Reconciliation status */}
              <div className="space-y-1">
                <div className={`text-sm font-medium ${hoursBalanced ? "text-green-400" : "text-amber-300"}`}>
                  {hoursBalanced
                    ? "✓ Gross hours match open schedule"
                    : payrollReport.reconciliationDiff > 0
                      ? `Gross minus Open: +${formatNumber(payrollReport.reconciliationDiff)} hrs`
                      : `Open minus Gross: ${formatNumber(Math.abs(payrollReport.reconciliationDiff))} hrs`}
                </div>
                <div className="text-xs text-slate-400">
                  Gross (worked + projected): <b className="text-slate-200">{formatNumber(gross)} hrs</b>
                  {" | "}Open: <b className="text-slate-200">{formatNumber(payrollReport.openTotals.total_hours)} hrs</b>
                  {payrollReport.totals.advances_hours > 0 && (
                    <span className="ml-2">
                      · Advances: <b className="text-amber-300">-{formatNumber(payrollReport.totals.advances_hours)} hrs</b>
                      {" → "}Submit: <b className="text-slate-200">{formatNumber(payrollReport.totals.submitted_hours)} hrs</b>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Hours Summary by Store */}
            {summary && summary.byEmployee.length > 0 && (
              <div className="card">
                <div className="px-3 py-2 font-medium border-b border-white/10">Hours Summary by Store</div>
                <table className="w-full text-sm">
                  <thead className="bg-black/40">
                    <tr>
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-right px-3 py-2">LV1</th>
                      <th className="text-right px-3 py-2">LV2</th>
                      <th className="text-right px-3 py-2">Total</th>
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

            {/* ── Shifts Needing Attention ──────────────────────────────── */}
            <div className="card">
              <div className="px-3 py-2 font-medium border-b border-white/10 flex items-center gap-2">
                <span>Shifts Needing Attention</span>
                {reconcAudit && (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-normal ${problemRows.length > 0 ? "bg-amber-500/20 text-amber-300" : "bg-green-500/15 text-green-400"}`}>
                    {problemRows.length === 0 ? "✓ None" : problemRows.length}
                  </span>
                )}
              </div>
              {!reconcAudit ? (
                <div className="px-3 py-4 text-sm text-slate-500">
                  {loading ? "Loading audit data…" : "Shift audit unavailable — check Full Reconciliation."}
                </div>
              ) : problemRows.length === 0 ? (
                <div className="px-3 py-4 text-sm text-green-400">✓ No open shifts, pending overrides, or unexplained variances found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-black/40">
                      <tr>
                        <th className="text-left px-3 py-2">Issue</th>
                        <th className="text-left px-3 py-2">Employee</th>
                        <th className="text-left px-3 py-2">Store</th>
                        <th className="text-left px-3 py-2">Date / Start</th>
                        <th className="text-left px-3 py-2">Detail</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemRows.map((row, i) => (
                        <tr key={`${row.shift_id}-${i}`} className={`border-t border-white/10 ${row.issueKind === "open" ? "bg-red-500/5" : "bg-amber-500/5"}`}>
                          <td className="px-3 py-2">
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                              row.issueKind === "open"
                                ? "bg-red-500/20 text-red-300"
                                : row.issueKind === "override"
                                  ? "bg-amber-500/20 text-amber-300"
                                  : "bg-orange-500/20 text-orange-300"
                            }`}>
                              {row.issue}
                            </span>
                          </td>
                          <td className="px-3 py-2">{row.employee}</td>
                          <td className="px-3 py-2">{row.store}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{row.dateStr}</td>
                          <td className="px-3 py-2 text-xs text-slate-400">{row.extra}</td>
                          <td className="px-3 py-2 text-right">
                            {row.shift_id && (
                              <button
                                className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                                onClick={() => setSlideOverShiftId(row.shift_id)}
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reconcAudit.operationalChecks.some(c => !c.ok && c.count > c.details.length) && (
                    <div className="px-3 py-2 text-xs text-slate-500 border-t border-white/10">
                      Some categories are capped at 10 — use{" "}
                      <a href="/admin/payroll/reconciliation" target="_blank" className="underline hover:text-slate-300">Full Reconciliation</a>
                      {" "}for the complete list.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Scheduled vs Actual Shift Log ────────────────────────── */}
            {reconcAudit && (
              <div className="card">
                <div className="px-3 py-2 font-medium border-b border-white/10 flex items-center justify-between">
                  <span>Scheduled vs Actual ({auditRowsFiltered.length}{auditMismatchOnly && reconcAudit.shiftAudit.rows.length !== auditRowsFiltered.length ? ` of ${reconcAudit.shiftAudit.rows.length}` : ""})</span>
                  <label className="flex items-center gap-2 text-xs text-slate-400 font-normal cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={auditMismatchOnly}
                      onChange={e => setAuditMismatchOnly(e.target.checked)}
                    />
                    Mismatches only
                  </label>
                </div>
                {auditRowsFiltered.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-green-400">✓ All matched shifts are on schedule.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[860px]">
                      <thead className="bg-black/40">
                        <tr>
                          <th className="text-left px-3 py-2">Date</th>
                          <th className="text-left px-3 py-2">Employee</th>
                          <th className="text-left px-3 py-2">Store</th>
                          <th className="text-left px-3 py-2">Type</th>
                          <th className="text-left px-3 py-2">Scheduled</th>
                          <th className="text-left px-3 py-2">Actual</th>
                          <th className="text-right px-3 py-2">Sched Hrs</th>
                          <th className="text-right px-3 py-2">Actual Hrs</th>
                          <th className="text-right px-3 py-2">Drift</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditRowsFiltered.map(row => (
                          <tr key={row.shift_id} className={`border-t border-white/10 hover:bg-white/5 ${row.is_mismatch ? "bg-amber-500/5" : ""}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{row.shift_date}</td>
                            <td className="px-3 py-2">{row.employee_name ?? "Unknown"}</td>
                            <td className="px-3 py-2">{row.store_name ?? "—"}</td>
                            <td className="px-3 py-2 uppercase text-xs text-slate-400">{row.shift_type}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-slate-400">{row.scheduled_start}–{row.scheduled_end}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {new Date(row.actual_logged_in_at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true })}
                              {" – "}
                              {new Date(row.actual_logged_out_at).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true })}
                            </td>
                            <td className="px-3 py-2 text-right">{formatNumber(row.scheduled_length_hours)}</td>
                            <td className="px-3 py-2 text-right">{formatNumber(row.actual_length_hours)}</td>
                            <td className={`px-3 py-2 text-right font-medium ${Math.abs(row.length_drift_hours) >= 0.5 ? "text-amber-300" : "text-slate-400"}`}>
                              {row.length_drift_hours > 0 ? "+" : ""}{formatNumber(row.length_drift_hours)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                                onClick={() => setSlideOverShiftId(row.shift_id)}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setWizardStep(2)} className="btn-secondary px-4 py-2">← Pre-Flight</button>
              <button onClick={() => setWizardStep(4)} className="btn-primary px-6 py-2">Export →</button>
              <button onClick={exportCsv} className="btn-secondary px-3 py-2 disabled:opacity-50" disabled={!rows.length}>
                Export CSV
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Export ───────────────────────────────────────────────── */}
        {wizardStep === 4 && payrollReport && (
          <div className="space-y-4">
            {/* Summary recap */}
            <div className="card card-pad space-y-3">
              <div className="font-medium text-slate-100">Payroll Summary — {from} to {to}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="card card-pad">
                  <div className="text-xs muted">Submit Hours</div>
                  <div className="text-xl font-semibold">{formatNumber(payrollReport.totals.submitted_hours)}</div>
                </div>
                <div className="card card-pad">
                  <div className="text-xs muted">LV1 Open</div>
                  <div className="text-xl font-semibold">{formatNumber(payrollReport.openTotals.lv1_hours)}</div>
                </div>
                <div className="card card-pad">
                  <div className="text-xs muted">LV2 Open</div>
                  <div className="text-xl font-semibold">{formatNumber(payrollReport.openTotals.lv2_hours)}</div>
                </div>
                <div className={`card card-pad ${hoursBalanced ? "border border-green-700/50" : "border border-amber-700/50"}`}>
                  <div className="text-xs muted">Balance</div>
                  <div className={`text-xl font-semibold ${hoursBalanced ? "text-green-400" : "text-amber-300"}`}>
                    {hoursBalanced ? "✓ OK" : `${payrollReport.reconciliationDiff > 0 ? "+" : ""}${formatNumber(payrollReport.reconciliationDiff)}`}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm muted">Notes (included in PDF and WhatsApp export)</label>
                <textarea
                  className="input min-h-24 mt-1"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Add any notes for the payroll record…"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-primary px-4 py-2"
                  onClick={exportPayrollPacketPdf}
                >
                  Export PDF Packet
                </button>
                <button
                  className="btn-secondary px-4 py-2"
                  onClick={() => void copyWhatsappSummary()}
                >
                  Copy WhatsApp Summary
                </button>
                <button
                  className="btn-secondary px-4 py-2 disabled:opacity-50"
                  onClick={exportCsv}
                  disabled={!rows.length}
                >
                  Export CSV
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setWizardStep(3)} className="btn-secondary px-4 py-2">← Hours Review</button>
            </div>
          </div>
        )}

        {/* "No data yet" prompt on steps 2-4 if data not loaded */}
        {wizardStep > 1 && !payrollReport && (
          <div className="card card-pad text-center space-y-3">
            <div className="text-slate-400 text-sm">No payroll data loaded yet.</div>
            <button onClick={() => setWizardStep(1)} className="btn-primary px-4 py-2">
              ← Go to Period Setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

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
    <div className="flex gap-1 justify-center flex-wrap">
      {pages.map(p => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`px-3 py-1 rounded text-sm ${p === page ? "btn-primary" : "btn-secondary"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
