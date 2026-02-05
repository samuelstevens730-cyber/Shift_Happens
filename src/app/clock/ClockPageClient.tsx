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
 * 3. Enter planned start time (rounded to 30-min increments for payroll)
 * 4. Enter starting drawer count (required for open/close/double, optional for other)
 * 5. If drawer out of threshold: must confirm count and notify manager
 * 6. Confirmation modal before submitting
 * 7. Redirect to shift detail page on success
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

function toCstMinutes(dt: Date) {
  const cst = getCstDowMinutes(dt);
  if (!cst) return null;
  return { dow: cst.dow, minutes: cst.minutes };
}

function getStoreShiftStarts(storeName: string | null, dow: number) {
  if (!storeName) return null;
  const name = storeName.toUpperCase();
  const isLV1 = name.startsWith("LV1");
  const isLV2 = name.startsWith("LV2");
  if (!isLV1 && !isLV2) return null;

  if (dow === 0) {
    return { openStart: 12 * 60, closeStart: 16 * 60 };
  }
  if (dow >= 1 && dow <= 3) {
    return { openStart: 9 * 60, closeStart: 15 * 60 };
  }
  if (dow === 4) {
    return { openStart: 9 * 60, closeStart: 15 * 60 + 30 };
  }
  if (dow === 5 || dow === 6) {
    return { openStart: 9 * 60, closeStart: 17 * 60 };
  }
  return null;
}

