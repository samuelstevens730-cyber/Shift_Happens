// src/app/clock/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };
type Profile = { id: string; name: string; active: boolean };

type ShiftKind = "open" | "close" | "double" | "other";

function toLocalInputValue(d = new Date()) {
  // yyyy-MM-ddTHH:mm for datetime-local
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

function roundTo30Minutes(d: Date) {
  const ms = d.getTime();
  const mins = d.getMinutes();
  const rounded = mins < 15 ? 0 : mins < 45 ? 30 : 60;
  const nd = new Date(ms);
  nd.setMinutes(rounded, 0, 0);
  if (rounded === 60) nd.setHours(nd.getHours() + 1);
  return nd;
}

function withinThreshold(amountDollars: number) {
  // Under by > $5 (below 195) OR Over by > $15 (above 215) requires confirm
  return amountDollars >= 195 && amountDollars <= 215;
}

function thresholdMessage(amountDollars: number) {
  if (amountDollars < 195) return "Drawer is UNDER by more than $5. Confirm count + notify manager.";
  if (amountDollars > 215) return "Drawer is OVER by more than $15. Confirm count + notify manager.";
  return null;
}

export default function ClockPage() {
  const router = useRouter();
  const search = useSearchParams();
  const qrToken = search.get("t") || "";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [shiftKind, setShiftKind] = useState<ShiftKind>("open");

  const [plannedStartLocal, setPlannedStartLocal] = useState(() =>
    toLocalInputValue(roundTo30Minutes(new Date()))
  );

  // Start drawer count (optional for "other" per your rules)
  const [startDrawer, setStartDrawer] = useState<string>("200");
  const [startConfirmThreshold, setStartConfirmThreshold] = useState(false);

  const requiresStartDrawer = shiftKind !== "other";

  const thresholdMsg = useMemo(() => {
    const amt = Number(startDrawer);
    if (!requiresStartDrawer) return null;
    if (Number.isNaN(amt)) return "Enter a valid drawer amount.";
    return thresholdMessage(amt);
  }, [startDrawer, requiresStartDrawer]);

  const canStart = useMemo(() => {
    if (!qrToken) return false;

    if (!storeId || !profileId || !plannedStartLocal) return false;

    const plannedMs = new Date(plannedStartLocal).getTime();
    if (Number.isNaN(plannedMs)) return false;

    if (!requiresStartDrawer) return true;

    const amt = Number(startDrawer);
    if (Number.isNaN(amt) || amt < 0) return false;

    // If outside threshold, user must explicitly confirm.
    if (!withinThreshold(amt) && !startConfirmThreshold) return false;

    return true;
  }, [
    qrToken,
    storeId,
    profileId,
    plannedStartLocal,
    requiresStartDrawer,
    startDrawer,
    startConfirmThreshold,
  ]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: storeData, error: storeErr } = await supabase
          .from("stores")
          .select("id, name")
          .order("name", { ascending: true });

        if (!alive) return;
        if (storeErr) throw storeErr;

        const { data: profileData, error: profErr } = await supabase
          .from("profiles")
          .select("id, name, active")
          .order("name", { ascending: true });

        if (!alive) return;
        if (profErr) throw profErr;

        const filteredProfiles = (profileData || []).filter((p: any) => p.active !== false);

        setStores((storeData || []) as Store[]);
        setProfiles((filteredProfiles || []) as Profile[]);

        // Restore last selections if still valid
        const lastStore = localStorage.getItem("sh_store") || "";
        const lastProfile = localStorage.getItem("sh_profile") || "";

        const storeOk = (storeData || []).some(s => s.id === lastStore);
        const profileOk = (filteredProfiles || []).some(p => p.id === lastProfile);

        setStoreId(storeOk ? lastStore : (storeData?.[0]?.id ?? ""));
        setProfileId(profileOk ? lastProfile : (filteredProfiles?.[0]?.id ?? ""));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load stores/profiles.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (storeId) localStorage.setItem("sh_store", storeId);
  }, [storeId]);

  useEffect(() => {
    if (profileId) localStorage.setItem("sh_profile", profileId);
  }, [profileId]);

  async function startShift() {
    setError(null);

    if (!qrToken) {
      setError("Missing QR token in URL (?t=...). Scan the store QR code.");
      return;
    }

    const planned = new Date(plannedStartLocal);
    if (Number.isNaN(planned.getTime())) {
      setError("Invalid planned start date/time.");
      return;
    }

    // Round planned start to nearest 30 minutes (enforces your rule even if user edits weirdly)
    const roundedPlanned = roundTo30Minutes(planned);

    let startDrawerCents: number | null = null;
    let confirmed = false;

    if (requiresStartDrawer) {
      const amt = Number(startDrawer);
      if (Number.isNaN(amt) || amt < 0) {
        setError("Enter a valid starting drawer amount.");
        return;
      }
      startDrawerCents = Math.round(amt * 100);

      // Confirm only matters when outside threshold; inside threshold we keep it false.
      confirmed = !withinThreshold(amt) ? Boolean(startConfirmThreshold) : false;

      if (!withinThreshold(amt) && !confirmed) {
        setError("Drawer is outside threshold. Check the confirm box to proceed.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/start-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrToken,
          storeId,
          profileId,
          shiftType: shiftKind,
          plannedStartAt: roundedPlanned.toISOString(),
          startDrawerCents, // null allowed for "other"
          confirmed,
          notifiedManager: false,
          note: null,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to start shift.");

      const shiftId = json.shiftId as string;
      if (!shiftId) throw new Error("API did not return shiftId.");

      const base =
        shiftKind === "open" || shiftKind === "double" ? `/run/${shiftId}` : `/shift/${shiftId}`;

      router.replace(`${base}?t=${encodeURIComponent(qrToken)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start shift.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Clock In</h1>

        {!qrToken && (
          <div className="text-sm border border-amber-300 text-amber-800 rounded p-3">
            Missing QR token. Use the store QR code so the URL includes <b>?t=...</b>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 border border-red-300 rounded p-3">{error}</div>
        )}

        <div className="space-y-2">
          <label className="text-sm">Store</label>
          <select
            className="w-full border rounded p-2"
            value={storeId}
            onChange={e => setStoreId(e.target.value)}
          >
            {stores.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm">Employee</label>
          <select
            className="w-full border rounded p-2"
            value={profileId}
            onChange={e => setProfileId(e.target.value)}
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm">Shift type</label>
          <select
            className="w-full border rounded p-2"
            value={shiftKind}
            onChange={e => {
              const next = e.target.value as ShiftKind;
              setShiftKind(next);
              // Reset confirm when switching types
              setStartConfirmThreshold(false);
            }}
          >
            <option value="open">Open</option>
            <option value="close">Close</option>
            <option value="double">Double</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm">Planned start time</label>
          <input
            type="datetime-local"
            className="w-full border rounded p-2"
            value={plannedStartLocal}
            onChange={e => setPlannedStartLocal(e.target.value)}
          />
          <div className="text-xs text-gray-500">Rounded to 30 minutes on submit.</div>
        </div>

        <div className="space-y-2">
          <label className="text-sm">
            Beginning drawer count ($){requiresStartDrawer ? "" : " (optional)"}
          </label>
          <input
            className="w-full border rounded p-2"
            inputMode="decimal"
            value={startDrawer}
            onChange={e => setStartDrawer(e.target.value)}
            disabled={!requiresStartDrawer && submitting}
          />

          {requiresStartDrawer && thresholdMsg && (
            <div className="text-sm border rounded p-2 text-amber-700 border-amber-300">
              {thresholdMsg}
            </div>
          )}

          {requiresStartDrawer && !withinThreshold(Number(startDrawer)) && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={startConfirmThreshold}
                onChange={e => setStartConfirmThreshold(e.target.checked)}
              />
              I confirm this count is correct (required if outside threshold)
            </label>
          )}
        </div>

        <button
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
          disabled={!canStart || submitting}
          onClick={startShift}
        >
          {submitting ? "Starting…" : "Start Shift"}
        </button>
      </div>
    </div>
  );
}
