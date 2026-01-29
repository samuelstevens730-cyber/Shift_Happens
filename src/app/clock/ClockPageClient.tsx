// src/app/clock/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { isOutOfThreshold, thresholdMessage } from "@/lib/kioskRules";

type Store = { id: string; name: string; expected_drawer_cents: number };
type Profile = { id: string; name: string; active: boolean | null };
type ShiftKind = "open" | "close" | "double" | "other";

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

function roundTo30Minutes(d: Date) {
  const nd = new Date(d.getTime());
  const mins = nd.getMinutes();
  const rounded = mins < 15 ? 0 : mins < 45 ? 30 : 60;
  nd.setMinutes(rounded, 0, 0);
  if (rounded === 60) nd.setHours(nd.getHours() + 1);
  return nd;
}

export default function ClockPageClient() {
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

  const [startDrawer, setStartDrawer] = useState<string>("200");
  const [startConfirmThreshold, setStartConfirmThreshold] = useState(false);
  const [startNotifiedManager, setStartNotifiedManager] = useState(false);

  const requiresStartDrawer = shiftKind !== "other";

  const expectedDrawerCents = useMemo(() => {
    const s = stores.find(x => x.id === storeId);
    return s?.expected_drawer_cents ?? 20000; // safe default
  }, [stores, storeId]);

  const parsedStart = useMemo(() => {
    const dollars = Number(startDrawer);
    if (Number.isNaN(dollars) || dollars < 0) return null;
    return Math.round(dollars * 100);
  }, [startDrawer]);

  const startOutOfThreshold = useMemo(() => {
    if (!requiresStartDrawer) return false;
    if (parsedStart == null) return false;
    return isOutOfThreshold(parsedStart, expectedDrawerCents);
  }, [requiresStartDrawer, parsedStart, expectedDrawerCents]);

  const thresholdMsg = useMemo(() => {
    if (!requiresStartDrawer) return null;
    if (parsedStart == null) return "Enter a valid drawer amount.";
    return thresholdMessage(parsedStart, expectedDrawerCents);
  }, [requiresStartDrawer, parsedStart, expectedDrawerCents]);

  const canStart = useMemo(() => {
    if (!storeId || !profileId || !plannedStartLocal) return false;

    const plannedMs = new Date(plannedStartLocal).getTime();
    if (Number.isNaN(plannedMs)) return false;

    if (!requiresStartDrawer) return true;

    if (parsedStart == null) return false;

    // If outside threshold, user must confirm they notified a manager.
    if (startOutOfThreshold && !startNotifiedManager) return false;

    return true;
  }, [
    storeId,
    profileId,
    plannedStartLocal,
    requiresStartDrawer,
    parsedStart,
    startOutOfThreshold,
    startNotifiedManager,
  ]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: storeData, error: storeErr } = await supabase
          .from("stores")
          .select("id, name, expected_drawer_cents")
          .order("name", { ascending: true })
          .returns<Store[]>();

        if (!alive) return;
        if (storeErr) throw storeErr;

        const { data: profileData, error: profErr } = await supabase
          .from("profiles")
          .select("id, name, active")
          .order("name", { ascending: true })
          .returns<Profile[]>();

        if (!alive) return;
        if (profErr) throw profErr;

        const filteredProfiles = (profileData ?? []).filter(p => p.active !== false);

        setStores(storeData ?? []);
        setProfiles(filteredProfiles);

        // Restore last selections if still valid
        const lastStore = localStorage.getItem("sh_store") || "";
        const lastProfile = localStorage.getItem("sh_profile") || "";

        const storeOk = (storeData ?? []).some(s => s.id === lastStore);
        const profileOk = (filteredProfiles ?? []).some(p => p.id === lastProfile);

        const nextStoreId = storeOk ? lastStore : (storeData?.[0]?.id ?? "");
        const nextProfileId = profileOk ? lastProfile : (filteredProfiles?.[0]?.id ?? "");

        setStoreId(nextStoreId);
        setProfileId(nextProfileId);
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

    const planned = new Date(plannedStartLocal);
    if (Number.isNaN(planned.getTime())) {
      setError("Invalid planned start date/time.");
      return;
    }

    const roundedPlanned = roundTo30Minutes(planned);

    let startDrawerCents: number | null = null;
    let confirmed = false;

    if (requiresStartDrawer) {
      if (parsedStart == null) {
        setError("Enter a valid starting drawer amount.");
        return;
      }

      startDrawerCents = parsedStart;

      const out = isOutOfThreshold(parsedStart, expectedDrawerCents);
      confirmed = out ? Boolean(startConfirmThreshold) : false;

      if (out && !startNotifiedManager) {
        setError("Drawer is outside threshold. Notify manager to proceed.");
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
          notifiedManager: startDrawerCents == null ? false : startNotifiedManager,
          note: null,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to start shift.");

      const shiftId = json.shiftId as string;
      if (!shiftId) throw new Error("API did not return shiftId.");

      const base = shiftKind === "open" || shiftKind === "double" ? `/run/${shiftId}` : `/shift/${shiftId}`;
      router.replace(`${base}?t=${encodeURIComponent(qrToken)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start shift.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;

  return (
    <div className="app-shell">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Clock In</h1>
          <span className="text-xs muted">Employee</span>
        </div>

        <div className="card card-pad space-y-4">
          {!qrToken && (
            <div className="banner text-sm">
              QR token missing - manual clock-in is allowed. Select a store and employee to continue.
            </div>
          )}

          {error && (
            <div className="banner banner-error text-sm">{error}</div>
          )}

          <div className="space-y-2">
            <label className="text-sm muted">Store</label>
            <select
              className="select"
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              disabled={submitting}
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm muted">Employee</label>
            <select
              className="select"
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              disabled={submitting}
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm muted">Shift type</label>
            <select
              className="select"
              value={shiftKind}
              onChange={e => {
                const next = e.target.value as ShiftKind;
                setShiftKind(next);
                setStartConfirmThreshold(false);
                setStartNotifiedManager(false);
              }}
              disabled={submitting}
            >
              <option value="open">Open</option>
              <option value="close">Close</option>
              <option value="double">Double</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm muted">Planned start time</label>
            <input
              type="datetime-local"
              className="input"
              value={plannedStartLocal}
              onChange={e => setPlannedStartLocal(e.target.value)}
              disabled={submitting}
            />
            <div className="text-xs muted">Rounded to 30 minutes on submit.</div>
          </div>

          <div className="space-y-2">
            <label className="text-sm muted">
              Beginning drawer count ($){requiresStartDrawer ? "" : " (optional)"}
            </label>
            <input
              className="input"
              inputMode="decimal"
              value={startDrawer}
              onChange={e => setStartDrawer(e.target.value)}
              disabled={submitting}
            />

            {requiresStartDrawer && thresholdMsg && (
              <div className="banner text-sm">
                {thresholdMsg}
              </div>
            )}

            {requiresStartDrawer && startOutOfThreshold && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={startConfirmThreshold}
                  onChange={e => setStartConfirmThreshold(e.target.checked)}
                  disabled={submitting}
                />
                I confirm this count is correct (required if outside threshold)
              </label>
            )}

            {requiresStartDrawer && startOutOfThreshold && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={startNotifiedManager}
                  onChange={e => setStartNotifiedManager(e.target.checked)}
                  disabled={submitting}
                />
                I notified manager
              </label>
            )}
          </div>

          <div className="sticky-cta">
            <button
              className="btn-primary w-full py-3 text-sm disabled:opacity-50"
              disabled={!canStart || submitting}
              onClick={startShift}
            >
              {submitting ? "Starting..." : "Start Shift"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
