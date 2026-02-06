"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequestMutations } from "@/hooks/useRequestMutations";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";

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

type ScheduleShiftOption = {
  id: string;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
  stores?: { name: string }[] | null;
};

function formatDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateKey(value: string) {
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

export default function SwapRequestCard({ requests, onRefresh }: Props) {
  const { loading, submitSwapRequest } = useRequestMutations();
  const [showForm, setShowForm] = useState(false);
  const [scheduleShiftId, setScheduleShiftId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresHours, setExpiresHours] = useState<string>("48");
  const [error, setError] = useState<string | null>(null);
  const [shiftOptions, setShiftOptions] = useState<ScheduleShiftOption[]>([]);
  const [shiftError, setShiftError] = useState<string | null>(null);

  const openRequests = requests.filter(r => r.status === "open" || r.status === "pending");

  const shiftLabelById = useMemo(() => {
    const map = new Map<string, string>();
    shiftOptions.forEach(s => {
      const store = s.stores?.[0]?.name ?? "Store";
      const label = `${formatDateKey(s.shift_date)} · ${formatTime(s.scheduled_start)}-${formatTime(
        s.scheduled_end
      )} · ${store}`;
      map.set(s.id, label);
    });
    return map;
  }, [shiftOptions]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setShiftError(null);
      const pinToken = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_token") : null;
      const profileId = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_profile_id") : null;

      const client = pinToken ? createEmployeeSupabase(pinToken) : supabase;
      if (!profileId) return;

      const today = new Date();
      const todayKey = today.toISOString().slice(0, 10);

      const { data, error: shiftErr } = await client
        .from("schedule_shifts")
        .select("id, shift_date, scheduled_start, scheduled_end, stores(name), schedules!inner(status)")
        .eq("profile_id", profileId)
        .eq("schedules.status", "published")
        .gte("shift_date", todayKey)
        .order("shift_date", { ascending: true });

      if (!alive) return;
      if (shiftErr) {
        setShiftError(shiftErr.message);
        return;
      }
      setShiftOptions((data ?? []) as ScheduleShiftOption[]);
      if (!scheduleShiftId && data && data.length > 0) {
        setScheduleShiftId(data[0].id);
      }
    })();
    return () => { alive = false; };
  }, []);

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
            <label className="text-sm muted">Select Shift</label>
            <select
              className="select"
              value={scheduleShiftId}
              onChange={(e) => setScheduleShiftId(e.target.value)}
            >
              {shiftOptions.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shiftLabelById.get(shift.id)}
                </option>
              ))}
            </select>
            {shiftError && <div className="text-xs text-red-300">{shiftError}</div>}
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
            <div className="text-xs muted">Shift: {shiftLabelById.get(req.schedule_shift_id) ?? "Scheduled shift"}</div>
            {req.reason && <div className="text-sm">{req.reason}</div>}
            <div className="text-xs muted">Created {formatDate(req.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
