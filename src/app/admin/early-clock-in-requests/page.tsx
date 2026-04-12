"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type EarlyClockInRequest = {
  id: string;
  store_id: string;
  profile_id: string;
  schedule_shift_id: string;
  shift_date: string;
  requested_planned_start_at: string;
  scheduled_start_at: string;
  requested_shift_type: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  manager_planned_start_at: string | null;
  manager_started_at: string | null;
  denial_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  stores: { name: string } | null;
  profiles: { name: string } | null;
};

function toLocalInputValue(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function formatCst(value: string | null) {
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

function toIsoFromLocalInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  const isoLike = `${y}-${m}-${d}T${hh}:${mm}:00Z`;
  const dt = new Date(isoLike);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(dt);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const offsetMatch = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!offsetMatch) return null;
  const hours = Number(offsetMatch[1]);
  const minutes = Number(offsetMatch[2] || "0");
  const offset = hours * 60 + (hours < 0 ? -minutes : minutes);
  const utcMillis = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)) - offset * 60000;
  return new Date(utcMillis).toISOString();
}

export default function EarlyClockInRequestsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const actionId = searchParams.get("actionId");
  const highlightedRequestId = actionId?.startsWith("approval-earlyclockin-")
    ? actionId.replace("approval-earlyclockin-", "")
    : null;
  const [requests, setRequests] = useState<EarlyClockInRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    if (!token) {
      router.replace("/login?next=/admin/early-clock-in-requests");
      return;
    }
    const res = await fetch("/api/admin/early-clock-in-requests", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load early clock-in requests.");
    setRequests(json.requests ?? []);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await load();
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load early clock-in requests.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pending = useMemo(() => requests.filter((row) => row.status === "pending"), [requests]);
  const resolved = useMemo(() => requests.filter((row) => row.status !== "pending"), [requests]);

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-tight text-[var(--text)]">
            Early Clock-In Requests
          </h1>
          <p className="text-sm muted">Approve or deny employees requesting an early scheduled shift start.</p>
        </div>

        {error && <div className="banner banner-error">{error}</div>}
        {loading && <div className="text-sm muted">Loading...</div>}

        {!loading && pending.length === 0 && (
          <div className="card card-pad text-sm muted">No pending early clock-in requests.</div>
        )}

        <div className="space-y-3">
          {pending.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              highlighted={request.id === highlightedRequestId}
              saving={savingId === request.id}
              onApprove={async (payload) => {
                setSavingId(request.id);
                setError(null);
                try {
                  const {
                    data: { session },
                  } = await supabase.auth.getSession();
                  const token = session?.access_token ?? "";
                  if (!token) {
                    router.replace("/login?next=/admin/early-clock-in-requests");
                    return;
                  }
                  const res = await fetch(`/api/admin/early-clock-in-requests/${request.id}/approve`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(payload),
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "Failed to approve request.");
                  await load();
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Failed to approve request.");
                } finally {
                  setSavingId(null);
                }
              }}
              onDeny={async (denialReason) => {
                setSavingId(request.id);
                setError(null);
                try {
                  const {
                    data: { session },
                  } = await supabase.auth.getSession();
                  const token = session?.access_token ?? "";
                  if (!token) {
                    router.replace("/login?next=/admin/early-clock-in-requests");
                    return;
                  }
                  const res = await fetch(`/api/admin/early-clock-in-requests/${request.id}/deny`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ denialReason }),
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "Failed to deny request.");
                  await load();
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Failed to deny request.");
                } finally {
                  setSavingId(null);
                }
              }}
            />
          ))}
        </div>

        {resolved.length > 0 && (
          <details>
            <summary className="cursor-pointer py-2 text-sm muted">
              {resolved.length} resolved request{resolved.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-2 space-y-2">
              {resolved.map((request) => (
                <div key={request.id} className="card card-pad space-y-2">
                  <div className="font-semibold">{request.profiles?.name ?? "Unknown employee"}</div>
                  <div className="text-sm muted">
                    {request.shift_date} · Requested {formatCst(request.requested_planned_start_at)} · Scheduled {formatCst(request.scheduled_start_at)}
                  </div>
                  <div className="text-sm muted">Store: {request.stores?.name ?? "Unknown store"}</div>
                  <div className="text-xs muted uppercase tracking-[0.12em]">{request.status}</div>
                  {request.denial_reason && <div className="text-sm text-red-400">Denied: {request.denial_reason}</div>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function RequestCard({
  request,
  highlighted,
  saving,
  onApprove,
  onDeny,
}: {
  request: EarlyClockInRequest;
  highlighted: boolean;
  saving: boolean;
  onApprove: (payload: { managerPlannedStartAt: string; managerStartedAt: string }) => Promise<void>;
  onDeny: (denialReason: string) => Promise<void>;
}) {
  const [managerPlannedStart, setManagerPlannedStart] = useState(() => toLocalInputValue(request.requested_planned_start_at));
  const [managerStartedAt, setManagerStartedAt] = useState(() => toLocalInputValue(request.requested_planned_start_at));
  const [denialReason, setDenialReason] = useState("");
  const [showDeny, setShowDeny] = useState(false);

  return (
    <div className={`card card-pad space-y-3 ${highlighted ? "ring-2 ring-cyan-400/60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-semibold">{request.profiles?.name ?? "Unknown employee"}</div>
          <div className="text-sm muted">Store: {request.stores?.name ?? "Unknown store"}</div>
          <div className="text-sm muted">Shift date: {request.shift_date}</div>
          <div className="text-sm muted">Shift type: {request.requested_shift_type}</div>
          <div className="text-sm muted">Scheduled start: {formatCst(request.scheduled_start_at)}</div>
          <div className="text-sm muted">Requested start: {formatCst(request.requested_planned_start_at)}</div>
        </div>
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">pending</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Planned start</span>
          <input
            type="datetime-local"
            className="input w-full"
            value={managerPlannedStart}
            onChange={(e) => setManagerPlannedStart(e.target.value)}
            disabled={saving}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Actual start</span>
          <input
            type="datetime-local"
            className="input w-full"
            value={managerStartedAt}
            onChange={(e) => setManagerStartedAt(e.target.value)}
            disabled={saving}
          />
        </label>
      </div>

      {showDeny && (
        <div className="space-y-2">
          <input
            className="input w-full"
            placeholder="Reason for denial (optional)"
            value={denialReason}
            onChange={(e) => setDenialReason(e.target.value)}
            disabled={saving}
          />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          className="btn-primary px-4 py-2 disabled:opacity-50"
          disabled={saving}
          onClick={async () => {
            const plannedIso = toIsoFromLocalInput(managerPlannedStart);
            const startedIso = toIsoFromLocalInput(managerStartedAt);
            if (!plannedIso || !startedIso) return;
            await onApprove({ managerPlannedStartAt: plannedIso, managerStartedAt: startedIso });
          }}
        >
          {saving ? "Saving..." : "Approve & Start Shift"}
        </button>
        {!showDeny ? (
          <button
            className="btn-secondary px-4 py-2"
            disabled={saving}
            onClick={() => setShowDeny(true)}
          >
            Deny
          </button>
        ) : (
          <>
            <button
              className="btn-secondary px-4 py-2"
              disabled={saving}
              onClick={async () => {
                await onDeny(denialReason);
              }}
            >
              Confirm Deny
            </button>
            <button
              className="btn-secondary px-4 py-2"
              disabled={saving}
              onClick={() => {
                setShowDeny(false);
                setDenialReason("");
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
