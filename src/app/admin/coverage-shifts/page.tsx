"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type CoverageRequest = {
  id: string;
  shift_date: string;
  time_in: string;
  time_out: string;
  notes: string | null;
  status: "pending" | "approved" | "denied";
  denial_reason: string | null;
  created_at: string;
  profiles: { name: string } | null;
  coverage_store: { name: string } | null;
};

export default function CoverageShiftsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<CoverageRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [pageError, setPageError]     = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    const res = await fetch("/api/requests/coverage-shift", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    if (!res.ok) { setPageError(json.error ?? "Failed to load"); setLoading(false); return; }
    setRequests(json.requests ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(
    id: string,
    action: "approve" | "deny",
    denialReason?: string
  ) {
    setActionError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    const res = await fetch(`/api/requests/coverage-shift/${id}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: action === "deny" ? JSON.stringify({ denialReason: denialReason ?? null }) : "{}",
    });
    const json = await res.json();
    if (!res.ok) { setActionError(json.error ?? "Action failed"); return; }
    await load();
  }

  const pending  = requests.filter(r => r.status === "pending");
  const resolved = requests.filter(r => r.status !== "pending");

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-tight text-[var(--text)]">Coverage Shift Requests</h1>
        </div>

        {pageError   && <div className="banner banner-error">{pageError}</div>}
        {actionError && <div className="banner banner-error">{actionError}</div>}
        {loading     && <div className="text-sm muted">Loading…</div>}

        {!loading && pending.length === 0 && (
          <div className="card card-pad text-sm muted">No pending coverage requests.</div>
        )}

        <div className="space-y-3">
          {pending.map(r => (
            <CoverageCard key={r.id} request={r} onAction={handleAction} />
          ))}
        </div>

        {resolved.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm muted py-2">
              {resolved.length} resolved request{resolved.length !== 1 ? "s" : ""}
            </summary>
            <div className="mt-2 space-y-2">
              {resolved.map(r => (
                <CoverageCard key={r.id} request={r} onAction={handleAction} readOnly />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function CoverageCard({
  request: r,
  onAction,
  readOnly = false,
}: {
  request: CoverageRequest;
  onAction: (id: string, action: "approve" | "deny", reason?: string) => void;
  readOnly?: boolean;
}) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason]   = useState("");

  const timeIn  = new Date(r.time_in).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit",
  });
  const timeOut = new Date(r.time_out).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit",
  });
  const hours = (
    (new Date(r.time_out).getTime() - new Date(r.time_in).getTime()) / 3_600_000
  ).toFixed(1);

  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="font-semibold">{r.profiles?.name ?? "Unknown"}</div>
          <div className="text-sm muted">
            {r.shift_date} · {timeIn}–{timeOut} ({hours} hrs)
          </div>
          <div className="text-sm muted">
            Coverage @ {r.coverage_store?.name ?? "Unknown store"}
          </div>
          {r.notes && (
            <div className="text-sm mt-1 italic text-white/60">{r.notes}</div>
          )}
          {r.status === "denied" && r.denial_reason && (
            <div className="text-sm text-red-400 mt-1">Denied: {r.denial_reason}</div>
          )}
        </div>
        <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 ${
          r.status === "approved" ? "bg-emerald-500/20 text-emerald-300"
          : r.status === "denied"  ? "bg-red-500/20 text-red-300"
          : "bg-amber-500/20 text-amber-200"
        }`}>
          {r.status}
        </span>
      </div>

      {!readOnly && r.status === "pending" && !denying && (
        <div className="flex gap-2">
          <button
            className="btn-primary px-3 py-1.5"
            onClick={() => onAction(r.id, "approve")}
          >
            Approve
          </button>
          <button
            className="btn-secondary px-3 py-1.5"
            onClick={() => setDenying(true)}
          >
            Deny
          </button>
        </div>
      )}

      {denying && (
        <div className="space-y-2">
          <input
            className="input w-full"
            placeholder="Reason for denial (optional)"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn-secondary px-3 py-1.5"
              onClick={() => { onAction(r.id, "deny", reason); setDenying(false); }}
            >
              Confirm Deny
            </button>
            <button
              className="btn-secondary px-3 py-1.5"
              onClick={() => { setDenying(false); setReason(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
