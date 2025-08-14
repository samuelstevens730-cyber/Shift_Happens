"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { toLocalInputValue } from "@/lib/date";

const CHECKLISTS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_CHECKLISTS === "true";

type OpenShiftRow = { id: string; user_id: string; store_id: string; start_at: string };
type Membership = { store_id: string; role: "owner" | "manager" | "clerk" };

// Narrow unknown -> OpenShiftRow[] without using `any` or fragile rpc generics
function isOpenShiftRowArray(data: unknown): data is OpenShiftRow[] {
  return Array.isArray(data) && data.every((r) => {
    if (!r || typeof r !== "object") return false;
    const obj = r as Record<string, unknown>;
    return typeof obj.id === "string"
      && typeof obj.store_id === "string"
      && typeof obj.start_at === "string";
  });
}

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

  // Pull memberships and detect any open shift on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }

      // Fetch in parallel: open shift + memberships
      const [openRes, memRes] = await Promise.all([
        supabase.rpc("get_open_shift_for_me"),
        supabase.from("store_memberships").select("store_id, role").order("store_id"),
      ]);

      if (!alive) return;

      const openErr = openRes.error;
      const openRows: OpenShiftRow[] = isOpenShiftRowArray(openRes.data) ? openRes.data : [];
      const openRow: OpenShiftRow | null = openRows[0] ?? null;

      const memErr = memRes.error;
      const memData = (memRes.data || []) as Membership[];

      if (memErr) {
        setError(memErr.message);
        setLoading(false);
        return;
      }

      setMemberships(memData);

      if (openErr) {
        // not fatal; just log it so we don’t fail the whole mount
        console.warn("get_open_shift_for_me error:", openErr);
      }
      if (openRow?.id) {
        setShiftId(openRow.id);
      }

      // Preselect store: 1) open shift store 2) saved store if still valid 3) first membership
      const last = typeof window !== "undefined" ? localStorage.getItem("sh_store") : null;
      const first = memData[0]?.store_id || "";
      const pick =
        openRow?.store_id ||
        (last && memData.some(m => m.store_id === last) ? last : first);

      setSelectedStore(pick);
      // role is derived when selectedStore changes

      setLoading(false);
    })();

    return () => { alive = false; };
  }, [router]);

// Auto-resume on tab focus / when the tab becomes visible
useEffect(() => {
  let alive = true;

  async function checkOpenShift() {
    try {
      const { data } = await supabase.rpc("get_open_shift_for_me");
      if (!alive) return;
      const rows = isOpenShiftRowArray(data) ? data : [];
      const row = rows[0] ?? null;
      if (row?.id) {
        setShiftId(row.id);
        // prefer the open shift's store, but don't clobber if user already picked one
        setSelectedStore(prev => prev || row.store_id);
      }
    } catch {
      // silence is golden; this is a best-effort check
    }
  }

  const onFocus = () => { void checkOpenShift(); };
  const onVisible = () => {
    if (document.visibilityState === "visible") void checkOpenShift();
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    alive = false;
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
  };
}, []);

  // When store changes, update role
  useEffect(() => {
    if (!selectedStore) return;
    const r = memberships.find(m => m.store_id === selectedStore)?.role ?? null;
    setRole(r as Membership["role"] | null);
    if (typeof window !== "undefined") {
      localStorage.setItem("sh_store", selectedStore);
    }
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

      // Friendly guard: if an open shift exists, resume it instead of creating a duplicate
      {
        const openCheck = await supabase.rpc("get_open_shift_for_me");
        const openRows: OpenShiftRow[] = isOpenShiftRowArray(openCheck.data) ? openCheck.data : [];
        const open = openRows[0] ?? null;
        if (open?.id) {
          setShiftId(open.id);
          setShowClockIn(false);
          setLoading(false);
          return;
        }
      }

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
        if (CHECKLISTS_ENABLED) {
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
            <button
              onClick={() => router.push(`/run/${shiftId}?store=${selectedStore}&role=${role}`)}
              className="w-full rounded bg-black text-white py-2"
            >
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
