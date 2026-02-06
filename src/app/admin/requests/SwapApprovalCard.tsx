"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SwapRequest = {
  id: string;
  schedule_shift_id: string;
  store_id: string;
  requester_profile_id: string;
  reason: string | null;
  status: string;
  created_at: string;
  expires_at: string;
};

type ScheduleShift = {
  id: string;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
  shift_type: string;
  store_id: string;
};

type Props = {
  requests: SwapRequest[];
  token: string;
  onRefresh: () => void;
};

function formatDate(value: string) {
  const dt = new Date(`${value}T00:00:00`);
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
  const [shiftMap, setShiftMap] = useState<Record<string, ScheduleShift>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const ids = Array.from(new Set(pending.map(r => r.schedule_shift_id)));
    if (ids.length === 0) {
      setShiftMap({});
      return;
    }
    (async () => {
      const { data, error: shiftErr } = await supabase
        .from("schedule_shifts")
        .select("id, shift_date, scheduled_start, scheduled_end, shift_type, store_id")
        .in("id", ids)
        .returns<ScheduleShift[]>();
      if (!alive) return;
      if (shiftErr) {
        setError(shiftErr.message);
        return;
      }
      const map: Record<string, ScheduleShift> = {};
      (data ?? []).forEach(s => { map[s.id] = s; });
      setShiftMap(map);
    })();
    return () => { alive = false; };
  }, [pending]);

  const handleApprove = async (id: string) => {
    if (!window.confirm("Approve this swap request?")) return;
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
  };

  const handleDeny = async (id: string) => {
    const reason = window.prompt("Optional denial reason:", "");
    if (reason === null) return;
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
          const shift = shiftMap[req.schedule_shift_id];
          return (
            <div key={req.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Request {req.id}</div>
                <div className="text-xs muted">Expires {formatDate(req.expires_at)}</div>
              </div>
              <div className="text-xs muted">Requester: {req.requester_profile_id}</div>
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
