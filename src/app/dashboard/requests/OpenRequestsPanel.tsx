"use client";

import { useEffect, useMemo, useState } from "react";
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

type OfferRow = {
  id: string;
  request_id: string;
  offerer_profile_id: string;
  offer_type: "cover" | "swap";
  swap_schedule_shift_id: string | null;
  is_selected: boolean;
  is_withdrawn: boolean;
  note: string | null;
  created_at: string;
  offerer?: { name: string | null } | null;
};

type ScheduleShiftOption = {
  id: string;
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
  stores?: { name: string }[] | null;
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

async function getAuthToken(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const pinToken = sessionStorage.getItem("sh_pin_token");
    if (pinToken) return pinToken;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function OpenRequestsPanel({ requests, onRefresh }: Props) {
  const [offersByRequest, setOffersByRequest] = useState<Record<string, OfferRow[]>>({});
  const [shiftOptions, setShiftOptions] = useState<Record<string, ScheduleShiftOption>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openRequests = useMemo(
    () => requests.filter(r => r.status === "open"),
    [requests]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setError(null);
      const pinToken = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_token") : null;
      const client = pinToken ? createEmployeeSupabase(pinToken) : supabase;
      const ids = Array.from(new Set(openRequests.map(r => r.schedule_shift_id)));
      if (ids.length === 0) {
        setShiftOptions({});
        return;
      }
      const { data, error: shiftErr } = await client
        .from("schedule_shifts")
        .select("id, shift_date, scheduled_start, scheduled_end, stores(name)")
        .in("id", ids);
      if (!alive) return;
      if (shiftErr) {
        setError(shiftErr.message);
        return;
      }
      const map: Record<string, ScheduleShiftOption> = {};
      (data ?? []).forEach((s) => { map[s.id] = s as ScheduleShiftOption; });
      setShiftOptions(map);
    })();
    return () => { alive = false; };
  }, [openRequests]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      const pairs = await Promise.all(
        openRequests.map(async (req) => {
          const res = await fetch(`/api/requests/shift-swap/${req.id}/offers`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json?.error ?? "Failed to load offers.");
          }
          return [req.id, (json?.rows ?? []) as OfferRow[]] as const;
        })
      );
      if (!alive) return;
      const map: Record<string, OfferRow[]> = {};
      pairs.forEach(([id, rows]) => { map[id] = rows; });
      setOffersByRequest(map);
    })().catch((err: Error) => {
      if (!alive) return;
      setError(err.message);
    });
    return () => { alive = false; };
  }, [openRequests]);

  const handleAccept = async (requestId: string, offerId: string) => {
    setError(null);
    setLoadingId(offerId);
    const token = await getAuthToken();
    if (!token) {
      setError("Unauthorized.");
      setLoadingId(null);
      return;
    }
    const res = await fetch(`/api/requests/shift-swap/${requestId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ offerId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error ?? "Failed to accept offer.");
      setLoadingId(null);
      return;
    }
    setLoadingId(null);
    onRefresh();
  };

  const handleDeny = async (requestId: string, offerId: string) => {
    setError(null);
    setLoadingId(offerId);
    const token = await getAuthToken();
    if (!token) {
      setError("Unauthorized.");
      setLoadingId(null);
      return;
    }
    const res = await fetch(`/api/requests/shift-swap/${requestId}/offers/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ offerId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error ?? "Failed to deny offer.");
      setLoadingId(null);
      return;
    }
    setLoadingId(null);
    onRefresh();
  };

  const shiftLabelById = useMemo(() => {
    const map = new Map<string, string>();
    Object.values(shiftOptions).forEach(s => {
      const store = s.stores?.[0]?.name ?? "Store";
      const label = `${formatDateKey(s.shift_date)} · ${formatTime(s.scheduled_start)}-${formatTime(
        s.scheduled_end
      )} · ${store}`;
      map.set(s.id, label);
    });
    return map;
  }, [shiftOptions]);

  if (openRequests.length === 0) {
    return <div className="text-sm muted">No open swap requests.</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="banner banner-error text-sm">{error}</div>}
      {openRequests.map((req) => {
        const offers = (offersByRequest[req.id] ?? []).filter(o => !o.is_withdrawn);
        const shiftLabel = shiftLabelById.get(req.schedule_shift_id) ?? "Scheduled shift";
        return (
          <div key={req.id} className="card card-pad space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Your Swap Request</div>
                <div className="text-xs muted">{shiftLabel}</div>
              </div>
              <div className="text-xs muted">Expires {formatDate(req.expires_at)}</div>
            </div>
            {req.reason && <div className="text-sm">{req.reason}</div>}
            <div className="text-xs muted">Created {formatDate(req.created_at)}</div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Offers</div>
              {offers.length === 0 && <div className="text-sm muted">No offers yet.</div>}
              {offers.map((offer) => (
                <div key={offer.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      {offer.offerer?.name ?? "Employee"} · {offer.offer_type.toUpperCase()}
                    </div>
                    <div className="text-xs muted">{formatDate(offer.created_at)}</div>
                  </div>
                  {offer.note && <div className="text-sm muted">{offer.note}</div>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-primary px-4 py-2 text-sm"
                      onClick={() => handleAccept(req.id, offer.id)}
                      disabled={loadingId === offer.id}
                    >
                      {loadingId === offer.id ? "Submitting..." : "Accept"}
                    </button>
                    <button
                      className="btn-secondary px-4 py-2 text-sm"
                      onClick={() => handleDeny(req.id, offer.id)}
                      disabled={loadingId === offer.id}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
