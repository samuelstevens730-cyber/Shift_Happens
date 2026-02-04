/**
 * Clock Page Client - Employee Clock-In Flow
 *
 * Main clock-in interface for employees. Supports two entry modes:
 * 1. QR scan - URL contains ?t=<token>, locks store selection to that location
 * 2. Manual - No token, employee selects store from dropdown
 *
 * Flow:
 * 1. Select store (or auto-selected via QR)
 * 2. Select employee name
 * 3. Choose shift type (open/close/double/other)
 * 4. Enter planned start time (rounded to 30-min increments for payroll)
 * 5. Enter starting drawer count (required for open/close/double, optional for other)
 * 6. If drawer out of threshold: must confirm count and notify manager
 * 7. Confirmation modal before submitting
 * 8. Redirect to shift detail page on success
 *
 * Local storage persists last-used store/employee for faster repeat clock-ins.
 */

// src/app/clock/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { isOutOfThreshold, thresholdMessage } from "@/lib/kioskRules";
import { getCstDowMinutes, isTimeWithinWindow, toStoreKey, WindowShiftType } from "@/lib/clockWindows";
import { playAlarm, stopAlarm } from "@/lib/alarm";

type Store = { id: string; name: string; expected_drawer_cents: number };
type Profile = { id: string; name: string; active: boolean | null };
type ShiftKind = "open" | "close" | "double" | "other";

const PIN_TOKEN_KEY = "sh_pin_token";
const PIN_STORE_KEY = "sh_pin_store_id";
const PIN_PROFILE_KEY = "sh_pin_profile_id";

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

function formatDateTime(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getCstOffsetMinutes(isoLike: string) {
  const dt = new Date(isoLike);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(dt);
  const tz = parts.find(p => p.type === "timeZoneName")?.value || "";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2] || "0");
  return hours * 60 + (hours < 0 ? -mins : mins);
}

function toCstDateFromLocalInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  const isoLike = `${y}-${m}-${d}T${hh}:${mm}:00Z`;
  const offset = getCstOffsetMinutes(isoLike);
  if (offset == null) return null;
  const utcMillis = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)) - offset * 60000;
  return new Date(utcMillis);
}

