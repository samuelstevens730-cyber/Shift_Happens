"use client";

import { useState } from "react";
import { useRequestMutations } from "@/hooks/useRequestMutations";

type SwapRequest = {
  id: string;
  schedule_shift_id: string;
  status: string;
  reason: string | null;
  expires_at: string;
  created_at: string;
};

type Props = {
  requests: SwapRequest[];
  onRefresh: () => void;
};

function formatDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SwapRequestCard({ requests, onRefresh }: Props) {
  const { loading, submitSwapRequest } = useRequestMutations();
  const [showForm, setShowForm] = useState(false);
  const [scheduleShiftId, setScheduleShiftId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresHours, setExpiresHours] = useState<string>("48");
  const [error, setError] = useState<string | null>(null);

  const openRequests = requests.filter(r => r.status === "open" || r.status === "pending");

  const handleSubmit = async () => {
    setError(null);
    const hours = expiresHours ? Number(expiresHours) : null;
    const res = await submitSwapRequest({
      scheduleShiftId,
      reason: reason || null,
      expiresHours: Number.isFinite(hours) ? hours : null,
    });
    if (!res.ok) {
      setError(res.error ?? "Failed to submit swap request.");
      return;
    }
    setScheduleShiftId("");
    setReason("");
    setExpiresHours("48");
    setShowForm(false);
    onRefresh();
  };

  return (
    <div className="card card-pad space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Shift Swaps</h2>
          <p className="text-sm muted">Open or pending swap requests.</p>
        </div>
        <button className="btn-secondary px-4 py-2 text-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Close" : "Create"}
        </button>
      </div>

      {showForm && (
        <div className="card card-pad space-y-3 border border-white/10">
          <div className="space-y-1">
            <label className="text-sm muted">Schedule Shift ID</label>
            <input
              className="input"
              value={scheduleShiftId}
              onChange={(e) => setScheduleShiftId(e.target.value)}
              placeholder="UUID of the scheduled shift"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm muted">Reason (optional)</label>
            <textarea
              className="textarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Add context for the swap"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm muted">Expires In (hours)</label>
            <input
              className="input"
              value={expiresHours}
              onChange={(e) => setExpiresHours(e.target.value)}
              placeholder="48"
            />
          </div>
          {error && <div className="banner banner-error text-sm">{error}</div>}
          <button className="btn-primary w-full" onClick={handleSubmit} disabled={loading || !scheduleShiftId}>
            {loading ? "Submitting..." : "Submit Swap Request"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {openRequests.length === 0 && (
          <div className="text-sm muted">No open swap requests.</div>
        )}
        {openRequests.map((req) => (
          <div key={req.id} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">{req.status.toUpperCase()}</div>
              <div className="text-xs muted">Expires {formatDate(req.expires_at)}</div>
            </div>
            <div className="text-xs muted">Shift: {req.schedule_shift_id}</div>
            {req.reason && <div className="text-sm">{req.reason}</div>}
            <div className="text-xs muted">Created {formatDate(req.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
