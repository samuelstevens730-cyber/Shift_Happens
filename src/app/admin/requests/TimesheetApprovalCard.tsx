"use client";

import { useState } from "react";

type TimesheetRequest = {
  id: string;
  shift_id: string;
  store_id: string;
  requester_profile_id: string;
  requested_started_at: string | null;
  requested_ended_at: string | null;
  original_started_at: string;
  original_ended_at: string | null;
  reason: string;
  status: string;
  created_at: string;
};

type Props = {
  requests: TimesheetRequest[];
  token: string;
  onRefresh: () => void;
};

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function TimesheetApprovalCard({ requests, token, onRefresh }: Props) {
  const pending = requests.filter(r => r.status === "pending");
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    if (!window.confirm("Approve this timesheet correction?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/requests/timesheet/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to approve timesheet.");
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
      const res = await fetch(`/api/requests/timesheet/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to deny timesheet.");
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
        <h2 className="text-lg font-semibold">Timesheet Approvals</h2>
        <p className="text-sm muted">Pending correction requests.</p>
      </div>

      {error && <div className="banner banner-error text-sm">{error}</div>}

      {pending.length === 0 && <div className="text-sm muted">No pending timesheet requests.</div>}
      <div className="space-y-3">
        {pending.map(req => (
          <div key={req.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Request {req.id}</div>
              <div className="text-xs muted">{formatDateTime(req.created_at)}</div>
            </div>
            <div className="text-xs muted">Employee: {req.requester_profile_id}</div>
            <div className="text-xs muted">Shift: {req.shift_id}</div>
            <div className="text-sm">
              <div>Original: {formatDateTime(req.original_started_at)} → {formatDateTime(req.original_ended_at)}</div>
              <div>Requested: {formatDateTime(req.requested_started_at)} → {formatDateTime(req.requested_ended_at)}</div>
            </div>
            <div className="text-sm">{req.reason}</div>
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
