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

type OpenSwapRequest = {
  id: string;
  schedule_shift_id: string;
  requester_profile_id: string;
  requester?: { id: string; name: string | null } | null;
  schedule_shift?: {
    id: string;
    shift_date: string;
    scheduled_start: string;
    scheduled_end: string;
    stores?: { name: string }[] | null;
  } | null;
  reason: string | null;
  status: string;
  expires_at: string;
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
  const [openSwaps, setOpenSwaps] = useState<OpenSwapRequest[]>([]);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerLoading, setOfferLoading] = useState<string | null>(null);
  const [offerTypeById, setOfferTypeById] = useState<Record<string, "cover" | "swap">>({});
  const [offerShiftById, setOfferShiftById] = useState<Record<string, string>>({});

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

  const fetchOpenSwaps = async () => {
    setOfferError(null);
    const pinToken = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_token") : null;
    const token = pinToken ?? (await supabase.auth.getSession()).data.session?.access_token ?? null;
    if (!token) return;
    const res = await fetch("/api/requests/shift-swap/open", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) {
      setOfferError(json?.error ?? "Failed to load open swaps.");
      return;
    }
    setOpenSwaps(json?.rows ?? []);
  };

  useEffect(() => {
    fetchOpenSwaps();
  }, []);

  const handleOffer = async (req: OpenSwapRequest) => {
    const type = offerTypeById[req.id] ?? "cover";
    const swapShiftId = offerShiftById[req.id];
    if (type === "swap" && !swapShiftId) {
      setOfferError("Select a shift to swap.");
      return;
    }
    setOfferLoading(req.id);
    setOfferError(null);
    const pinToken = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_token") : null;
    const token = pinToken ?? (await supabase.auth.getSession()).data.session?.access_token ?? null;
    if (!token) {
      setOfferError("Unauthorized.");
      setOfferLoading(null);
      return;
    }
    const res = await fetch(`/api/requests/shift-swap/${req.id}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        offerType: type,
        swapScheduleShiftId: type === "swap" ? swapShiftId : null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setOfferError(json?.error ?? "Failed to submit offer.");
      setOfferLoading(null);
      return;
    }
    setOfferLoading(null);
    fetchOpenSwaps();
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

      <div className="border-t border-white/10 pt-4 space-y-3">
        <div>
          <h3 className="text-base font-semibold">Cover or Swap</h3>
          <p className="text-sm muted">Offer to cover another employee’s shift or swap one of yours.</p>
        </div>
        {offerError && <div className="banner banner-error text-sm">{offerError}</div>}
        {openSwaps.length === 0 && <div className="text-sm muted">No open swap requests from others.</div>}
        <div className="space-y-3">
          {openSwaps.map(req => {
            const shift = req.schedule_shift;
            const shiftLabel = shift
              ? `${formatDateKey(shift.shift_date)} · ${formatTime(shift.scheduled_start)}-${formatTime(shift.scheduled_end)} · ${shift.stores?.[0]?.name ?? "Store"}`
              : "Scheduled shift";
            const requesterName = req.requester?.name ?? "Employee";
            const offerType = offerTypeById[req.id] ?? "cover";
            return (
              <div key={req.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{requesterName}</div>
                  <div className="text-xs muted">Expires {formatDate(req.expires_at)}</div>
                </div>
                <div className="text-sm">{shiftLabel}</div>
                {req.reason && <div className="text-sm muted">{req.reason}</div>}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs muted">Offer Type</label>
                  <select
                    className="select"
                    value={offerType}
                    onChange={(e) =>
                      setOfferTypeById(prev => ({ ...prev, [req.id]: e.target.value as "cover" | "swap" }))
                    }
                  >
                    <option value="cover">Cover</option>
                    <option value="swap">Swap</option>
                  </select>
                </div>
                {offerType === "swap" && (
                  <div className="space-y-1">
                    <label className="text-xs muted">Select Your Shift</label>
                    <select
                      className="select"
                      value={offerShiftById[req.id] ?? ""}
                      onChange={(e) => setOfferShiftById(prev => ({ ...prev, [req.id]: e.target.value }))}
                    >
                      <option value="">Choose shift</option>
                      {shiftOptions.map(shiftOpt => (
                        <option key={shiftOpt.id} value={shiftOpt.id}>
                          {shiftLabelById.get(shiftOpt.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  className="btn-primary w-full"
                  onClick={() => handleOffer(req)}
                  disabled={offerLoading === req.id}
                >
                  {offerLoading === req.id ? "Submitting..." : "Submit Offer"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