function inferShiftKind(plannedLocal: string, storeName: string | null) {
  const planned = toCstDateFromLocalInput(plannedLocal);
  if (!planned) return "other" as ShiftKind;
  const cst = toCstMinutes(planned);
  if (!cst) return "other" as ShiftKind;
  const starts = getStoreShiftStarts(storeName, cst.dow);
  if (!starts) return "other" as ShiftKind;
  const withinOpen = Math.abs(cst.minutes - starts.openStart) <= 120;
  const withinClose = Math.abs(cst.minutes - starts.closeStart) <= 120;
  if (withinOpen) return "open" as ShiftKind;
  if (withinClose) return "close" as ShiftKind;
  return "other" as ShiftKind;
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
  const [storeId, setStoreId] = useState("");
  
  // Employee code auth (replaces profile dropdown)
  const [employeeCode, setEmployeeCode] = useState("");
  const [profileId, setProfileId] = useState("");
  const [authenticatedProfileName, setAuthenticatedProfileName] = useState<string | null>(null);
  const [shiftKind, setShiftKind] = useState<ShiftKind>("open");
  const [unscheduledPrompt, setUnscheduledPrompt] = useState<{
    plannedLabel: string;
    storeName: string;
  } | null>(null);
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
  const [pinModalOpen, setPinModalOpen] = useState(false); // Start false, check storage first
  const [managerSession, setManagerSession] = useState(false);
  const [managerAccessToken, setManagerAccessToken] = useState<string | null>(null);
  const [managerProfile, setManagerProfile] = useState<{ profileId: string; name: string; storeIds: string[] } | null>(null);
  const [managerProfileError, setManagerProfileError] = useState<string | null>(null);
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
    return authenticatedProfileName ?? "Unknown Employee";
  }, [authenticatedProfileName]);

  const plannedStartLabel = useMemo(() => {
    if (!plannedStartLocal) return "Unknown time";
    const dt = toCstDateFromLocalInput(plannedStartLocal);
    if (!dt) return plannedStartLocal;
    return formatCst(dt);
  }, [plannedStartLocal]);

  const storeKeyForWindow = useMemo(() => {
    const storeName = tokenStore?.name ?? stores.find(s => s.id === storeId)?.name ?? null;
    return toStoreKey(storeName);
  }, [tokenStore, stores, storeId]);

  useEffect(() => {
    const storeName = tokenStore?.name ?? stores.find(s => s.id === storeId)?.name ?? null;
    if (!plannedStartLocal) return;
    setShiftKind(inferShiftKind(plannedStartLocal, storeName));
  }, [plannedStartLocal, tokenStore, stores, storeId]);

  const plannedStartRoundedLabel = useMemo(() => {
    if (!plannedStartLocal) return "";
    const dt = toCstDateFromLocalInput(plannedStartLocal);
    if (!dt) return "";
    return formatCst(roundTo30Minutes(dt));
  }, [plannedStartLocal]);


  const activeStoreId = useMemo(() => {
    return tokenStore?.id ?? storeId ?? "";
  }, [tokenStore, storeId]);

  function triggerClockWindowModal(label: string) {
    playAlarm();
    setClockWindowModal({ open: true, label });
  }

  function checkClockWindow(shiftType: ShiftKind, dt: Date) {
    if (shiftType !== "open") return { ok: true, label: "" };
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

  // Load stores and validate QR token on mount (NO profiles fetch for security)
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

        setStores(storeData ?? []);

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

        // Restore last store selection
        const lastStore = localStorage.getItem("sh_store") || "";
        const storeOk = (storeData ?? []).some(s => s.id === lastStore);
        if (!qrToken) setStoreId(storeOk ? lastStore : (storeData?.[0]?.id ?? ""));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load stores.");
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
    const storedProfileName = sessionStorage.getItem("sh_profile_name");
    if (storedToken && storedStore && storedProfile) {
      setPinToken(storedToken);
      setPinStoreId(storedStore);
      setPinProfileId(storedProfile);
      setPinLockedSelection(true);
      setStoreId(storedStore);
      setProfileId(storedProfile);
      setAuthenticatedProfileName(storedProfileName);
      setPinModalOpen(false);
    } else {
      // No stored auth - show the auth modal
      setPinModalOpen(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadManagerProfile(accessToken: string) {
      try {
        const res = await fetch("/api/me/profile", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!alive) return;
        if (res.ok) {
          const data = await res.json();
          setManagerProfile({ profileId: data.profileId, name: data.name, storeIds: data.storeIds });
          setManagerProfileError(null);
          // Auto-select manager's profile
          setProfileId(data.profileId);
        } else {
          const err = await res.json().catch(() => ({}));
          setManagerProfileError(err.error || "Failed to load your profile");
          setManagerProfile(null);
        }
      } catch {
        if (!alive) return;
        setManagerProfileError("Failed to load your profile");
        setManagerProfile(null);
      }
    }

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const hasSession = Boolean(data?.session?.user);
      setManagerSession(hasSession);
      if (hasSession && data?.session?.access_token) {
        setManagerAccessToken(data.session.access_token);
        await loadManagerProfile(data.session.access_token);
      } else {
        setManagerAccessToken(null);
        setManagerProfile(null);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const hasSession = Boolean(session?.user);
      setManagerSession(hasSession);
      if (hasSession && session?.access_token) {
        setManagerAccessToken(session.access_token);
        await loadManagerProfile(session.access_token);
      } else {
        setManagerAccessToken(null);
        setManagerProfile(null);
      }
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

  async function startShift(force = false) {
    setError(null);

    const planned = toCstDateFromLocalInput(plannedStartLocal);
    if (!planned) {
      setError("Invalid planned start date/time.");
      return;
    }

    const roundedPlanned = roundTo30Minutes(planned);
    const windowCheck = checkClockWindow(shiftKind, roundedPlanned);
    if (!windowCheck.ok) {
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

    // Determine auth token - manager uses Supabase access token, employee uses PIN token
    const authToken = managerSession ? managerAccessToken : pinToken;
    if (!authToken) {
      setError(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/start-shift", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          qrToken,
          storeId,
          profileId,
          shiftTypeHint: shiftKind,
          plannedStartAt: roundedPlanned.toISOString(),
          startDrawerCents, // null allowed for "other"
          changeDrawerCents, // change drawer count in cents
          confirmed,
          notifiedManager: startDrawerCents == null ? false : startNotifiedManager,
          note: null,
          force,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (json?.code === "UNSCHEDULED") {
          setUnscheduledPrompt({
            plannedLabel: plannedStartRoundedLabel || formatCst(roundedPlanned),
            storeName: selectedStoreName,
          });
          return;
        }
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

      const resolvedType = (json?.shiftType as ShiftKind | undefined) ?? shiftKind;
      // Redirect based on shift type - open/double go through run page first
      const base = resolvedType === "open" || resolvedType === "double" ? `/run/${shiftId}` : `/shift/${shiftId}`;
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

                  // Determine auth token for end-shift
                  const endAuthToken = managerSession ? managerAccessToken : pinToken;
                  if (!endAuthToken) {
                    setError(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
                    return;
                  }

                  setStaleSaving(true);
                  setError(null);
                  try {
                    const res = await fetch("/api/end-shift", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${endAuthToken}`,
                      },
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

        {unscheduledPrompt && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4">
            <div className="card card-pad w-full max-w-md space-y-4">
              <div className="text-lg font-semibold">Not on schedule</div>
              <div className="text-sm muted">
                You are not scheduled for this shift and it will require management approval.
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                <div><b>Store:</b> {unscheduledPrompt.storeName}</div>
                <div><b>Planned:</b> {unscheduledPrompt.plannedLabel}</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  className="btn-secondary px-4 py-2"
                  onClick={() => setUnscheduledPrompt(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary px-4 py-2"
                  onClick={async () => {
                    setUnscheduledPrompt(null);
                    await startShift(true);
                  }}
                >
                  Continue
                </button>
              </div>
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

          {/* Manager profile error */}
          {managerSession && managerProfileError && (
            <div className="banner banner-error text-sm">{managerProfileError}</div>
          )}

          {error && (
            <div className="banner banner-error text-sm">{error}</div>
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
            {managerSession && managerProfile ? (
              <div className="input bg-white/5 cursor-not-allowed">
                {managerProfile.name} <span className="text-xs muted">(you)</span>
              </div>
            ) : (
              <div className="input bg-[var(--card)] border border-[var(--green)]/30 text-center py-2">
                {authenticatedProfileName ?? "Not authenticated"}
              </div>
            )}
          </div>

          <div className="text-xs muted">Shift type: {shiftKind.toUpperCase()}</div>

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

      {pinModalOpen && !pinToken && !managerSession && typeof document !== "undefined"
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
                  <label className="text-sm muted">Employee Code</label>
                  <input
                    type="text"
                    placeholder="LV1-A7K"
                    value={employeeCode}
                    onChange={e => setEmployeeCode(e.target.value.toUpperCase())}
                    disabled={pinLoading || pinLockedSelection || loading}
                    className="input text-center uppercase tracking-widest"
                    maxLength={10}
                  />
                  <div className="text-xs muted text-center">
                    Enter your employee code (e.g., LV1-A7K)
                  </div>
                </div>

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
                  disabled={pinLoading || pinValue.length !== 4 || !activeStoreId || !employeeCode || loading}
                  onClick={async () => {
                    if (!activeStoreId) {
                      setPinError("Select a store to continue.");
                      return;
                    }
                    if (!employeeCode) {
                      setPinError("Please enter your employee code.");
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
                          body: JSON.stringify({ store_id: activeStoreId, employee_code: employeeCode, pin: pinValue }),
                        }
                      );
                      const json = await res.json();
                      if (!res.ok) {
                        if (res.status === 429) {
                          // Account locked - show specific lockout message
                          const mins = json?.retry_after_minutes || json?.locked_for_minutes || 5;
                          setPinError(`Account temporarily locked. Try again in ${mins} minutes.`);
                        } else if (res.status === 403) {
                          setPinError("PIN auth not enabled for this store.");
                        } else {
                          // Generic error for all other failures (401, etc.)
                          setPinError("Invalid employee code or PIN");
                        }
                        setPinValue("");
                        setPinShake(true);
                        setTimeout(() => setPinShake(false), 400);
                        return;
                      }
                      const token = json?.token as string | undefined;
                      const profileName = json?.profile?.name as string | undefined;
                      const authProfileId = json?.profile?.id as string | undefined;
                      if (!token || !authProfileId) {
                        setPinError("Authentication failed.");
                        setPinValue("");
                        setPinShake(true);
                        setTimeout(() => setPinShake(false), 400);
                        return;
                      }
                      setPinToken(token);
                      setPinStoreId(activeStoreId);
                      setPinProfileId(authProfileId);
                      setProfileId(authProfileId);
                      setAuthenticatedProfileName(profileName || null);
                      setPinLockedSelection(true);
                      if (typeof window !== "undefined") {
                        sessionStorage.setItem(PIN_TOKEN_KEY, token);
                        sessionStorage.setItem(PIN_STORE_KEY, activeStoreId);
                        sessionStorage.setItem(PIN_PROFILE_KEY, authProfileId);
                      }
                      setStoreId(activeStoreId);
                      setPinModalOpen(false);
                    } catch {
                      setPinError("Unable to connect. Please try again.");
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

