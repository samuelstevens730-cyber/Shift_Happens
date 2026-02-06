"use client";

import { useState } from "react";

type SwapRequest = {
  id: string;
  schedule_shift_id: string;
  store_id: string;
  requester_profile_id: string;
  requester?: { id: string; name: string | null } | null;
  schedule_shift?: {
    id: string;
    shift_date: string;
    scheduled_start: string;
    scheduled_end: string;
    shift_type: string;
    store_id: string;
    stores?: { name: string } | null;
  } | null;
  reason: string | null;
  status: string;
  created_at: string;
  expires_at: string;
};

type Props = {
  requests: SwapRequest[];
  token: string;
  onRefresh: () => void;
};

function formatDate(value: string) {
  const dt = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(value?: string) {
  if (!value) return "--";
  const [h, m] = value.split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return value;
  const minute = (m ?? "00").slice(0, 2);
  const hour12 = ((hour + 11) % 12) + 1;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour12}:${minute} ${suffix}`;
}

export default function SwapApprovalCard({ requests, token, onRefresh }: Props) {
  const pending = requests.filter(r => r.status === "pending");
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (!window.confirm("Approve this swap request?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/requests/shift-swap/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to approve swap.");
        return;
      }
      onRefresh();
    } catch {
      setError("Network error. Please try again.");
    }
  };

  const handleDeny = async (id: string) => {
    const reason = window.prompt("Optional denial reason:", "");
    if (reason === null) return;
    setError(null);
    try {
      const res = await fetch(`/api/requests/shift-swap/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to deny swap.");
        return;
      }
      onRefresh();
    } catch {
      setError("Network error. Please try again.");
    }
  };

  return (
    <div className="card card-pad space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Shift Swap Approvals</h2>
        <p className="text-sm muted">Pending swap requests awaiting approval.</p>
      </div>

      {error && <div className="banner banner-error text-sm">{error}</div>}

      {pending.length === 0 && <div className="text-sm muted">No pending swap requests.</div>}
      <div className="space-y-3">
        {pending.map(req => {
          const shift = req.schedule_shift ?? null;
          const requesterName = req.requester?.name ?? req.requester_profile_id;
          const storeName = shift?.stores?.name ?? shift?.store_id ?? req.store_id;
          return (
            <div key={req.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Request {req.id}</div>
                <div className="text-xs muted">Expires {formatDate(req.expires_at)}</div>
              </div>
              <div className="text-xs muted">Requester: {requesterName}</div>
              <div className="text-xs muted">Store: {storeName}</div>
              <div className="text-sm">
                {shift
                  ? `${formatDate(shift.shift_date)} · ${formatTime(shift.scheduled_start)} - ${formatTime(shift.scheduled_end)}`
                  : `Shift: ${req.schedule_shift_id}`}
              </div>
              {req.reason && <div className="text-sm">{req.reason}</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn-primary px-3 py-2 text-sm" onClick={() => handleApprove(req.id)}>
                  Approve
                </button>
                <button className="btn-secondary px-3 py-2 text-sm" onClick={() => handleDeny(req.id)}>
                  Deny
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
