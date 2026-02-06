"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequestMutations } from "@/hooks/useRequestMutations";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";

type TimeOffBlock = {
  id: string;
  start_date: string;
  end_date: string;
  created_at: string;
};

type Props = {
  blocks: TimeOffBlock[];
  onRefresh: () => void;
};

type StoreOption = { id: string; name: string };

function formatDate(value: string) {
  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TimeOffRequestForm({ blocks, onRefresh }: Props) {
  const { loading, submitTimeOffRequest } = useRequestMutations();
  const [storeId, setStoreId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storesError, setStoresError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const pinToken = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_token") : null;
      let profileId = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_profile_id") : null;
      const client = pinToken ? createEmployeeSupabase(pinToken) : supabase;

      if (!profileId) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("auth_user_id", userData.user.id)
            .maybeSingle();
          profileId = profile?.id ?? null;
        }
      }
      if (!profileId) return;

      const { data: memberships, error: memErr } = await client
        .from("store_memberships")
        .select("store_id")
        .eq("profile_id", profileId);

      if (!alive) return;
      if (memErr) {
        setStoresError(memErr.message);
        return;
      }

      const storeIds = (memberships ?? []).map(m => m.store_id);
      if (storeIds.length === 0) {
        setStores([]);
        return;
      }

      const { data: storeRows, error: storeErr } = await client
        .from("stores")
        .select("id, name")
        .in("id", storeIds)
        .order("name", { ascending: true });

      if (!alive) return;
      if (storeErr) {
        setStoresError(storeErr.message);
        return;
      }

      setStores(storeRows ?? []);
      if (storeRows && storeRows.length > 0) {
        const storedStoreId = typeof window !== "undefined" ? sessionStorage.getItem("sh_pin_store_id") : null;
        if (storedStoreId && storeRows.find(s => s.id === storedStoreId)) {
          setStoreId(storedStoreId);
        } else if (!storeId) {
          setStoreId(storeRows[0].id);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  const upcomingBlocks = useMemo(() => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    return blocks.filter(b => b.end_date >= todayKey);
  }, [blocks]);

  const handleSubmit = async () => {
    setError(null);
    setConflictError(null);
    const res = await submitTimeOffRequest({
      storeId,
      startDate,
      endDate,
      reason: reason || null,
    });
    if (!res.ok) {
      if (res.status === 409) {
        setConflictError(res.error ?? "Time off request conflicts with a published shift.");
      } else {
        setError(res.error ?? "Failed to submit time off request.");
      }
      return;
    }
    setStartDate("");
    setEndDate("");
    setReason("");
    onRefresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="card card-pad space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Request Time Off</h2>
          <p className="text-sm muted">Requests are checked against published schedules.</p>
        </div>

        {conflictError && <div className="banner banner-error text-sm">{conflictError}</div>}
        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="space-y-1">
          <label className="text-sm muted">Store</label>
          <select
            className="select"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            {stores.map(store => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
          {storesError && <div className="text-xs text-red-300">{storesError}</div>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm muted">Start Date</label>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm muted">End Date</label>
            <input
              className="input"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm muted">Reason (optional)</label>
          <textarea
            className="textarea"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional details"
          />
        </div>
        <button
          className="btn-primary w-full"
          onClick={handleSubmit}
          disabled={loading || !storeId || !startDate || !endDate}
        >
          {loading ? "Submitting..." : "Submit Time Off Request"}
        </button>
      </div>

      <div className="card card-pad space-y-3">
        <div>
          <h3 className="text-base font-semibold">Upcoming Blocks</h3>
          <p className="text-xs muted">Approved or manager-added blocks.</p>
        </div>
        {upcomingBlocks.length === 0 && (
          <div className="text-sm muted">No upcoming time off blocks.</div>
        )}
        {upcomingBlocks.map(block => (
          <div key={block.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
            <div className="font-semibold">
              {formatDate(block.start_date)} - {formatDate(block.end_date)}
            </div>
            <div className="text-xs muted">Created {formatDate(block.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
