"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function toLocalInputValue(d = new Date()) {
  // Format for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}


type Membership = { store_id: string; role: "owner" | "manager" | "clerk" };

export default function ClockPage() {
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [role, setRole] = useState<Membership["role"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [showClockIn, setShowClockIn] = useState(false);
  const [startLocal, setStartLocal] = useState(toLocalInputValue());
  const router = useRouter();

  // Pull memberships on mount
  useEffect(() => {
  let alive = true;
  (async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace("/login"); return; }

    const { data, error } = await supabase
      .from("store_memberships")
      .select("store_id, role")
      .order("store_id");

    if (!alive) return;

    if (error) { setError(error.message); setLoading(false); return; }

    setMemberships((data || []) as Membership[]);
    const last = localStorage.getItem("sh_store");
    const first = (data && data[0]?.store_id) || "";
    const pick = last && data?.some(m => m.store_id === last) ? last : first;
    setSelectedStore(pick);
    if (pick) {
      const foundRole = (data?.find(m => m.store_id === pick)?.role ?? null) as Membership["role"] | null;
      setRole(foundRole);
    }
    setLoading(false);
  })();
  return () => { alive = false; };
}, [router]);

  // When store changes, update role
  useEffect(() => {
    if (!selectedStore) return;
    const r = memberships.find(m => m.store_id === selectedStore)?.role ?? null;
    setRole(r as Membership["role"] | null);
    localStorage.setItem("sh_store", selectedStore);
  }, [selectedStore, memberships]);

  const canClockIn = useMemo(() => !!selectedStore && !!role && !loading, [selectedStore, role, loading]);

async function handleClockInManual(localValue: string) {
  setError(null);
  setLoading(true);
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");
    if (!selectedStore || !role) throw new Error("Pick a store first.");
    if (!localValue) throw new Error("Pick a start time.");

    const d = new Date(localValue);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid date/time.");
    const now = new Date();
    if (d.getTime() > now.getTime() + 60_000) {
      throw new Error("Start time cannot be in the future.");
    }

    const iso = d.toISOString();

    const { data: newShiftId, error: rpcErr } = await supabase.rpc("create_shift_manual", {
      p_store_id: selectedStore,
      p_start_at: iso,
    });
    if (rpcErr) throw rpcErr;
    if (!newShiftId || typeof newShiftId !== "string") {
      throw new Error("Server did not return a shift id.");
    }

    const startHour = d.getHours();
    const isOpening = startHour >= 9 && startHour < 13;

    if (isOpening) {
      const { data: lists, error: listErr } = await supabase
        .from("checklists")
        .select("id")
        .eq("store_id", selectedStore)
        .eq("applies_to_role", role)
        .eq("kind", "opening");
      if (listErr) throw listErr;

      if (lists?.length) {
        const payload = lists.map(l => ({ checklist_id: l.id, shift_id: newShiftId, store_id: selectedStore }));
        const { error: runErr } = await supabase.from("checklist_runs").insert(payload);
        if (runErr) throw runErr;
      }

      setShiftId(newShiftId);
      setShowClockIn(false);
    } else {
      router.replace(`/shift/${newShiftId}`);
    }
  } catch (e: unknown) {
    setError(e instanceof Error ? e.message : "Clock-in failed.");
  } finally {
    setLoading(false);
  }
}

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Clock In</h1>

        {error && <div className="text-red-600 text-sm border border-red-300 rounded p-3">{error}</div>}

        <label className="block text-sm font-medium">Store</label>
        <select
          className="w-full border rounded p-2"
          value={selectedStore}
          onChange={(e) => setSelectedStore(e.target.value)}
        >
          {memberships.map(m => (
            <option key={m.store_id} value={m.store_id}>{m.store_id}</option>
          ))}
        </select>

        <div className="text-sm text-gray-600">
          Role in this store: <b>{role ?? "unknown"}</b>
        </div>

       {shiftId ? (
  <div className="space-y-3 border rounded p-3">
    <div className="text-sm">You’re clocked in for <b>{selectedStore}</b>.</div>
    <button onClick={() => router.push(`/run/${shiftId}`)} className="w-full rounded bg-black text-white py-2">
      Start Opening Checklist
    </button>
  </div>
) : (
  <>
    <button
      onClick={() => { setStartLocal(toLocalInputValue()); setShowClockIn(true); }}
      disabled={!canClockIn}
      className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
    >
      Clock In
    </button>

    {showClockIn && (
      <div className="fixed inset-0 bg-black/40 grid place-items-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-4 space-y-3">
          <h2 className="text-lg font-semibold">Clock In</h2>
          <label className="text-sm">Start time</label>
          <input
            type="datetime-local"
            className="w-full border rounded p-2"
            value={startLocal}
            onChange={e => setStartLocal(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-1.5 rounded border" onClick={() => setShowClockIn(false)}>Cancel</button>
            <button
              className="px-3 py-1.5 rounded bg-black text-white"
              onClick={() => handleClockInManual(startLocal)}
            >
              Start Shift
            </button>
          </div>
        </div>
      </div>
    )}
  </>
)}

        {shiftId && <p className="text-sm">Shift: {shiftId}</p>}
      </div>
    </div>
  );
}