function formatCst(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ClockPageClient() {
  const router = useRouter();
  const search = useSearchParams();
  // QR token from store-specific QR code, locks store selection if valid
  const qrToken = search.get("t") || "";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [shiftKind, setShiftKind] = useState<ShiftKind>("open");
  const [tokenStore, setTokenStore] = useState<Store | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Default to current time rounded to nearest 30 minutes
  const [plannedStartLocal, setPlannedStartLocal] = useState(() =>
    toLocalInputValue(roundTo30Minutes(new Date()))
  );

  // Drawer count state - default $200 to speed up entry
  const [startDrawer, setStartDrawer] = useState<string>("200");
  const [changeDrawer, setChangeDrawer] = useState<string>("200");
  const [startConfirmThreshold, setStartConfirmThreshold] = useState(false);
  const [startNotifiedManager, setStartNotifiedManager] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [clockWindowModal, setClockWindowModal] = useState<{ open: boolean; label: string }>({
    open: false,
    label: "",
  });
  const [debugClockWindow, setDebugClockWindow] = useState<{
    shiftKind: ShiftKind;
    plannedLocal: string;
    plannedCst: string;
    plannedRoundedCst: string;
    storeKey: string | null;
    dow: number | null;
    minutes: number | null;
  } | null>(null);
  const [openShiftPrompt, setOpenShiftPrompt] = useState(false);
  const [openShiftInfo, setOpenShiftInfo] = useState<{
    id: string;
    started_at: string;
    shift_type: ShiftKind;
    store_id: string | null;
    store_name: string | null;
    expected_drawer_cents: number | null;
  } | null>(null);
  const [openShiftKey, setOpenShiftKey] = useState<string>("");
  const [staleShiftPrompt, setStaleShiftPrompt] = useState(false);
  const [staleEndLocal, setStaleEndLocal] = useState(() => toLocalInputValue());
  const [staleDrawer, setStaleDrawer] = useState("200");
  const [staleChangeDrawer, setStaleChangeDrawer] = useState("200");
  const [staleConfirm, setStaleConfirm] = useState(false);
  const [staleNotify, setStaleNotify] = useState(false);
  const [staleNote, setStaleNote] = useState("");
  const [staleDoubleCheck, setStaleDoubleCheck] = useState(false);
  const [staleSaving, setStaleSaving] = useState(false);

  const [pinToken, setPinToken] = useState<string | null>(null);
  const [pinStoreId, setPinStoreId] = useState<string | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(true);
  const [managerSession, setManagerSession] = useState(false);
  const [pinProfileId, setPinProfileId] = useState<string | null>(null);
  const [pinLockedSelection, setPinLockedSelection] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  // "other" shifts don't require drawer counts (e.g., training, inventory)
  const requiresStartDrawer = shiftKind !== "other";

  // Get expected drawer amount for selected store (used for threshold checking)
  const expectedDrawerCents = useMemo(() => {
    const s = stores.find(x => x.id === storeId);
    return s?.expected_drawer_cents ?? 20000; // safe default
  }, [stores, storeId]);

  // Parse drawer input to cents (null if invalid)
  const parsedStart = useMemo(() => {
    const dollars = Number(startDrawer);
    if (Number.isNaN(dollars) || dollars < 0) return null;
    return Math.round(dollars * 100);
  }, [startDrawer]);

  const parsedChange = useMemo(() => {
    const dollars = Number(changeDrawer);
    if (Number.isNaN(dollars) || dollars < 0) return null;
    return Math.round(dollars * 100);
  }, [changeDrawer]);

  // Check if drawer count is outside acceptable variance range
  const startOutOfThreshold = useMemo(() => {
    if (!requiresStartDrawer) return false;
    if (parsedStart == null) return false;
    return isOutOfThreshold(parsedStart, expectedDrawerCents);
  }, [requiresStartDrawer, parsedStart, expectedDrawerCents]);

  const changeNot200 = useMemo(() => {
    if (!requiresStartDrawer) return false;
    if (parsedChange == null) return false;
    return parsedChange !== 20000;
  }, [requiresStartDrawer, parsedChange]);

  const requiresManagerNotify = useMemo(() => {
    return startOutOfThreshold || changeNot200;
  }, [startOutOfThreshold, changeNot200]);

  // Generate threshold warning message for display
  const thresholdMsg = useMemo(() => {
    if (!requiresStartDrawer) return null;
    if (parsedStart == null) return "Enter a valid drawer amount.";
    return thresholdMessage(parsedStart, expectedDrawerCents);
  }, [requiresStartDrawer, parsedStart, expectedDrawerCents]);

  const selectedStoreName = useMemo(() => {
    return stores.find(s => s.id === storeId)?.name ?? "Unknown Store";
  }, [stores, storeId]);

  const selectedProfileName = useMemo(() => {
    return profiles.find(p => p.id === profileId)?.name ?? "Unknown Employee";
  }, [profiles, profileId]);

  const plannedStartLabel = useMemo(() => {
    if (!plannedStartLocal) return "Unknown time";
    const dt = toCstDateFromLocalInput(plannedStartLocal);
    if (!dt) return plannedStartLocal;
    return formatCst(dt);
  }, [plannedStartLocal]);

  const plannedStartRoundedLabel = useMemo(() => {
    if (!plannedStartLocal) return "";
    const dt = toCstDateFromLocalInput(plannedStartLocal);
    if (!dt) return "";
    return formatCst(roundTo30Minutes(dt));
  }, [plannedStartLocal]);

  const debugClockPanel = useMemo(() => {
    if (!plannedStartLocal) return null;
    const planned = toCstDateFromLocalInput(plannedStartLocal);
    if (!planned) return null;
    const rounded = roundTo30Minutes(planned);
    const cst = getCstDowMinutes(rounded);
    const windowCheck = checkClockWindow(shiftKind, rounded);
    return {
      shiftKind,
      plannedLocal: plannedStartLocal,
      plannedCst: formatCst(planned),
      plannedRoundedCst: formatCst(rounded),
      storeKey: storeKeyForWindow,
      dow: cst?.dow ?? null,
      minutes: cst?.minutes ?? null,
      windowOk: windowCheck.ok,
      windowLabel: windowCheck.label || "Outside allowed clock window",
    };
  }, [plannedStartLocal, shiftKind, storeKeyForWindow]);

  const storeKeyForWindow = useMemo(() => {
    const storeName = tokenStore?.name ?? stores.find(s => s.id === storeId)?.name ?? null;
    return toStoreKey(storeName);
  }, [tokenStore, stores, storeId]);

  const activeStoreId = useMemo(() => {
    return tokenStore?.id ?? storeId ?? "";
  }, [tokenStore, storeId]);

  function triggerClockWindowModal(label: string) {
    playAlarm();
    setClockWindowModal({ open: true, label });
  }

  function checkClockWindow(shiftType: ShiftKind, dt: Date) {
    if (shiftType !== "open" && shiftType !== "close") return { ok: true, label: "" };
    const storeKey = storeKeyForWindow;
    const cst = getCstDowMinutes(dt);
    if (!storeKey || !cst) {
      return { ok: false, label: "Outside allowed clock window" };
    }
    const res = isTimeWithinWindow({
      storeKey,
      shiftType: shiftType as WindowShiftType,
      localDow: cst.dow,
      minutes: cst.minutes,
    });
    return { ok: res.ok, label: res.windowLabel };
  }

  // Validation: all required fields filled and threshold rules satisfied
  const canStart = useMemo(() => {
    if (!storeId || !profileId || !plannedStartLocal) return false;

    const plannedMs = new Date(plannedStartLocal).getTime();
    if (Number.isNaN(plannedMs)) return false;

    if (!requiresStartDrawer) return true;

    if (parsedStart == null) return false;
    if (parsedChange == null) return false;

    // If outside threshold, user must confirm they notified a manager.
    if (requiresManagerNotify && !startNotifiedManager) return false;

    return true;
  }, [
    storeId,
    profileId,
    plannedStartLocal,
    requiresStartDrawer,
    parsedStart,
    parsedChange,
    startOutOfThreshold,
    requiresManagerNotify,
    startNotifiedManager,
  ]);

  // Load stores, profiles, and validate QR token on mount
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

        // Filter out inactive employees
        const filteredProfiles = (profileData ?? []).filter(p => p.active !== false);

        setStores(storeData ?? []);
        setProfiles(filteredProfiles);

        // Validate QR token and lock store if valid
        if (qrToken) {
          const { data: tokenStoreRow, error: tokenErr } = await supabase
            .from("stores")
            .select("id, name, expected_drawer_cents")
            .eq("qr_token", qrToken)
            .maybeSingle()
            .returns<Store>();
          if (tokenErr) throw tokenErr;
          if (!tokenStoreRow) {
            setTokenError("QR token is invalid for any store.");
            setTokenStore(null);
          } else {
            setTokenStore(tokenStoreRow);
            setTokenError(null);
            setStoreId(tokenStoreRow.id);
          }
        }

        // Restore last selections if still valid (for faster repeat clock-ins)
        const lastStore = localStorage.getItem("sh_store") || "";
        const lastProfile = localStorage.getItem("sh_profile") || "";

        const storeOk = (storeData ?? []).some(s => s.id === lastStore);
        const profileOk = (filteredProfiles ?? []).some(p => p.id === lastProfile);

        const nextStoreId = storeOk ? lastStore : (storeData?.[0]?.id ?? "");
        const nextProfileId = profileOk ? lastProfile : (filteredProfiles?.[0]?.id ?? "");

        if (!qrToken) setStoreId(nextStoreId);
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
    if (typeof window === "undefined") return;
    const storedToken = sessionStorage.getItem(PIN_TOKEN_KEY);
    const storedStore = sessionStorage.getItem(PIN_STORE_KEY);
    const storedProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
    if (storedToken && storedStore && storedProfile) {
      setPinToken(storedToken);
      setPinStoreId(storedStore);
      setPinProfileId(storedProfile);
      setPinLockedSelection(true);
      setStoreId(storedStore);
      setProfileId(storedProfile);
      setPinModalOpen(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setManagerSession(Boolean(data?.session?.user));
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setManagerSession(Boolean(session?.user));
    });

    return () => {
      alive = false;
      sub?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!activeStoreId) return;
    if (managerSession) {
      setPinModalOpen(false);
      return;
    }
    if (loading) {
      setPinModalOpen(true);
      return;
    }
    if (!pinToken || !pinStoreId || !pinProfileId || pinStoreId !== activeStoreId) {
      setPinModalOpen(true);
    } else {
      setPinModalOpen(false);
    }
  }, [activeStoreId, pinToken, pinStoreId, pinProfileId, managerSession, loading]);

  useEffect(() => {
    if (!pinModalOpen) return;
    setPinValue("");
    setPinError(null);
    setTimeout(() => pinInputRef.current?.focus(), 0);
  }, [pinModalOpen]);

  // Persist selections to localStorage for faster repeat clock-ins
  useEffect(() => {
    if (storeId) localStorage.setItem("sh_store", storeId);
  }, [storeId]);

  useEffect(() => {
    if (profileId) localStorage.setItem("sh_profile", profileId);
  }, [profileId]);

  // Check for an existing open shift when employee selection changes
  useEffect(() => {
    const key = profileId;
    if (!profileId || key === openShiftKey) return;

    let alive = true;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set("profileId", profileId);
        // Always check by employee only (global rule: one open shift per person)

        const res = await fetch(`/api/shift/open?${params.toString()}`);
        const json = await res.json();
        if (!alive) return;

        if (!res.ok || !json?.shiftId) {
          setOpenShiftInfo(null);
          setOpenShiftPrompt(false);
          setStaleShiftPrompt(false);
          setOpenShiftKey(key);
          return;
        }

        setOpenShiftInfo({
          id: json.shiftId,
          started_at: json.startedAt,
          shift_type: json.shiftType as ShiftKind,
          store_id: json.storeId ?? null,
          store_name: json.storeName ?? null,
          expected_drawer_cents: json.expectedDrawerCents ?? null,
        });
        setOpenShiftPrompt(true);
        setStaleShiftPrompt(false);
        setOpenShiftKey(key);
      } catch {
        if (!alive) return;
        setOpenShiftInfo(null);
        setOpenShiftPrompt(false);
        setStaleShiftPrompt(false);
        setOpenShiftKey(key);
      }
    })();

    return () => {
      alive = false;
    };
  }, [profileId, openShiftKey]);

  // Reset confirmation state when form fields change
  useEffect(() => {
    setConfirmChecked(false);
    setConfirmOpen(false);
  }, [storeId, profileId, plannedStartLocal, shiftKind]);

  useEffect(() => {
    if (!requiresManagerNotify) {
      setStartNotifiedManager(false);
    }
  }, [requiresManagerNotify]);

  async function startShift() {
    setError(null);

    const planned = toCstDateFromLocalInput(plannedStartLocal);
    if (!planned) {
      setError("Invalid planned start date/time.");
      return;
    }

    const roundedPlanned = roundTo30Minutes(planned);
    const windowCheck = checkClockWindow(shiftKind, roundedPlanned);
    if (!windowCheck.ok) {
      const cst = getCstDowMinutes(roundedPlanned);
      setDebugClockWindow({
        shiftKind,
        plannedLocal: plannedStartLocal,
        plannedCst: formatCst(planned),
        plannedRoundedCst: formatCst(roundedPlanned),
        storeKey: storeKeyForWindow,
        dow: cst?.dow ?? null,
        minutes: cst?.minutes ?? null,
      });
      triggerClockWindowModal(windowCheck.label);
      return;
    }

    let startDrawerCents: number | null = null;
    let changeDrawerCents: number | null = null;
    let confirmed = false;

    if (requiresStartDrawer) {
      if (parsedStart == null) {
        setError("Enter a valid starting drawer amount.");
        return;
      }
      if (parsedChange == null) {
        setError("Enter a valid change drawer amount.");
        return;
      }

      startDrawerCents = parsedStart;
      changeDrawerCents = parsedChange;

      const out = isOutOfThreshold(parsedStart, expectedDrawerCents);
      confirmed = out ? Boolean(startConfirmThreshold) : false;

      if ((out || parsedChange !== 20000) && !startNotifiedManager) {
        setError("Notify manager to proceed.");
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
          changeDrawerCents, // change drawer count in cents
          confirmed,
          notifiedManager: startDrawerCents == null ? false : startNotifiedManager,
          note: null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (json?.code === "CLOCK_WINDOW_VIOLATION") {
          triggerClockWindowModal(json?.windowLabel ?? "Outside allowed clock window");
          return;
        }
        if (res.status === 409 && json?.shiftId) {
          try {
            const params = new URLSearchParams({ profileId });
            const openRes = await fetch(`/api/shift/open?${params.toString()}`);
            const openJson = await openRes.json();
            if (openRes.ok && openJson?.shiftId) {
              setOpenShiftInfo({
                id: openJson.shiftId,
                started_at: openJson.startedAt,
                shift_type: openJson.shiftType as ShiftKind,
                store_id: openJson.storeId ?? null,
                store_name: openJson.storeName ?? null,
                expected_drawer_cents: openJson.expectedDrawerCents ?? null,
              });
              setOpenShiftPrompt(true);
              setStaleShiftPrompt(true);
              return;
            }
          } catch {
            // fall through to error display
          }
        }
        throw new Error(json?.error || "Failed to start shift.");
      }

      const shiftId = json.shiftId as string;
      if (!shiftId) throw new Error("API did not return shiftId.");
      stopAlarm();

      // Redirect based on shift type - open/double go through run page first
      const base = shiftKind === "open" || shiftKind === "double" ? `/run/${shiftId}` : `/shift/${shiftId}`;
      const params = new URLSearchParams();
      if (qrToken) params.set("t", qrToken);
      // Handle reused shift (employee already clocked in today)
      if (json?.reused) {
        params.set("reused", "1");
        if (json.startedAt) params.set("startedAt", json.startedAt);
      }
      const qs = params.toString();
      router.replace(qs ? `${base}?${qs}` : base);
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
        {openShiftPrompt && openShiftInfo && (
          <div className="card card-pad space-y-3">
            <div className="text-lg font-semibold">Open shift detected</div>
            <div className="text-sm muted">
            {selectedProfileName} already has an open shift at{" "}
            <b>{openShiftInfo.store_name ?? "another store"}</b> started at{" "}
            <b>{formatDateTime(new Date(openShiftInfo.started_at))}</b>.
          </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                className="btn-secondary px-4 py-2"
                onClick={() => {
                  const base =
                    openShiftInfo.shift_type === "open" || openShiftInfo.shift_type === "double"
                      ? `/run/${openShiftInfo.id}`
                      : `/shift/${openShiftInfo.id}`;
                  const params = new URLSearchParams();
                  if (qrToken) params.set("t", qrToken);
                  params.set("reused", "1");
                  params.set("startedAt", openShiftInfo.started_at);
                  const qs = params.toString();
                  router.replace(qs ? `${base}?${qs}` : base);
                }}
              >
                Return to open shift
              </button>
              <button
                className="btn-primary px-4 py-2"
                onClick={() => setStaleShiftPrompt(true)}
              >
                End previous shift
              </button>
            </div>
          </div>
        )}

        {staleShiftPrompt && openShiftInfo && (
          <div className="card card-pad space-y-4">
            <div className="text-lg font-semibold">Close stale shift?</div>
            <div className="text-sm muted">
            {selectedProfileName} already has an open shift at{" "}
            <b>{openShiftInfo.store_name ?? "another store"}</b> started at{" "}
            <b>{formatDateTime(new Date(openShiftInfo.started_at))}</b>.
          </div>

            <div className="space-y-2">
              <label className="text-sm muted">End time</label>
              <input
                type="datetime-local"
                className="input"
                value={staleEndLocal}
                onChange={e => setStaleEndLocal(e.target.value)}
                disabled={staleSaving}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm muted">Ending drawer count ($)</label>
              <input
                className="input"
                inputMode="decimal"
                value={staleDrawer}
                onChange={e => setStaleDrawer(e.target.value)}
                disabled={staleSaving}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm muted">Change drawer count ($)</label>
              <input
                className="input"
                inputMode="decimal"
                value={staleChangeDrawer}
                onChange={e => setStaleChangeDrawer(e.target.value)}
                disabled={staleSaving}
              />
            </div>

            <StaleShiftConfirmations
              isOther={openShiftInfo.shift_type === "other"}
              expectedCents={openShiftInfo.expected_drawer_cents ?? 20000}
              drawerValue={staleDrawer}
              changeDrawerValue={staleChangeDrawer}
              confirm={staleConfirm}
              notify={staleNotify}
              setConfirm={setStaleConfirm}
              setNotify={setStaleNotify}
            />

            <div className="space-y-2">
              <label className="text-sm muted">Note (optional)</label>
              <input
                className="input"
                value={staleNote}
                onChange={e => setStaleNote(e.target.value)}
                disabled={staleSaving}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={staleDoubleCheck}
                onChange={e => setStaleDoubleCheck(e.target.checked)}
                disabled={staleSaving}
              />
              I understand I'm ending a previous shift.
            </label>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                className="btn-secondary px-4 py-2"
                onClick={() => setStaleShiftPrompt(false)}
                disabled={staleSaving}
              >
                Cancel
              </button>
              <button
                className="btn-secondary px-4 py-2"
                onClick={() => {
                  const base =
                    openShiftInfo.shift_type === "open" || openShiftInfo.shift_type === "double"
                      ? `/run/${openShiftInfo.id}`
                      : `/shift/${openShiftInfo.id}`;
                  router.replace(base);
                }}
                disabled={staleSaving}
              >
                Return to open shift
              </button>
              <button
                className="btn-primary px-4 py-2 disabled:opacity-50"
                disabled={staleSaving}
                onClick={async () => {
                  const endDate = toCstDateFromLocalInput(staleEndLocal);
                  if (!endDate || Number.isNaN(endDate.getTime())) {
                    setError("Invalid end time.");
                    return;
                  }
                  if (openShiftInfo.shift_type === "close") {
                    const windowCheck = checkClockWindow("close", roundTo30Minutes(endDate));
                    if (!windowCheck.ok) {
                      triggerClockWindowModal(windowCheck.label);
                      return;
                    }
                  }
                  const drawerCents = Math.round(Number(staleDrawer) * 100);
                  const changeCents = Math.round(Number(staleChangeDrawer) * 100);
                  const hasValidDrawer = Number.isFinite(drawerCents);
                  const hasValidChange = Number.isFinite(changeCents);
                  const expected = openShiftInfo.expected_drawer_cents ?? 20000;
                  const isOtherShift = openShiftInfo.shift_type === "other";
                  const outOfThreshold = !isOtherShift && hasValidDrawer
                    ? isOutOfThreshold(drawerCents, expected)
                    : false;
                  const changeNot200 = !isOtherShift && hasValidChange ? changeCents !== 20000 : false;

                  if (!isOtherShift && (!hasValidDrawer || !hasValidChange)) {
                    setError("Enter valid drawer and change drawer amounts.");
                    return;
                  }
                  if (outOfThreshold && !staleConfirm) {
                    setError("Confirm the drawer count to proceed.");
                    return;
                  }
                  if ((outOfThreshold || changeNot200) && !staleNotify) {
                    setError("Notify manager to proceed.");
                    return;
                  }
                  if (!staleDoubleCheck) {
                    setError("Confirm you're ending the previous shift.");
                    return;
                  }

                  setStaleSaving(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/end-shift", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        shiftId: openShiftInfo.id,
                        endAt: endDate.toISOString(),
                        endDrawerCents: isOtherShift ? (hasValidDrawer ? drawerCents : null) : drawerCents,
                        changeDrawerCents: isOtherShift ? (hasValidChange ? changeCents : null) : changeCents,
                        confirmed: outOfThreshold ? staleConfirm : false,
                        notifiedManager: (outOfThreshold || changeNot200) ? staleNotify : false,
                        note: staleNote || null,
                        manualClose: true,
                      }),
                    });
                    const json = await res.json();
                    if (!res.ok) {
                      if (json?.code === "CLOCK_WINDOW_VIOLATION") {
                        triggerClockWindowModal(json?.windowLabel ?? "Outside allowed clock window");
                        return;
                      }
                      throw new Error(json?.error || "Failed to end shift.");
                    }
                    setStaleShiftPrompt(false);
                    setOpenShiftPrompt(false);
                    setOpenShiftInfo(null);
                    setOpenShiftKey("");
                    stopAlarm();
                    await startShift();
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : "Failed to end shift.");
                  } finally {
                    setStaleSaving(false);
                  }
                }}
              >
                End & Start New Shift
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Clock In</h1>
          <span className="text-xs muted">Employee</span>
        </div>

        <div className="card card-pad space-y-4">
          {/* Manual mode banner - shown when no QR token */}
          {!qrToken && (
            <div className="banner text-sm">
              QR token missing - manual clock-in is allowed. Select a store and employee to continue.
            </div>
          )}

          {/* QR token validated - show locked store info */}
          {qrToken && tokenStore && (
            <div className="banner text-sm">
              Token store: <b>{tokenStore.name}</b>. Store selection is locked to this location.
              <div className="mt-2">
                <a className="underline" href="/clock">Not at this store?</a>
              </div>
            </div>
          )}

          {/* Invalid QR token error */}
          {qrToken && tokenError && (
            <div className="banner banner-error text-sm">{tokenError}</div>
          )}

          {error && (
            <div className="banner banner-error text-sm">{error}</div>
          )}

          {debugClockPanel && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] text-white/70">
              <div className="text-xs font-semibold text-white/80">Debug clock window</div>
              <div>shift={debugClockPanel.shiftKind}</div>
              <div>plannedLocal={debugClockPanel.plannedLocal}</div>
              <div>plannedCST={debugClockPanel.plannedCst}</div>
              <div>roundedCST={debugClockPanel.plannedRoundedCst}</div>
              <div>storeKey={debugClockPanel.storeKey ?? "null"}</div>
              <div>dow={debugClockPanel.dow ?? "null"} minutes={debugClockPanel.minutes ?? "null"}</div>
              <div>windowOk={String(debugClockPanel.windowOk)} label={debugClockPanel.windowLabel}</div>
            </div>
          )}

          {/* Store selector - hidden when QR token locks the store */}
          {!qrToken && (
            <div className="space-y-2">
              <label className="text-sm muted">Store</label>
              <select
                className="select"
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
                disabled={submitting || pinLockedSelection}
              >
                {stores.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm muted">Employee</label>
            <select
              className="select"
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              disabled={submitting || pinLockedSelection}
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
                // Reset threshold confirmations when shift type changes
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
          <div className="text-xs muted">
            Times are recorded in CST. Rounded to {plannedStartRoundedLabel || "the nearest 30 minutes"} on submit.
          </div>
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

            {/* Threshold warning message */}
            {requiresStartDrawer && thresholdMsg && (
              <div className="banner text-sm">
                {thresholdMsg}
              </div>
            )}

            <label className="text-sm muted">
              Change drawer count ($){requiresStartDrawer ? "" : " (optional)"}
            </label>
            <input
              className="input"
              inputMode="decimal"
              value={changeDrawer}
              onChange={e => setChangeDrawer(e.target.value)}
              disabled={submitting}
            />

            {requiresStartDrawer && parsedChange != null && changeNot200 && (
              <div className="banner text-sm">
                Change drawer should be exactly $200.00.
              </div>
            )}

            {/* Threshold confirmation checkboxes - shown only when drawer is out of range */}
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

            {requiresStartDrawer && requiresManagerNotify && (
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
              onClick={() => {
                if (openShiftInfo) {
                  setOpenShiftPrompt(true);
                  return;
                }
                const planned = toCstDateFromLocalInput(plannedStartLocal);
                if (planned) {
                  const roundedPlanned = roundTo30Minutes(planned);
                  const windowCheck = checkClockWindow(shiftKind, roundedPlanned);
                  if (!windowCheck.ok) {
                    triggerClockWindowModal(windowCheck.label);
                    return;
                  }
                }
                if (canStart) setConfirmOpen(true);
              }}
            >
              {submitting ? "Starting..." : "Start Shift"}
            </button>
          </div>
        </div>
      </div>

      {pinModalOpen && !managerSession && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4">
              <div className={`card card-pad w-full max-w-md space-y-4 ${pinShake ? "shake" : ""}`}>
                <div className="text-lg font-semibold text-center">Employee PIN</div>
                <div className="text-xs muted text-center">
                  Enter your 4-digit PIN to continue.
                </div>

                {!qrToken && (
                  <div className="space-y-2">
                    <label className="text-sm muted">Store</label>
                    <select
                      className="select"
                      value={storeId}
                      onChange={e => setStoreId(e.target.value)}
                      disabled={pinLoading || pinLockedSelection || loading}
                    >
                      {stores.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {qrToken && tokenStore && (
                  <div className="text-xs muted text-center">
                    Token store: <b>{tokenStore.name}</b>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm muted">Employee</label>
                  <select
                    className="select"
                    value={profileId}
                    onChange={e => setProfileId(e.target.value)}
                    disabled={pinLoading || pinLockedSelection || loading}
                  >
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {loading && (
                  <div className="text-xs muted text-center">Loading stores and employees…</div>
                )}

                <div className="space-y-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-3"
                    onClick={() => pinInputRef.current?.focus()}
                  >
                    {Array.from({ length: 4 }).map((_, idx) => {
                      const filled = pinValue[idx] ?? "";
                      return (
                        <div
                          key={idx}
                          className={`h-12 w-12 rounded-xl border text-center text-xl font-semibold ${
                            filled ? "border-[rgba(32,240,138,0.6)] bg-[rgba(32,240,138,0.15)]" : "border-white/20"
                          }`}
                        >
                          {filled ? "•" : ""}
                        </div>
                      );
                    })}
                  </button>
                  <input
                    ref={pinInputRef}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    autoFocus
                    className="sr-only"
                    value={pinValue}
                    onChange={e => {
                      const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setPinValue(next);
                    }}
                  />
                </div>

                {pinError && (
                  <div className="banner banner-error text-sm text-center">{pinError}</div>
                )}

                <button
                  className="btn-primary w-full py-2 text-sm disabled:opacity-50"
                  disabled={pinLoading || pinValue.length !== 4 || !activeStoreId || !profileId || loading}
                  onClick={async () => {
                    if (!activeStoreId) {
                      setPinError("Select a store to continue.");
                      return;
                    }
                    if (!profileId) {
                      setPinError("Select your name to continue.");
                      return;
                    }
                    setPinLoading(true);
                    setPinError(null);
                    try {
                      const res = await fetch(
                        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/employee-auth`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
                        },
                          body: JSON.stringify({ store_id: activeStoreId, profile_id: profileId, pin: pinValue }),
                        }
                      );
                      const json = await res.json();
                      if (!res.ok) {
                        if (res.status === 403 && json?.error) {
                          setPinError("PIN auth not enabled for this store.");
                        } else if (res.status === 429) {
                          const mins = json?.retry_after_minutes || json?.locked_for_minutes || 5;
                          setPinError(`Account locked. Try in ${mins} minutes.`);
                        } else if (res.status === 401 && json?.attempts_remaining === 1) {
                          setPinError("Invalid PIN. You have 1 more try before lockout.");
                        } else {
                          setPinError("Invalid PIN.");
                        }
                        setPinValue("");
                        setPinShake(true);
                        setTimeout(() => setPinShake(false), 400);
                        return;
                      }
                      const token = json?.token as string | undefined;
                      if (!token) {
                        setPinError("Authentication failed.");
                        setPinValue("");
                        setPinShake(true);
                        setTimeout(() => setPinShake(false), 400);
                        return;
                      }
                      setPinToken(token);
                      setPinStoreId(activeStoreId);
                      setPinProfileId(profileId);
                      setPinLockedSelection(true);
                      if (typeof window !== "undefined") {
                        sessionStorage.setItem(PIN_TOKEN_KEY, token);
                        sessionStorage.setItem(PIN_STORE_KEY, activeStoreId);
                        sessionStorage.setItem(PIN_PROFILE_KEY, profileId);
                      }
                      setStoreId(activeStoreId);
                      setProfileId(profileId);
                      setPinModalOpen(false);
                    } catch {
                      setPinError("Authentication failed.");
                      setPinValue("");
                      setPinShake(true);
                      setTimeout(() => setPinShake(false), 400);
                    } finally {
                      setPinLoading(false);
                    }
                  }}
                >
                  {pinLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/40 border-t-black" />
                      Verifying...
                    </span>
                  ) : (
                    "Enter"
                  )}
                </button>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* Confirmation modal - prevents accidental clock-ins */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card card-pad w-full max-w-md space-y-4">
            <div className="text-lg font-semibold">Confirm clock in</div>
            <div className="text-sm muted">
              I am clocking in as <b>{selectedProfileName}</b> at <b>{selectedStoreName}</b> at{" "}
              <b>{plannedStartLabel}</b>.
            </div>
            {plannedStartRoundedLabel && (
              <div className="text-xs muted">
                Rounded to <b>{plannedStartRoundedLabel}</b> for payroll.
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={e => setConfirmChecked(e.target.checked)}
                disabled={submitting}
              />
              I confirm the details above are correct.
            </label>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                className="btn-secondary px-4 py-2"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="btn-primary px-4 py-2 disabled:opacity-50"
                onClick={() => {
                  if (!confirmChecked) return;
                  void startShift();
                }}
                disabled={!confirmChecked || submitting}
              >
                {submitting ? "Starting..." : "Confirm & Start"}
              </button>
            </div>
          </div>
        </div>
      )}

      {clockWindowModal.open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
              <div className="card card-pad w-full max-w-md space-y-3 text-center">
                <div className="text-lg font-semibold">CONTACT MANAGER IMMEDIATELY.</div>
                <div className="text-xs muted">
                  The alarm indicates an invalid time entry and stops once the entry is corrected or the process is exited.
                </div>
                <div className="text-xs muted">Proper clock in window: {clockWindowModal.label}</div>
                {debugClockWindow && (
                  <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] text-white/70">
                    <div><b>Debug</b> shift={debugClockWindow.shiftKind}</div>
                    <div>plannedLocal={debugClockWindow.plannedLocal}</div>
                    <div>plannedCST={debugClockWindow.plannedCst}</div>
                    <div>roundedCST={debugClockWindow.plannedRoundedCst}</div>
                    <div>storeKey={debugClockWindow.storeKey ?? "null"}</div>
                    <div>dow={debugClockWindow.dow ?? "null"} minutes={debugClockWindow.minutes ?? "null"}</div>
                  </div>
                )}
                <button
                  className="btn-secondary px-4 py-2"
                  onClick={() => setClockWindowModal({ open: false, label: "" })}
                >
                  Close
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function StaleShiftConfirmations({
  isOther,
  expectedCents,
  drawerValue,
  changeDrawerValue,
  confirm,
  notify,
  setConfirm,
  setNotify,
}: {
  isOther: boolean;
  expectedCents: number;
  drawerValue: string;
  changeDrawerValue: string;
  confirm: boolean;
  notify: boolean;
  setConfirm: (next: boolean) => void;
  setNotify: (next: boolean) => void;
}) {
  const drawerCents = Math.round(Number(drawerValue) * 100);
  const changeCents = Math.round(Number(changeDrawerValue) * 100);
  const hasDrawer = Number.isFinite(drawerCents);
  const hasChange = Number.isFinite(changeCents);
  const outOfThreshold = !isOther && hasDrawer ? isOutOfThreshold(drawerCents, expectedCents) : false;
  const changeNot200 = !isOther && hasChange ? changeCents !== 20000 : false;
  const msg = hasDrawer ? thresholdMessage(drawerCents, expectedCents) : null;

  useEffect(() => {
    if (!outOfThreshold) setConfirm(false);
    if (!outOfThreshold && !changeNot200) setNotify(false);
  }, [outOfThreshold, changeNot200, setConfirm, setNotify]);

  if (isOther) return null;

  return (
    <div className="space-y-2">
      {msg && (
        <div className="banner text-sm">
          {msg}
        </div>
      )}
      {hasChange && changeNot200 && (
        <div className="banner text-sm">
          Change drawer should be exactly $200.00.
        </div>
      )}
      {outOfThreshold && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirm}
            onChange={e => setConfirm(e.target.checked)}
          />
          I confirm this count is correct (required if outside threshold)
        </label>
      )}
      {(outOfThreshold || changeNot200) && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notify}
            onChange={e => setNotify(e.target.checked)}
          />
          I notified manager (required if change drawer is not $200)
        </label>
      )}
    </div>
  );
}

