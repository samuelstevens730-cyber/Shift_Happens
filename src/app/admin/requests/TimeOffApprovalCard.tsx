"use client";

import { useState } from "react";

type TimeOffRequest = {
  id: string;
  store_id: string;
  profile_id: string;
  store?: { id: string; name: string | null } | null;
  profile?: { id: string; name: string | null } | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  created_at: string;
};

type Props = {
  requests: TimeOffRequest[];
  token: string;
  onRefresh: () => void;
  highlightRequestId?: string | null;
};

function formatDate(value: string) {
  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TimeOffApprovalCard({ requests, token, onRefresh, highlightRequestId = null }: Props) {
  const pending = requests.filter(r => r.status === "pending");
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (!window.confirm("Approve this time off request?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/requests/time-off/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to approve time off.");
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
      const res = await fetch(`/api/requests/time-off/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to deny time off.");
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
        <h2 className="text-lg font-semibold">Time Off Approvals</h2>
        <p className="text-sm muted">Pending time off requests.</p>
      </div>

      {error && <div className="banner banner-error text-sm">{error}</div>}

      {pending.length === 0 && <div className="text-sm muted">No pending time off requests.</div>}
      <div className="space-y-3">
        {pending.map(req => (
          <div
            key={req.id}
            className={`rounded-lg border bg-white/5 p-3 space-y-2 ${
              highlightRequestId === req.id ? "border-cyan-400/80 ring-1 ring-cyan-400/40" : "border-white/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Request {req.id}</div>
              <div className="text-xs muted">{formatDate(req.start_date)} - {formatDate(req.end_date)}</div>
            </div>
            <div className="text-xs muted">Employee: {req.profile?.name ?? req.profile_id}</div>
            <div className="text-xs muted">Store: {req.store?.name ?? req.store_id}</div>
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
        ))}
      </div>
    </div>
  );
}
