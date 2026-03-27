/**
 * Shift Detail Page - Active Shift Management
 *
 * Main interface for employees during an active shift. Displays:
 * - Store and employee info
 * - Drawer counts (start, changeover for doubles, end)
 * - Shift checklist with required/optional items
 * - Shift tasks and employee notifications
 *
 * Clock-out is blocked until:
 * - All required checklist items are completed
 * - All delivered tasks are marked complete
 * - All unread manager-message notifications are addressed
 * - Changeover drawer count recorded (for double shifts)
 *
 * Automatically redirects to /shift/[id]/done when shift has ended.
 */

// src/app/shift/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { isOutOfThreshold, roundTo30Minutes, thresholdMessage } from "@/lib/kioskRules";
import { getCstDowMinutes, isTimeWithinWindow, toStoreKey, WindowShiftType } from "@/lib/clockWindows";
import { playAlarm, stopAlarm } from "@/lib/alarm";
import { supabase } from "@/lib/supabaseClient";
import HomeHeader from "@/components/HomeHeader";
import RolloverEntryCard from "./components/RolloverEntryCard";
import SafeCloseoutWizard from "./components/SafeCloseoutWizard";
import { useSafeCloseout } from "@/hooks/useSafeCloseout";
import type { SafeCloseoutContext } from "@/hooks/useSafeCloseout";

const PIN_TOKEN_KEY = "sh_pin_token";

type ShiftType = "open" | "close" | "double" | "other";

type ShiftState = {
  store: { id: string; name: string; expected_drawer_cents: number };
  shift: {
    id: string;
    shift_type: ShiftType;
    planned_start_at: string;
    started_at: string;
    ended_at: string | null;
  };
  scheduledWindow?: {
    shift_date: string;
    scheduled_start: string;
    scheduled_end: string;
  } | null;
  employee: string | null;
  counts: {
    count_type: "start" | "changeover" | "end";
    drawer_cents: number;
    confirmed: boolean;
    notified_manager: boolean;
    note: string | null;
    counted_at: string;
  }[];

  // legacy, safe to keep
  checklistItems: { id: string; label: string; sort_order: number; required: boolean }[];
  checkedItemIds: string[];

  // NEW grouped UI payload - checklist items grouped by label
  checklistGroups: {
    label: string;
    norm: string; // stable key for deduplication
    required: boolean;
    sort_order: number;
    itemIds: string[];
  }[];

  // IMPORTANT: backend currently returns labels, not norms
  checkedGroupLabels: string[];

  // Tasks/messages assigned by manager for this shift
  assignments: {
    id: string;
    type: "task" | "message";
    message: string;
    created_at: string;
    created_by: string | null;
    delivered_at: string | null;
    acknowledged_at: string | null;
    completed_at: string | null;
  }[];
};

type PendingNotification = {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
};

type CleaningTaskStatus = "pending" | "completed" | "skipped";

type CleaningTaskRow = {
  schedule_id: string;
  cleaning_task_id: string;
  task_name: string;
  task_description: string | null;
  task_category: string | null;
  task_sort_order: number;
  cleaning_shift_type: "am" | "pm";
  day_of_week: number;
  status: CleaningTaskStatus;
  completed_at: string | null;
  skipped_reason: string | null;
  completed_by: string | null;
};

type SalesContextState = {
  salesTrackingEnabled: boolean;
  priorXReportCents: number | null;
  isRolloverNight: boolean;
  pendingRollover: boolean;
  pendingRolloverDate: string | null;
  closerEntryExists: boolean;
  currentCloserEntryExists: boolean;
  closeEntryExists: boolean;
};

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildScheduledEndLocalInput(
  shiftDate: string | null | undefined,
  scheduledStart: string | null | undefined,
  scheduledEnd: string | null | undefined
) {
  if (!shiftDate || !scheduledEnd) return null;
  const startMinutes = scheduledStart ? Number(scheduledStart.split(":")[0]) * 60 + Number(scheduledStart.split(":")[1]) : null;
  const endMinutes = Number(scheduledEnd.split(":")[0]) * 60 + Number(scheduledEnd.split(":")[1]);
  if (!Number.isFinite(endMinutes)) return null;
  const [year, month, day] = shiftDate.split("-").map(Number);
  const dt = new Date(year, (month ?? 1) - 1, day ?? 1, Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
  if (startMinutes != null && endMinutes < startMinutes) {
    dt.setDate(dt.getDate() + 1);
  }
  return toLocalInputValue(dt);
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

function shouldShowVarianceControls(drawerCents: number, expectedCents: number) {
  if (!Number.isFinite(drawerCents) || !Number.isFinite(expectedCents)) return false;
  return isOutOfThreshold(drawerCents, expectedCents);
}

function formatDateTime(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getCstDateKey(value: string): string | null {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function parseMoneyInputToCents(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function SkeletonCard() {
  return (
    <div className="card animate-pulse bg-slate-800/50 border-slate-700 h-32 w-full rounded-2xl">
      <div className="p-6 space-y-4">
        <div className="h-4 bg-slate-700 rounded w-3/4" />
        <div className="h-4 bg-slate-700 rounded w-1/2" />
      </div>
    </div>
  );
}

export default function ShiftPage() {
  const { id } = useParams<{ id: string }>();
  const shiftId = id;

  const router = useRouter();
  const search = useSearchParams();
  const qrToken = search.get("t") || "";
  // Indicates this shift was reused (employee already clocked in today)
  const reused = search.get("reused") === "1";
  const reusedStartedAt = search.get("startedAt");

  const [state, setState] = useState<ShiftState | null>(null);

  // done = Set of GROUP NORMS, always.
  const [done, setDone] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showClockOut, setShowClockOut] = useState(false);
  const [showReuseBanner, setShowReuseBanner] = useState(reused);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [shiftTypeDraft, setShiftTypeDraft] = useState<ShiftType | null>(null);
  const [shiftTypeSaving, setShiftTypeSaving] = useState(false);
  const [shiftTypeErr, setShiftTypeErr] = useState<string | null>(null);
  const [cleaningTasks, setCleaningTasks] = useState<CleaningTaskRow[]>([]);
  const [cleaningLoading, setCleaningLoading] = useState(false);
  const [cleaningErr, setCleaningErr] = useState<string | null>(null);
  const [skipModalTask, setSkipModalTask] = useState<CleaningTaskRow | null>(null);
  const [checklistExpanded, setChecklistExpanded] = useState(false);
  const [cleaningExpanded, setCleaningExpanded] = useState(false);
  const [salesContext, setSalesContext] = useState<SalesContextState | null>(null);
  const [salesContextLoading, setSalesContextLoading] = useState(false);
  const [salesContextErr, setSalesContextErr] = useState<string | null>(null);
  const [pendingNotifications, setPendingNotifications] = useState<PendingNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsErr, setNotificationsErr] = useState<string | null>(null);
  const [dismissingNotificationId, setDismissingNotificationId] = useState<string | null>(null);
  const [closeCheckpointPriorX, setCloseCheckpointPriorX] = useState("");
  const [closeCheckpointZ, setCloseCheckpointZ] = useState("");

  const [closeCheckpointConfirm, setCloseCheckpointConfirm] = useState(false);
  const [closeCheckpointNeedsConfirm, setCloseCheckpointNeedsConfirm] = useState(false);
  const [closeCheckpointIsCeiling, setCloseCheckpointIsCeiling] = useState(false);
  const [closeCheckpointVarianceCents, setCloseCheckpointVarianceCents] = useState<number | null>(null);
  const [closeCheckpointSaving, setCloseCheckpointSaving] = useState(false);
  const [closeCheckpointErr, setCloseCheckpointErr] = useState<string | null>(null);
  const [safeCloseoutFlash, setSafeCloseoutFlash] = useState<{ tone: "success" | "warn" | "error"; message: string } | null>(null);

  // Auth state for API calls
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [managerAccessToken, setManagerAccessToken] = useState<string | null>(null);
  const [managerSession, setManagerSession] = useState(false);
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
  const profileIdRef = useRef<string | null>(null);
  const loadInFlightRef = useRef<Promise<boolean> | null>(null);
  const initialLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    profileIdRef.current = profileId;
  }, [profileId]);

  // Load auth tokens on mount
  useEffect(() => {
    // Load PIN token from session storage
    const storedToken = sessionStorage.getItem(PIN_TOKEN_KEY);
    if (storedToken) {
      setPinToken(storedToken);
      const storedProfile = sessionStorage.getItem("sh_pin_profile_id");
      if (storedProfile) setProfileId(storedProfile);
    }

    // Check for Supabase manager session
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const hasSession = Boolean(data?.session?.user);
      setManagerSession(hasSession);
      if (hasSession && data?.session?.access_token) {
        setManagerAccessToken(data.session.access_token);
      }
      setAuthBootstrapped(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const hasSession = Boolean(session?.user);
      setManagerSession(hasSession);
      if (hasSession && session?.access_token) {
        setManagerAccessToken(session.access_token);
      } else {
        setManagerAccessToken(null);
        if (!pinToken) setProfileId(null);
      }
    });

    return () => {
      alive = false;
      sub?.subscription.unsubscribe();
    };
  }, []);

  // Convert backend "checkedGroupLabels" -> frontend Set of group.norm keys
  const seedDoneFromState = useCallback((json: ShiftState) => {
    const labels = json.checkedGroupLabels || [];
    const groups = json.checklistGroups || [];

    const labelToNorm = new Map(groups.map(g => [g.label, g.norm]));
    const norms = labels.map(l => labelToNorm.get(l)).filter((x): x is string => Boolean(x));

    setDone(new Set(norms));
  }, []);

  const resolveAuthToken = useCallback(async () => {
    if (managerAccessToken) return managerAccessToken;
    if (pinToken) return pinToken;
    const storedToken = sessionStorage.getItem(PIN_TOKEN_KEY);
    if (storedToken) {
      setPinToken(storedToken);
      const storedProfile = sessionStorage.getItem("sh_pin_profile_id");
      if (storedProfile && !profileIdRef.current) {
        profileIdRef.current = storedProfile;
        setProfileId(storedProfile);
      }
      return storedToken;
    }
    const { data } = await supabase.auth.getSession();
    const hasSession = Boolean(data?.session?.user);
    setManagerSession(hasSession);
    if (hasSession && data?.session?.access_token) {
      setManagerAccessToken(data.session.access_token);
      if (!profileIdRef.current) {
        const res = await fetch("/api/me/profile", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (res.ok) {
          const profile = await res.json();
          const nextProfileId = profile?.profileId ?? null;
          profileIdRef.current = nextProfileId;
          setProfileId(nextProfileId);
        }
      }
      return data.session.access_token;
    }
    return null;
  }, [managerAccessToken, pinToken]);

  const loadNotifications = useCallback(async () => {
    if (!profileId) {
      setPendingNotifications([]);
      setNotificationsErr(null);
      return;
    }

    setNotificationsLoading(true);
    setNotificationsErr(null);
    try {
      const authToken = await resolveAuthToken();
      if (!authToken) {
        throw new Error(
          managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN."
        );
      }

      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load notifications.");

      setPendingNotifications((json?.notifications ?? []) as PendingNotification[]);
    } catch (e: unknown) {
      setNotificationsErr(e instanceof Error ? e.message : "Failed to load notifications.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [managerSession, profileId, resolveAuthToken]);

  const reloadShift = useCallback(async (): Promise<boolean> => {
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const inFlight = (async () => {
      const query = qrToken ? `?t=${encodeURIComponent(qrToken)}` : "";
      const authToken = await resolveAuthToken();
      if (!authToken) {
        return false;
      }
      const res = await fetch(`/api/shift/${shiftId}${query}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load shift.");

      setState(json);
      seedDoneFromState(json);

      // If shift already ended, redirect to completion page
      if (json.shift?.ended_at) {
        const doneQuery = qrToken ? `?t=${encodeURIComponent(qrToken)}` : "";
        router.replace(`/shift/${shiftId}/done${doneQuery}`);
      }
      return true;
    })();

    loadInFlightRef.current = inFlight;
    try {
      return await inFlight;
    } finally {
      if (loadInFlightRef.current === inFlight) {
        loadInFlightRef.current = null;
      }
    }
  }, [resolveAuthToken, qrToken, shiftId, router, seedDoneFromState]);

  const loadCleaningTasks = useCallback(async () => {
    const currentShiftType = state?.shift?.shift_type;
    if (currentShiftType === "other") {
      setCleaningTasks([]);
      setCleaningErr(null);
      return;
    }
    const authToken = await resolveAuthToken();
    if (!authToken) return;
    setCleaningLoading(true);
    setCleaningErr(null);
    try {
      const res = await fetch(`/api/cleaning/${shiftId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load cleaning tasks.");
      setCleaningTasks((json.tasks ?? []) as CleaningTaskRow[]);
    } catch (e: unknown) {
      setCleaningErr(e instanceof Error ? e.message : "Failed to load cleaning tasks.");
      setCleaningTasks([]);
    } finally {
      setCleaningLoading(false);
    }
  }, [resolveAuthToken, shiftId, state?.shift?.shift_type]);

  const loadSalesContext = useCallback(async () => {
    if (!state) return;
    const businessDate = getCstDateKey(state.shift.planned_start_at);
    if (!businessDate) return;
    const authToken = await resolveAuthToken();
    if (!authToken) return;

    setSalesContextLoading(true);
    setSalesContextErr(null);
    try {
      const query = new URLSearchParams({
        storeId: state.store.id,
        businessDate,
        shiftType: state.shift.shift_type,
      });
      const res = await fetch(`/api/sales/context?${query.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load sales context.");
      setSalesContext({
        salesTrackingEnabled: Boolean(json?.salesTrackingEnabled),
        priorXReportCents: typeof json?.priorXReportCents === "number" ? json.priorXReportCents : null,
        isRolloverNight: Boolean(json?.isRolloverNight),
        pendingRollover: Boolean(json?.pendingRollover),
        pendingRolloverDate: typeof json?.pendingRolloverDate === "string" ? json.pendingRolloverDate : null,
        closerEntryExists: Boolean(json?.closerEntryExists),
        currentCloserEntryExists: Boolean(json?.currentCloserEntryExists),
        closeEntryExists: Boolean(json?.closeEntryExists),
      });
    } catch (e: unknown) {
      setSalesContextErr(e instanceof Error ? e.message : "Failed to load sales context.");
    } finally {
      setSalesContextLoading(false);
    }
  }, [resolveAuthToken, state]);

  useEffect(() => {
    let alive = true;
    const loadKey = `${shiftId}|${qrToken}`;
    if (!authBootstrapped) {
      return () => {
        alive = false;
      };
    }

    if (initialLoadKeyRef.current === loadKey) {
      return () => {
        alive = false;
      };
    }

    (async () => {
      try {
        setErr(null);
        setLoading(true);
        const loaded = await reloadShift();
        if (loaded) {
          initialLoadKeyRef.current = loadKey;
        } else if (alive) {
          // If no auth token/session was available, show explicit guidance instead of "No data".
          setErr("Authentication required. Please re-open this shift from the clock screen.");
          initialLoadKeyRef.current = null;
        }
      } catch (e: unknown) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load shift.");
        initialLoadKeyRef.current = null;
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [authBootstrapped, reloadShift, qrToken, shiftId]);

  useEffect(() => {
    if (!state?.shift?.id) return;
    void loadCleaningTasks();
  }, [state?.shift?.id, loadCleaningTasks]);

  useEffect(() => {
    if (!state?.shift?.shift_type) return;
    setShiftTypeDraft(state.shift.shift_type);
  }, [state?.shift?.shift_type]);

  useEffect(() => {
    if (!authBootstrapped || !state?.shift?.id) return;
    void loadSalesContext();
  }, [authBootstrapped, state?.shift?.id, loadSalesContext]);

  useEffect(() => {
    if (!authBootstrapped) return;
    void loadNotifications();
  }, [authBootstrapped, loadNotifications]);

  useEffect(() => {
    if (!salesContext) return;
    if (typeof salesContext.priorXReportCents === "number") {
      setCloseCheckpointPriorX((salesContext.priorXReportCents / 100).toFixed(2));
    }
  }, [salesContext]);

  const shiftType = state?.shift.shift_type;
  const shiftBusinessDate = state?.shift?.planned_start_at ? getCstDateKey(state.shift.planned_start_at) : null;
  const currentCstDateKey = getCstDateKey(new Date().toISOString());
  const isAfterBusinessDateMidnight = Boolean(
    shiftBusinessDate &&
    currentCstDateKey &&
    currentCstDateKey !== shiftBusinessDate
  );
  const safeCloseoutToken = managerAccessToken ?? pinToken;
  const splitSafeCloseoutFromClockoutFlow = Boolean(
    (shiftType === "close" || shiftType === "double") &&
    salesContext?.salesTrackingEnabled &&
    salesContext?.isRolloverNight &&
    isAfterBusinessDateMidnight
  );

  const safeCloseout = useSafeCloseout({
    storeId: state?.store?.id ?? null,
    shiftId,
    businessDate: shiftBusinessDate,
    authToken: safeCloseoutToken,
    canUseSafeCloseout: shiftType === "close" || shiftType === "double",
    splitFromClockoutFlow: splitSafeCloseoutFromClockoutFlow,
  });

  const requiresSafeCloseoutBeforeClockOut = Boolean(
    (shiftType === "close" || shiftType === "double") &&
    safeCloseout.isEnabled &&
    !safeCloseout.isPassed
  );
  const safeCloseoutWindowReason = safeCloseout.context?.window?.reason ?? null;
  const [safeCloseoutNowTick, setSafeCloseoutNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!safeCloseout.context?.window?.allowedFromIso) return;
    const timer = window.setInterval(() => setSafeCloseoutNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [safeCloseout.context?.window?.allowedFromIso]);
  const safeCloseoutUnlockCountdown = useMemo(() => {
    const unlockIso = safeCloseout.context?.window?.allowedFromIso;
    if (!unlockIso) return null;
    const unlockAt = new Date(unlockIso).getTime();
    if (!Number.isFinite(unlockAt)) return null;
    const remainingMs = unlockAt - safeCloseoutNowTick;
    if (remainingMs <= 0) return null;
    const totalMinutes = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }, [safeCloseout.context?.window?.allowedFromIso, safeCloseoutNowTick]);

  useEffect(() => {
    if (!safeCloseoutFlash) return;
    const timer = window.setTimeout(() => setSafeCloseoutFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [safeCloseoutFlash]);

  // Check if changeover count already exists (for double shifts)
  const hasChangeover = useMemo(() => {
    return (state?.counts || []).some(c => c.count_type === "changeover");
  }, [state]);
  const hasStartDrawer = useMemo(() => {
    return (state?.counts || []).some(c => c.count_type === "start");
  }, [state]);
  const requiresStartDrawerCapture = Boolean(
    state &&
      !state.shift.ended_at &&
      state.shift.shift_type !== "other" &&
      !hasStartDrawer
  );

  // Get all required checklist group keys
  const requiredGroupKeys = useMemo(() => {
    return (state?.checklistGroups || [])
      .filter(g => g.required)
      .map(g => g.norm);
  }, [state]);

  // Count remaining required items not yet completed
  const remainingRequired = useMemo(() => {
    return requiredGroupKeys.filter(k => !done.has(k)).length;
  }, [requiredGroupKeys, done]);
  const checklistTotalCount = useMemo(() => (state?.checklistGroups || []).length, [state]);
  const checklistCompletedCount = useMemo(() => {
    return (state?.checklistGroups || []).filter(group => done.has(group.norm)).length;
  }, [state, done]);
  const checklistIncompleteCount = checklistTotalCount - checklistCompletedCount;

  // Tasks that haven't been completed yet
  const pendingTasks = useMemo(() => {
    return (state?.assignments || []).filter(a => a.type === "task" && !a.completed_at);
  }, [state]);
  const legacyPendingMessages = useMemo(() => {
    return (state?.assignments || []).filter(a => a.type === "message" && !a.acknowledged_at);
  }, [state]);
  const unreadManagerNotifications = useMemo(() => {
    return pendingNotifications.filter(
      notification => notification.notification_type === "manager_message" && !notification.read_at
    );
  }, [pendingNotifications]);
  const clockOutBlockCopy = useMemo(() => {
    const blockers: string[] = [];

    if (pendingTasks.length > 0) {
      blockers.push(`complete ${pendingTasks.length} task${pendingTasks.length === 1 ? "" : "s"}`);
    }
    if (unreadManagerNotifications.length > 0) {
      blockers.push(
        `dismiss ${unreadManagerNotifications.length} unread manager notification${
          unreadManagerNotifications.length === 1 ? "" : "s"
        }`
      );
    }
    if (legacyPendingMessages.length > 0) {
      blockers.push(
        `acknowledge ${legacyPendingMessages.length} legacy manager message${
          legacyPendingMessages.length === 1 ? "" : "s"
        }`
      );
    }
    if (notificationsErr) {
      blockers.push("reload notifications");
    }

    return blockers.length > 0 ? `Please ${blockers.join(" and ")} before clocking out.` : null;
  }, [legacyPendingMessages, notificationsErr, pendingTasks, unreadManagerNotifications]);

  const cleaningCompletedCount = useMemo(() => {
    return cleaningTasks.filter(task => task.status === "completed").length;
  }, [cleaningTasks]);
  const cleaningIncompleteCount = useMemo(() => {
    return cleaningTasks.length - cleaningCompletedCount;
  }, [cleaningTasks, cleaningCompletedCount]);
  const cleaningSkippedCount = useMemo(() => {
    return cleaningTasks.filter(task => task.status === "skipped").length;
  }, [cleaningTasks]);

  async function completeCleaningTask(task: CleaningTaskRow) {
    setCleaningErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setCleaningErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }
    const res = await fetch("/api/cleaning/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        shiftId,
        scheduleId: task.schedule_id,
        cleaningTaskId: task.cleaning_task_id,
        cleaningShiftType: task.cleaning_shift_type,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setCleaningErr(json?.error || "Failed to complete cleaning task.");
      return;
    }
    await loadCleaningTasks();
  }

  async function skipCleaningTask(task: CleaningTaskRow, reason: string) {
    setCleaningErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setCleaningErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return false;
    }
    const res = await fetch("/api/cleaning/skip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        shiftId,
        scheduleId: task.schedule_id,
        cleaningTaskId: task.cleaning_task_id,
        cleaningShiftType: task.cleaning_shift_type,
        reason,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setCleaningErr(json?.error || "Failed to skip cleaning task.");
      return false;
    }
    await loadCleaningTasks();
    return true;
  }

  const endNote = useMemo(() => {
    return (state?.counts || []).find(c => c.count_type === "end")?.note ?? null;
  }, [state]);

  /**
   * Mark a delivered task assignment complete and update local state optimistically.
   */
  async function completeTaskAssignment(assignmentId: string) {
    setErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }
    const res = await fetch(`/api/shift/${shiftId}/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ action: "complete" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(json?.error || "Failed to update assignment.");
      return;
    }
    // Optimistic update
    setState(prev => {
      if (!prev) return prev;
      const nextAssignments = (prev.assignments || []).map(a => {
        if (a.id !== assignmentId) return a;
        return { ...a, completed_at: new Date().toISOString() };
      });
      return { ...prev, assignments: nextAssignments };
    });
  }

  async function acknowledgeLegacyMessage(assignmentId: string) {
    setErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }
    const res = await fetch(`/api/shift/${shiftId}/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ action: "ack" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(json?.error || "Failed to acknowledge message.");
      return;
    }

    setState(prev => {
      if (!prev) return prev;
      const nextAssignments = (prev.assignments || []).map(a => {
        if (a.id !== assignmentId) return a;
        return { ...a, acknowledged_at: new Date().toISOString() };
      });
      return { ...prev, assignments: nextAssignments };
    });
  }

  async function dismissNotification(notificationId: string) {
    setNotificationsErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setNotificationsErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }

    setDismissingNotificationId(notificationId);
    try {
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ dismiss: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotificationsErr(json?.error || "Failed to dismiss notification.");
        return;
      }

      setPendingNotifications(prev => prev.filter(notification => notification.id !== notificationId));
    } finally {
      setDismissingNotificationId(null);
    }
  }

  /**
   * Mark a checklist group as complete.
   * Uses optimistic UI, rolls back on failure.
   */
  async function checkGroup(group: { norm: string; itemIds: string[] }) {
    if (done.has(group.norm)) return;

    setErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }
    setDone(prev => new Set(prev).add(group.norm)); // optimistic

    const res = await fetch("/api/checklist/check-item", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ shiftId, qrToken, itemIds: group.itemIds }),
    });

    const json = await res.json();

    if (!res.ok) {
      // Rollback optimistic update
      setDone(prev => {
        const copy = new Set(prev);
        copy.delete(group.norm);
        return copy;
      });
      setErr(json?.error || "Failed to check item group.");
      return;
    }

    // If you want strict truth instead of optimistic UI, uncomment:
    // await reloadShift();
  }

  async function submitCloseCheckpoint() {
    if (!state) return;
    setCloseCheckpointErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setCloseCheckpointErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }

    const priorXCents = parseMoneyInputToCents(closeCheckpointPriorX);
    const zCents = parseMoneyInputToCents(closeCheckpointZ);
    // Double shifts have no separate opener, so prior X is optional (backend defaults to 0).
    const effectivePriorXCents = priorXCents ?? (shiftType === "double" ? 0 : null);
    if (effectivePriorXCents == null || zCents == null) {
      setCloseCheckpointErr("Enter valid non-negative sales amounts.");
      return;
    }
    setCloseCheckpointSaving(true);
    try {
      const res = await fetch("/api/sales/close-checkpoint", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          shiftId,
          salesPriorXCents: effectivePriorXCents,
          salesZReportCents: zCents,
          salesConfirmed: closeCheckpointNeedsConfirm ? closeCheckpointConfirm : false,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json?.requiresSalesConfirm) {
          setCloseCheckpointNeedsConfirm(true);
          setCloseCheckpointIsCeiling(Boolean(json?.isSanityCeiling));
          setCloseCheckpointVarianceCents(typeof json?.salesVarianceCents === "number" ? json.salesVarianceCents : null);
          return;
        }
        throw new Error(json?.error || "Failed to save 10pm sales.");
      }

      setCloseCheckpointNeedsConfirm(false);
      setCloseCheckpointConfirm(false);
      setCloseCheckpointIsCeiling(false);
      setCloseCheckpointVarianceCents(null);
      setCloseCheckpointErr(null);
      await loadSalesContext();
    } catch (e: unknown) {
      setCloseCheckpointErr(e instanceof Error ? e.message : "Failed to save 10pm sales.");
    } finally {
      setCloseCheckpointSaving(false);
    }
  }

  const reuseLabel = reusedStartedAt
    ? formatDateTime(reusedStartedAt)
    : "an earlier time";

  return (
    <div className="bento-shell">
      <HomeHeader
        isManager={managerSession}
        isAuthenticated={managerSession || Boolean(pinToken)}
        profileId={profileId ?? null}
      />
      <div className="px-4 py-4 pb-28 md:px-6">
        <div className="shift-detail-shell">
          <div>
            <h1 className="shift-detail-title">Shift</h1>
            <p className="shift-detail-subtitle">Live shift actions, checklist, and closeout.</p>
          </div>

        {err ? (
          <div className="shift-flash shift-flash-error">{err}</div>
        ) : loading ? (
          <div className="space-y-4">
            <div className="h-4 bg-slate-800 rounded w-1/2 animate-pulse mb-2" />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : !state ? (
          <div className="shift-empty-state">No data found for this shift.</div>
        ) : (
          <>
        {/* Banner shown when redirected to existing open shift */}
        {showReuseBanner && (
          <div className="shift-banner">
            Redirected to currently open shift started at {reuseLabel}.
            <button
              className="ml-3 underline underline-offset-4"
              onClick={() => setShowReuseBanner(false)}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="shift-info-panel">
          <div className="shift-info-topline">
            <span className="shift-info-chip">Store <strong>{state.store.name}</strong></span>
            <span className="shift-info-chip">Employee <strong>{state.employee || "Unknown"}</strong></span>
            <span className="shift-info-chip">Type <strong>{shiftTypeDraft ?? state.shift.shift_type}</strong></span>
          </div>
          <div className="shift-info-controls">
            <div className="shift-field-row">
              <label className="shift-field-label">Shift Type</label>
              <div className="shift-inline-actions">
            <select
              className="shift-field-select min-w-[180px]"
              value={shiftTypeDraft ?? state.shift.shift_type}
              onChange={(e) => {
                setShiftTypeDraft(e.target.value as ShiftType);
                setShiftTypeErr(null);
              }}
              disabled={shiftTypeSaving}
            >
              <option value="open">Open</option>
              <option value="close">Close</option>
              <option value="double">Double</option>
              <option value="other">Other</option>
            </select>
            <button
              className="shift-button-secondary disabled:opacity-50"
              disabled={
                shiftTypeSaving ||
                !shiftTypeDraft ||
                shiftTypeDraft === state.shift.shift_type
              }
              onClick={async () => {
                if (!shiftTypeDraft || shiftTypeDraft === state.shift.shift_type) return;
                setShiftTypeErr(null);
                setShiftTypeSaving(true);
                try {
                  const authToken = await resolveAuthToken();
                  if (!authToken) throw new Error("Session expired. Please refresh.");
                  const res = await fetch(`/api/shift/${shiftId}/shift-type`, {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({ shiftType: shiftTypeDraft }),
                  });
                  const json = await res.json();
                  if (!res.ok) throw new Error(json?.error || "Failed to update shift type.");
                  await reloadShift();
                } catch (e: unknown) {
                  setShiftTypeErr(
                    e instanceof Error ? e.message : "Failed to update shift type."
                  );
                } finally {
                  setShiftTypeSaving(false);
                }
              }}
            >
              {shiftTypeSaving ? "Saving..." : "Save"}
            </button>
              </div>
            </div>
          </div>
          {shiftTypeErr && (
            <div className="shift-flash shift-flash-warn text-xs">
              {shiftTypeErr}
            </div>
          )}
        </div>
        {requiresStartDrawerCapture && (
          <StartDrawerCapturePanel
            shiftId={shiftId}
            expectedCents={state.store.expected_drawer_cents}
            resolveAuthToken={resolveAuthToken}
            managerSession={managerSession}
            onDone={reloadShift}
          />
        )}

        {salesContextLoading && (
          <div className="shift-note text-xs">Loading sales rollover context...</div>
        )}
        {salesContextErr && (
          <div className="shift-flash shift-flash-warn text-sm">
            {salesContextErr}
          </div>
        )}
        {(shiftType === "close" || shiftType === "double") && salesContext?.isRolloverNight && (
          <div className="shift-status-panel shift-status-panel-cyan">
            <div className="shift-status-title mb-3">Rollover Status</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`px-2 py-1 rounded-full border ${salesContext.closeEntryExists ? "border-emerald-400/50 text-emerald-300" : "border-amber-400/50 text-amber-300"}`}>
                10pm sales: {salesContext.closeEntryExists ? "saved" : "pending"}
              </span>
              <span className={`px-2 py-1 rounded-full border ${salesContext.currentCloserEntryExists ? "border-emerald-400/50 text-emerald-300" : "border-amber-400/50 text-amber-300"}`}>
                Midnight report: {salesContext.currentCloserEntryExists ? "saved" : "pending"}
              </span>
            </div>
          </div>
        )}
        {safeCloseoutFlash && (
          <div
            className={`shift-flash text-sm ${
              safeCloseoutFlash.tone === "success"
                ? "shift-flash-success"
                : safeCloseoutFlash.tone === "warn"
                  ? "shift-flash-warn"
                  : "shift-flash-error"
            }`}
          >
            {safeCloseoutFlash.message}
          </div>
        )}
        {(shiftType === "close" || shiftType === "double") && (
          <div className="shift-status-panel shift-status-panel-cyan space-y-3">
            <div className="shift-status-header">
              <div>
                <div className="shift-status-title">Safe Ledger Closeout</div>
                <div className="shift-status-copy">Finish the end-of-day ledger flow before you leave.</div>
              </div>
              <span
                className={`shift-status-pill ${
                  safeCloseout.isPassed
                    ? "shift-status-pill-success"
                    : safeCloseout.isEnabled
                      ? "shift-status-pill-warn"
                      : "shift-status-pill-muted"
                }`}
              >
                {safeCloseout.isPassed ? "✅ Passed" : safeCloseout.isEnabled ? "⚠️ Pending" : "Not enabled"}
              </span>
            </div>
            {safeCloseout.loading && (
              <div className="shift-note text-xs">Loading safe closeout context...</div>
            )}
            {safeCloseout.error && (
              <div className="shift-flash shift-flash-error text-xs">❌ {safeCloseout.error}</div>
            )}
            {safeCloseoutWindowReason && (
              <div className="shift-flash shift-flash-warn text-xs">
                NOTE: Safe closeout is for end-of-day drawer closeout only. {safeCloseoutWindowReason}
                {safeCloseoutUnlockCountdown && (
                  <div className="mt-1 font-semibold">Unlocks in: {safeCloseoutUnlockCountdown}</div>
                )}
              </div>
            )}
            {safeCloseout.isEnabled && splitSafeCloseoutFromClockoutFlow && (
              <div className="text-xs text-cyan-200">
                Friday/Saturday late-night mode: safe closeout is entered separately before clock out.
              </div>
            )}
            {safeCloseout.isEnabled && safeCloseout.hasDraft && !safeCloseout.isPassed && (
              <div className="text-xs text-amber-200">
                Draft in progress. Continue to finish before leaving.
              </div>
            )}
            <div className="flex justify-end">
              <button
                className="shift-button disabled:opacity-50"
                disabled={!safeCloseout.isEnabled || safeCloseout.loading || Boolean(safeCloseoutWindowReason)}
                onClick={() => safeCloseout.openWizard("task")}
              >
                {safeCloseout.hasDraft && !safeCloseout.isPassed ? "Continue Safe Closeout" : "Perform Safe Closeout"}
              </button>
            </div>
          </div>
        )}
        {state.shift.shift_type === "open" && salesContext?.pendingRollover && salesContext.pendingRolloverDate && (
          <RolloverEntryCard
            storeId={state.store.id}
            previousBusinessDate={salesContext.pendingRolloverDate}
            resolveAuthToken={resolveAuthToken}
            onSubmitted={() => {
              void loadSalesContext();
            }}
          />
        )}

        {endNote && (
          <div className="shift-note">
            End note: <b>{endNote}</b>
          </div>
        )}

        {/* Double shifts require mid-shift drawer count */}
        {shiftType === "double" && (
          <ChangeoverPanel
            shiftId={shiftId}
            qrToken={qrToken}
            expectedCents={state.store.expected_drawer_cents}
            alreadyConfirmed={hasChangeover}
            resolveAuthToken={resolveAuthToken}
            onDone={reloadShift}
          />
        )}

        {/* Checklist section - not shown for "other" shift types */}
        {shiftType !== "other" && (
          <div className="employee-panel">
            <button
              type="button"
              className="shift-section-toggle"
              onClick={() => setChecklistExpanded(prev => !prev)}
            >
              <div className="shift-section-toggle-copy">
                <div className="shift-status-title">Opening Checklist</div>
                <div className="shift-section-meta">
                  Complete: <b>{checklistCompletedCount}</b> · Incomplete: <b>{checklistIncompleteCount}</b>
                </div>
              </div>
              <span className="shift-section-link">{checklistExpanded ? "Hide" : "Show"}</span>
            </button>

            {checklistExpanded && (
              <div className="mt-3 space-y-2">
                {(state.checklistGroups || []).length === 0 ? (
                  <div className="shift-empty-state">No checklist items found.</div>
                ) : (
                  <ul className="shift-item-list">
                    {state.checklistGroups.map(g => {
                      const isDone = done.has(g.norm);
                      return (
                        <li key={g.norm} className="shift-item-row">
                          <div>
                            <div className="shift-item-title">{g.label}</div>
                            <div className="shift-item-meta">{g.required ? "Required" : "Optional"}</div>
                          </div>
                          <button
                            onClick={() => checkGroup(g)}
                            disabled={isDone || requiresStartDrawerCapture}
                            className={isDone ? "shift-button-secondary" : "shift-button"}
                          >
                            {isDone ? "Done" : "Check"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="shift-section-meta">
                  {remainingRequired > 0
                    ? `Finish ${remainingRequired} required task${remainingRequired === 1 ? "" : "s"} before clock out.`
                    : "All required tasks done."}
                </div>
              </div>
            )}
          </div>
        )}

        {shiftType !== "other" &&
          (shiftType === "close" || shiftType === "double") &&
          salesContext?.salesTrackingEnabled &&
          salesContext.isRolloverNight &&
          !salesContext.closeEntryExists && (
            <div className="shift-status-panel shift-status-panel-cyan space-y-3">
              <div className="shift-status-title">10:00 PM Sales Checkpoint</div>
              <div className="shift-status-copy">
                Enter Z report and prior X at 10pm. Midnight rollover is entered at clock out.
              </div>
              <div className="space-y-2">
                <label className="shift-field-label">Prior X Report ($)</label>
                <input
                  className="shift-field-input"
                  inputMode="decimal"
                  value={closeCheckpointPriorX}
                  onChange={e => setCloseCheckpointPriorX(e.target.value)}
                  placeholder="0.00"
                />
                <label className="shift-field-label">Z Report Total ($)</label>
                <input
                  className="shift-field-input"
                  inputMode="decimal"
                  value={closeCheckpointZ}
                  onChange={e => setCloseCheckpointZ(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              {closeCheckpointNeedsConfirm && (
                <label className="flex items-center gap-2 text-sm text-[var(--text-strong)]">
                  <input
                    type="checkbox"
                    checked={closeCheckpointConfirm}
                    onChange={e => setCloseCheckpointConfirm(e.target.checked)}
                  />
                  {closeCheckpointIsCeiling
                    ? "This Z report total is unusually large — I have double-checked and it is correct"
                    : `I confirm these sales numbers are correct${closeCheckpointVarianceCents != null ? ` (variance $${(closeCheckpointVarianceCents / 100).toFixed(2)})` : ""}`}
                </label>
              )}

              {closeCheckpointErr && (
                <div className="shift-flash shift-flash-error text-sm">
                  {closeCheckpointErr}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  className="shift-button disabled:opacity-50"
                  disabled={closeCheckpointSaving || (closeCheckpointNeedsConfirm && !closeCheckpointConfirm)}
                  onClick={() => {
                    void submitCloseCheckpoint();
                  }}
                >
                  {closeCheckpointSaving ? "Saving..." : "Save 10pm Sales"}
                </button>
              </div>
            </div>
          )}

        {/* Cleaning tasks section (separate from operational checklist) */}
        {shiftType !== "other" && (
          <div className="employee-panel">
            <button
              type="button"
              className="shift-section-toggle"
              onClick={() => setCleaningExpanded(prev => !prev)}
            >
              <div className="shift-section-toggle-copy">
                <div className="flex items-center gap-2">
                  <span className="shift-status-title">Cleaning Tasks</span>
                  {cleaningSkippedCount > 0 && (
                    <span className="shift-status-pill shift-status-pill-warn">
                      Skipped: {cleaningSkippedCount}
                    </span>
                  )}
                </div>
                <div className="shift-section-meta">
                  Complete: <b>{cleaningCompletedCount}</b> · Incomplete: <b>{cleaningIncompleteCount}</b>
                </div>
              </div>
              <span className="shift-section-link">{cleaningExpanded ? "Hide" : "Show"}</span>
            </button>

            {cleaningExpanded && (
              <div className="mt-3 space-y-2">
                <div className="shift-flash shift-flash-warn text-xs">
                  Cleaning tasks can be skipped with a reason. Skips notify managers but do not block clock out.
                </div>
                <div className="shift-flash shift-flash-error text-xs">
                  Completion is mandatory: failure to complete these tasks, or marking them complete when they were not done, may result in disciplinary action up to and including termination. If a task cannot be completed, document the reason in the app so it can be reviewed and approved by a manager.
                </div>

                {cleaningLoading && <div className="shift-empty-state">Loading cleaning tasks...</div>}
                {!cleaningLoading && cleaningTasks.length === 0 && (
                  <div className="shift-empty-state">No cleaning tasks scheduled for this shift.</div>
                )}

                {!cleaningLoading && cleaningTasks.length > 0 && (
                  <>
                    <ul className="shift-item-list">
                      {cleaningTasks.map(task => {
                        const isCompleted = task.status === "completed";
                        const isSkipped = task.status === "skipped";
                        return (
                          <li key={task.schedule_id} className="shift-item-row !items-start">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="shift-item-title">{task.task_name}</div>
                                <div className="shift-item-meta">
                                  {task.cleaning_shift_type.toUpperCase()} · {task.task_category ?? "cleaning"}
                                </div>
                              </div>
                              <div className="shift-item-status">
                                {isCompleted && <span className="shift-item-status-complete">Completed</span>}
                                {isSkipped && <span className="shift-item-status-skipped">Skipped</span>}
                                {!isCompleted && !isSkipped && <span>Pending</span>}
                              </div>
                            </div>

                            {task.skipped_reason && (
                              <div className="shift-flash shift-flash-warn text-xs">
                                Reason: {task.skipped_reason}
                              </div>
                            )}

                            <div className="shift-item-actions">
                              <button
                                className={isCompleted ? "shift-button-secondary" : "shift-button"}
                                disabled={isCompleted || requiresStartDrawerCapture}
                                onClick={() => void completeCleaningTask(task)}
                              >
                                {isCompleted ? "Done" : "Complete"}
                              </button>
                              <button
                                className="shift-button-secondary disabled:opacity-50"
                                disabled={isCompleted || requiresStartDrawerCapture}
                                onClick={() => setSkipModalTask(task)}
                              >
                                Skip
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="shift-section-meta">
                      {cleaningCompletedCount} of {cleaningTasks.length} tasks completed
                    </div>
                  </>
                )}

                {cleaningErr && <div className="shift-flash shift-flash-error text-sm">{cleaningErr}</div>}
              </div>
            )}
          </div>
        )}

        {/* Notifications and tasks section */}
        {(pendingNotifications.length > 0 ||
          pendingTasks.length > 0 ||
          legacyPendingMessages.length > 0 ||
          notificationsLoading ||
          notificationsErr) && (
          <div className="employee-panel space-y-3">
            <div className="space-y-2">
              <div className="shift-status-title">Notifications</div>
              {notificationsLoading ? (
                <div className="shift-section-meta">Loading notifications...</div>
              ) : pendingNotifications.length === 0 ? (
                <div className="shift-empty-state">No notifications right now.</div>
              ) : (
                <div className="space-y-2">
                  {pendingNotifications.map(notification => {
                    const isUnreadManagerMessage =
                      notification.notification_type === "manager_message" && !notification.read_at;

                    return (
                      <div key={notification.id} className="shift-note flex items-start justify-between gap-3 text-sm">
                        <div className="min-w-0 space-y-1">
                          <div className="shift-item-title">{notification.title}</div>
                          <div className="whitespace-pre-wrap">
                            {notification.body || "No additional details provided."}
                          </div>
                          <div className="shift-section-meta">
                            {formatDateTime(notification.created_at)}
                            {isUnreadManagerMessage ? " • Unread manager message" : ""}
                          </div>
                        </div>
                        <button
                          className="shift-button-secondary shrink-0"
                          disabled={dismissingNotificationId === notification.id}
                          onClick={() => void dismissNotification(notification.id)}
                        >
                          {dismissingNotificationId === notification.id ? "Dismissing..." : "Dismiss"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {notificationsErr && <div className="shift-flash shift-flash-error text-sm">{notificationsErr}</div>}
            </div>

            {/* Tasks require completion */}
            {pendingTasks.length > 0 && (
              <div className="space-y-2">
                <div className="shift-status-title">Tasks</div>
                <div className="space-y-2">
                  {pendingTasks.map(t => (
                    <div key={t.id} className="shift-note flex items-center justify-between gap-2 text-sm">
                      <span>{t.message}</span>
                      <button
                        className="shift-button-secondary"
                        disabled={requiresStartDrawerCapture}
                        onClick={() => completeTaskAssignment(t.id)}
                      >
                        Mark Complete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {legacyPendingMessages.length > 0 && (
              <div className="space-y-2">
                <div className="shift-status-title">Legacy Manager Messages</div>
                <div className="space-y-2">
                  {legacyPendingMessages.map(message => (
                    <label key={message.id} className="shift-note flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(message.acknowledged_at)}
                        disabled={requiresStartDrawerCapture}
                        onChange={() => void acknowledgeLegacyMessage(message.id)}
                      />
                      <span>{message.message}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {clockOutBlockCopy && (
          <div className="shift-note">
            {clockOutBlockCopy}
          </div>
        )}

        {/* Safe closeout + clock out actions */}
        <div className="sticky-cta shift-cta-bar">
          {(shiftType === "close" || shiftType === "double") && (
            <button
              className="shift-button w-full disabled:opacity-50"
              disabled={safeCloseout.loading || Boolean(safeCloseoutWindowReason)}
              onClick={() => {
                if (safeCloseoutWindowReason) {
                  setSafeCloseoutFlash({
                    tone: "warn",
                    message: `Safe closeout is for end-of-day only. ${safeCloseoutWindowReason}`,
                  });
                  return;
                }
                if (!safeCloseout.isEnabled) {
                  setSafeCloseoutFlash({
                    tone: "error",
                    message: "❌ Safe closeout is not enabled for this store yet.",
                  });
                  return;
                }
                safeCloseout.openWizard("task");
              }}
            >
              Perform Safe Closeout
            </button>
          )}
          {requiresSafeCloseoutBeforeClockOut && (
            <div className="shift-flash shift-flash-warn text-xs">
              ⚠️ Complete Safe Closeout before clocking out.
            </div>
          )}
          <button
            className="shift-button-secondary w-full disabled:opacity-50"
            disabled={
              notificationsLoading ||
              Boolean(notificationsErr) ||
              requiresStartDrawerCapture ||
              (shiftType !== "other" && remainingRequired > 0) ||
              unreadManagerNotifications.length > 0 ||
              legacyPendingMessages.length > 0 ||
              pendingTasks.length > 0 ||
              requiresSafeCloseoutBeforeClockOut
            }
            onClick={() => {
              setShowClockOut(true);
            }}
          >
            Clock Out
          </button>
        </div>

        {showClockOut && (
          <ClockOutModal
            shiftId={shiftId}
            qrToken={qrToken}
            storeId={state.store.id}
            expectedCents={state.store.expected_drawer_cents}
            storeName={state.store.name}
            shiftType={state.shift.shift_type}
            plannedStartAt={state.shift.planned_start_at}
            scheduledWindow={state.scheduledWindow ?? null}
            isOther={shiftType === "other"}
            onClose={() => setShowClockOut(false)}
            onSuccess={() => {
              router.replace("/");
            }}
            pinToken={pinToken}
            managerAccessToken={managerAccessToken}
            managerSession={managerSession}
            safeCloseoutContext={safeCloseout.context}
            safeCloseoutEnabled={safeCloseout.isEnabled}
          />
        )}
        {safeCloseout.isOpen && (
          <SafeCloseoutWizard
            open={safeCloseout.isOpen}
            mode={safeCloseout.mode}
            resolveAuthToken={resolveAuthToken}
            storeId={state.store.id}
            shiftId={shiftId}
            businessDate={shiftBusinessDate}
            context={safeCloseout.context}
            onClose={safeCloseout.closeWizard}
            onRefreshContext={safeCloseout.refresh}
            onSubmitted={(status) => {
              if (status === "pass") {
                if (safeCloseout.mode === "gate") {
                  safeCloseout.closeWizard();
                  setShowClockOut(true);
                  setSafeCloseoutFlash({
                    tone: "success",
                    message: "✅ Safe closeout passed. You can clock out now.",
                  });
                } else {
                  safeCloseout.closeWizard();
                  setSafeCloseoutFlash({
                    tone: "success",
                    message: "✅ Safe closeout submitted successfully.",
                  });
                }
                return;
              }
              if (status === "warn") {
                setSafeCloseoutFlash({
                  tone: "warn",
                  message: "⚠️ Closeout submitted with variance warning.",
                });
                return;
              }
              setSafeCloseoutFlash({
                tone: "error",
                message: "❌ Closeout failed validation. Please review and resubmit.",
              });
            }}
          />
        )}

        {skipModalTask && (
          <SkipCleaningTaskModal
            taskName={skipModalTask.task_name}
            onClose={() => setSkipModalTask(null)}
            onSubmit={async reason => {
              const ok = await skipCleaningTask(skipModalTask, reason);
              if (ok) setSkipModalTask(null);
              return ok;
            }}
          />
        )}
          </>
        )}
      </div>
    </div>
    </div>
  );
}

function SkipCleaningTaskModal({
  taskName,
  onClose,
  onSubmit,
}: {
  taskName: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 overflow-y-auto modal-under-header">
      <div className="shift-modal-shell space-y-3">
        <h2 className="shift-status-title">Skip Cleaning Task</h2>
        <div className="shift-section-meta">
          Task: <b>{taskName}</b>
        </div>
        <label className="shift-field-label">Reason (required)</label>
        <textarea
          className="shift-field-textarea"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Why are you skipping this cleaning task?"
        />
        {err && <div className="shift-flash shift-flash-error text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="shift-button-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="shift-button-danger disabled:opacity-50"
            disabled={saving}
            onClick={async () => {
              setErr(null);
              const trimmed = reason.trim();
              if (!trimmed) {
                setErr("Reason is required.");
                return;
              }
              setSaving(true);
              const ok = await onSubmit(trimmed);
              if (!ok) setErr("Failed to skip task.");
              setSaving(false);
            }}
          >
            {saving ? "Saving..." : "Confirm Skip"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StartDrawerCapturePanel({
  shiftId,
  expectedCents,
  resolveAuthToken,
  managerSession,
  onDone,
}: {
  shiftId: string;
  expectedCents: number;
  resolveAuthToken: () => Promise<string | null>;
  managerSession: boolean;
  onDone: () => Promise<boolean>;
}) {
  const [drawer, setDrawer] = useState("200");
  const [changeDrawer, setChangeDrawer] = useState("200");
  const [confirm, setConfirm] = useState(false);
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const drawerCents = Math.round(Number(drawer) * 100);
  const changeCents = Math.round(Number(changeDrawer) * 100);
  const hasValidDrawer = Number.isFinite(drawerCents) && drawerCents >= 0;
  const hasValidChange = Number.isFinite(changeCents) && changeCents >= 0;
  const outOfThreshold = hasValidDrawer ? shouldShowVarianceControls(drawerCents, expectedCents) : false;
  const changeNot200 = hasValidChange ? changeCents !== 20000 : false;
  const thresholdMsg = hasValidDrawer ? thresholdMessage(drawerCents, expectedCents) : "Enter a valid drawer count.";

  useEffect(() => {
    if (!outOfThreshold) setConfirm(false);
    if (!outOfThreshold && !changeNot200) setNotify(false);
  }, [outOfThreshold, changeNot200]);

  const canSubmit =
    !saving &&
    hasValidDrawer &&
    hasValidChange &&
    (!outOfThreshold || confirm) &&
    (!(outOfThreshold || changeNot200) || notify);

  return (
    <div className="shift-status-panel shift-status-panel-amber space-y-3">
      <div className="shift-status-title">Start Drawer</div>
      <div className="shift-status-copy">
        This must be completed before checklist/tasks/clock-out actions are unlocked.
      </div>

      <label className="shift-field-label">Beginning drawer count ($)</label>
      <input
        className="shift-field-input"
        inputMode="decimal"
        value={drawer}
        onChange={e => setDrawer(e.target.value)}
        disabled={saving}
      />

      <div className="shift-flash shift-flash-warn text-xs">{thresholdMsg}</div>

      <label className="shift-field-label">Change drawer count ($)</label>
      <input
        className="shift-field-input"
        inputMode="decimal"
        value={changeDrawer}
        onChange={e => setChangeDrawer(e.target.value)}
        disabled={saving}
      />

      {changeNot200 && (
        <div className="shift-flash shift-flash-warn text-xs">
          Change drawer should be exactly $200.00.
        </div>
      )}

      {outOfThreshold && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
          I confirm this count is correct.
        </label>
      )}

      {(outOfThreshold || changeNot200) && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
          I notified manager.
        </label>
      )}

      <label className="shift-field-label">Note (optional)</label>
      <input
        className="shift-field-input"
        value={note}
        onChange={e => setNote(e.target.value)}
        disabled={saving}
      />

      {err && (
        <div className="shift-flash shift-flash-error text-sm">{err}</div>
      )}

      <div className="flex justify-end">
        <button
          className="shift-button disabled:opacity-50"
          disabled={!canSubmit}
          onClick={async () => {
            setErr(null);
            const authToken = await resolveAuthToken();
            if (!authToken) {
              setErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
              return;
            }

            setSaving(true);
            try {
              const res = await fetch(`/api/shift/${shiftId}/start-drawer`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                  startDrawerCents: drawerCents,
                  changeDrawerCents: changeCents,
                  confirmed: outOfThreshold ? confirm : false,
                  notifiedManager: outOfThreshold || changeNot200 ? notify : false,
                  note: note.trim() || null,
                }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json?.error || "Failed to save start drawer.");
              await onDone();
            } catch (e: unknown) {
              setErr(e instanceof Error ? e.message : "Failed to save start drawer.");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving..." : "Save Start Drawer"}
        </button>
      </div>
    </div>
  );
}

/**
 * Changeover Panel - Mid-shift drawer count for double shifts
 *
 * Double shifts require a drawer count at the midpoint when one employee
 * hands off to another. This panel collects that count with variance detection.
 */
/* ------------------- ChangeoverPanel (REAL) ------------------- */
function ChangeoverPanel({
  shiftId,
  qrToken,
  expectedCents,
  alreadyConfirmed,
  resolveAuthToken,
  onDone,
}: {
  shiftId: string;
  qrToken: string;
  expectedCents: number;
  alreadyConfirmed: boolean;
  resolveAuthToken: () => Promise<string | null>;
  onDone: () => void;
}) {
  const [drawer, setDrawer] = useState("200");
  const [changeDrawer, setChangeDrawer] = useState("200");
  const [xReport, setXReport] = useState("");
  const [txnCount, setTxnCount] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = Math.round(Number(drawer) * 100);
  const changeCents = Math.round(Number(changeDrawer) * 100);
  const xReportCents = xReport !== "" && Number.isFinite(Number(xReport)) && Number(xReport) >= 0
    ? Math.round(Number(xReport) * 100)
    : null;
  const parsedTxnCount = txnCount !== "" && /^\d+$/.test(txnCount.trim()) && Number(txnCount) > 0
    ? Number(txnCount)
    : null;
  const hasValidChange = Number.isFinite(changeCents) && changeCents >= 0;
  const changeNot200 = hasValidChange && changeCents !== 20000;
  const msg = Number.isFinite(cents) ? thresholdMessage(cents, expectedCents) : null;
  const outOfThreshold = shouldShowVarianceControls(cents, expectedCents);

  // If you go back into normal range, wipe the extra acknowledgements.
  useEffect(() => {
    if (!outOfThreshold) {
      setConfirm(false);
      setNotify(false);
    }
  }, [outOfThreshold]);

  if (alreadyConfirmed) {
    return <div className="shift-banner">Changeover drawer count recorded.</div>;
  }

  return (
    <div className="shift-status-panel shift-status-panel-amber space-y-3">
      <div className="shift-status-title">Mid-shift Changeover</div>

      <label className="shift-field-label">X Report Total ($) <span className="text-gray-500 normal-case tracking-normal">(net register total at changeover)</span></label>
      <input
        className="shift-field-input"
        inputMode="decimal"
        placeholder="0.00"
        value={xReport}
        onChange={e => setXReport(e.target.value)}
      />

      <label className="shift-field-label">Drawer count ($)</label>
      <input
        className="shift-field-input"
        inputMode="decimal"
        value={drawer}
        onChange={e => setDrawer(e.target.value)}
      />

      <label className="shift-field-label">Change drawer count ($)</label>
      <input
        className="shift-field-input"
        inputMode="decimal"
        value={changeDrawer}
        onChange={e => setChangeDrawer(e.target.value)}
      />

      {changeNot200 && (
        <div className="shift-flash shift-flash-warn text-sm">
          Change drawer should be exactly $200.00.
        </div>
      )}

      <label className="shift-field-label">Transaction count <span className="text-gray-500 normal-case tracking-normal">(# of sales rung — AM half)</span></label>
      <input
        className="shift-field-input"
        inputMode="numeric"
        placeholder="e.g. 42"
        value={txnCount}
        onChange={e => setTxnCount(e.target.value)}
      />

      {msg && (
        <div className="shift-flash shift-flash-warn text-sm">
          {msg}
        </div>
      )}

      {/* Variance confirmation - only shown when drawer is out of threshold */}
      {outOfThreshold && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
            I confirm this count is correct (required when outside threshold)
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
            I notified manager (optional)
          </label>
        </>
      )}

      <label className="shift-field-label">Note (optional)</label>
      <input className="shift-field-input" value={note} onChange={e => setNote(e.target.value)} />

      {err && <div className="shift-flash shift-flash-error text-sm">{err}</div>}

      <button
        className="shift-button disabled:opacity-50"
        disabled={saving || !Number.isFinite(cents) || !hasValidChange || (outOfThreshold && !confirm)}
        onClick={async () => {
          setErr(null);
          setSaving(true);
          try {
            const authToken = await resolveAuthToken();
            if (!authToken) throw new Error("Session expired. Please refresh and try again.");
            const res = await fetch("/api/confirm-changeover", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({
                qrToken,
                shiftId,
                drawerCents: cents,
                confirmed: outOfThreshold ? confirm : false,
                notifiedManager: outOfThreshold ? notify : false,
                note: note || null,
                midXReportCents: xReportCents,
                openTransactionCount: parsedTxnCount,
                changeCountCents: changeCents,
              }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || "Failed to confirm changeover.");
            onDone();
          } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : "Failed to confirm changeover.");
          } finally {
            setSaving(false);
          }
        }}
      >
        Save Changeover Count
      </button>

      {outOfThreshold && !confirm && (
        <div className="text-xs text-gray-600">
          Confirmation is required when the drawer is outside the allowed threshold.
        </div>
      )}
    </div>
  );
}

/**
 * Clock Out Modal - End shift confirmation dialog
 *
 * Collects end time and drawer count, validates against thresholds,
 * and requires explicit confirmation to prevent accidental clock-outs.
 */
/* ------------------- ClockOutModal (REAL) ------------------- */
function ClockOutModal({
  shiftId,
  qrToken,
  storeId,
  expectedCents,
  storeName,
  shiftType,
  plannedStartAt,
  scheduledWindow,
  isOther,
  onClose,
  onSuccess,
  pinToken,
  managerAccessToken,
  managerSession,
  safeCloseoutContext,
  safeCloseoutEnabled,
}: {
  shiftId: string;
  qrToken: string;
  storeId: string;
  expectedCents: number;
  storeName: string;
  shiftType: ShiftType;
  plannedStartAt: string;
  scheduledWindow: ShiftState["scheduledWindow"];
  isOther: boolean;
  pinToken: string | null;
  managerAccessToken: string | null;
  managerSession: boolean;
  safeCloseoutContext: SafeCloseoutContext | null;
  safeCloseoutEnabled: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const scheduledEndLocal = useMemo(
    () => buildScheduledEndLocalInput(scheduledWindow?.shift_date, scheduledWindow?.scheduled_start, scheduledWindow?.scheduled_end),
    [scheduledWindow]
  );
  const [endLocal, setEndLocal] = useState(() => scheduledEndLocal ?? toLocalInputValue());
  const [drawer, setDrawer] = useState("200");
  const [changeDrawer, setChangeDrawer] = useState("200");
  const [confirm, setConfirm] = useState(false);
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState("");
  const [doubleCheck, setDoubleCheck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clockWindowModal, setClockWindowModal] = useState<{ open: boolean; label: string }>({
    open: false,
    label: "",
  });
  const [salesTrackingEnabled, setSalesTrackingEnabled] = useState(false);
  const [salesContextLoading, setSalesContextLoading] = useState(false);
  const [salesXReport, setSalesXReport] = useState("");
  const [salesZReport, setSalesZReport] = useState("");
  const [salesPriorX, setSalesPriorX] = useState("");
  const [salesNeedsConfirm, setSalesNeedsConfirm] = useState(false);
  const [salesConfirmChecked, setSalesConfirmChecked] = useState(false);
  const [salesVarianceCents, setSalesVarianceCents] = useState<number | null>(null);
  const [isRolloverNight, setIsRolloverNight] = useState(false);
  const [showRolloverPrompt, setShowRolloverPrompt] = useState(false);
  const [rolloverAmount, setRolloverAmount] = useState("");
  const [rolloverSaving, setRolloverSaving] = useState(false);
  const [rolloverErr, setRolloverErr] = useState<string | null>(null);
  const [rolloverMismatchNeedsConfirm, setRolloverMismatchNeedsConfirm] = useState(false);
  const [openTransactionCount, setOpenTransactionCount] = useState("");
  const [closeTransactionCount, setCloseTransactionCount] = useState("");

  const storeKey = toStoreKey(storeName);

  function triggerClockWindowModal(label: string) {
    playAlarm();
    setClockWindowModal({ open: true, label });
  }

  const cents = Math.round(Number(drawer) * 100);
  const changeCents = Math.round(Number(changeDrawer) * 100);
  const hasValidDrawer = Number.isFinite(cents);
  const hasValidChange = Number.isFinite(changeCents);
  const msg = hasValidDrawer ? thresholdMessage(cents, expectedCents) : null;
  const outOfThreshold = hasValidDrawer ? shouldShowVarianceControls(cents, expectedCents) : false;
  const changeNot200 = hasValidChange ? changeCents !== 20000 : false;

  const authToken = managerSession ? managerAccessToken : pinToken;
  const businessDate = getCstDateKey(plannedStartAt);

  useEffect(() => {
    setEndLocal(scheduledEndLocal ?? toLocalInputValue());
  }, [scheduledEndLocal, shiftId]);

  useEffect(() => {
    let alive = true;
    const loadSalesContext = async () => {
      if (!authToken || !businessDate || isOther) return;
      setSalesContextLoading(true);
      try {
        const query = new URLSearchParams({
          storeId,
          businessDate,
          shiftType,
        });
        const res = await fetch(`/api/sales/context?${query.toString()}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load sales context.");
        if (!alive) return;
        setSalesTrackingEnabled(Boolean(json?.salesTrackingEnabled));
        setIsRolloverNight(Boolean(json?.isRolloverNight));
        const prior = json?.priorXReportCents;
        if (typeof prior === "number" && Number.isFinite(prior)) {
          setSalesPriorX((prior / 100).toFixed(2));
        }
      } catch (e: unknown) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load sales context.");
      } finally {
        if (alive) setSalesContextLoading(false);
      }
    };
    void loadSalesContext();
    return () => {
      alive = false;
    };
  }, [authToken, businessDate, isOther, shiftType, storeId]);

  const salesXReportCents = parseMoneyInputToCents(salesXReport);
  const salesZReportCents = parseMoneyInputToCents(salesZReport);
  const salesPriorXCents = parseMoneyInputToCents(salesPriorX);
  const requiresSalesForOpen = salesTrackingEnabled && shiftType === "open";
  const useSafeCloseoutSalesForClose = Boolean(
    safeCloseoutEnabled &&
      safeCloseoutContext?.closeout &&
      (shiftType === "close" || shiftType === "double") &&
      !isRolloverNight
  );
  const requiresSalesForClose =
    salesTrackingEnabled &&
    (shiftType === "close" || shiftType === "double") &&
    !isRolloverNight &&
    !useSafeCloseoutSalesForClose;
  const isCloseOrDouble = shiftType === "close" || shiftType === "double";
  const salesInputsValid =
    (!requiresSalesForOpen || salesXReportCents != null) &&
    (!requiresSalesForClose || (
      salesZReportCents != null &&
      // Double shifts have no separate opener; prior X is optional (backend defaults to 0).
      (shiftType === "double" || salesPriorXCents != null)
    ));

  // Reset confirmations when drawer goes back in range
  useEffect(() => {
    if (!outOfThreshold && !changeNot200) {
      setConfirm(false);
      setNotify(false);
    }
  }, [outOfThreshold, changeNot200]);

  const canSubmit =
    !saving &&
    doubleCheck &&
    (isOther ? true : hasValidDrawer && hasValidChange) &&
    (!salesTrackingEnabled || salesInputsValid) &&
    (!salesNeedsConfirm || salesConfirmChecked) &&
    (outOfThreshold ? confirm : true) &&
    (changeNot200 ? notify : true);
  if (showRolloverPrompt) {
    const rolloverCents = parseMoneyInputToCents(rolloverAmount);
    return (
      <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 overflow-y-auto modal-under-header">
        <div className="shift-modal-shell space-y-3">
          <h2 className="shift-status-title">Midnight X Report</h2>
          <div className="shift-section-meta">
            Enter the midnight X report total before you leave. This is compared against the opener's blind entry tomorrow morning.
          </div>
          <label className="shift-field-label">Midnight X Report Total ($)</label>
          <input
            className="shift-field-input"
            inputMode="decimal"
            value={rolloverAmount}
            onChange={e => setRolloverAmount(e.target.value)}
            placeholder="0.00"
          />
          {rolloverErr && (
            <div className="shift-flash shift-flash-warn text-sm">
              {rolloverErr}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              className="shift-button-secondary"
              disabled={rolloverSaving}
              onClick={() => {
                onClose();
                onSuccess();
              }}
            >
              Skip for now
            </button>
            <button
              className="shift-button disabled:opacity-50"
              disabled={rolloverSaving || rolloverCents == null || !businessDate || !authToken}
              onClick={async () => {
                setRolloverErr(null);
                if (!authToken) {
                  setRolloverErr("Session expired. Please refresh.");
                  return;
                }
                if (!businessDate) {
                  setRolloverErr("Unable to determine business date.");
                  return;
                }
                if (rolloverCents == null) {
                  setRolloverErr("Enter a valid non-negative amount.");
                  return;
                }
                setRolloverSaving(true);
                try {
                  const res = await fetch("/api/sales/rollover", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                      storeId,
                      date: businessDate,
                      amount: rolloverCents,
                      source: "closer",
                      forceMismatch: rolloverMismatchNeedsConfirm,
                    }),
                  });
                  const json = await res.json();
                  if (res.status === 409 && json?.requiresConfirmation) {
                    setRolloverMismatchNeedsConfirm(true);
                    setRolloverErr("Mismatch detected. Submit again to save mismatch for manager review.");
                    return;
                  }
                  if (!res.ok) {
                    throw new Error(json?.error || "Failed to submit rollover.");
                  }

                  onClose();
                  onSuccess();
                } catch (e: unknown) {
                  setRolloverErr(e instanceof Error ? e.message : "Failed to submit rollover.");
                } finally {
                  setRolloverSaving(false);
                }
              }}
            >
              {rolloverSaving ? "Submitting..." : rolloverMismatchNeedsConfirm ? "Save Mismatch" : "Submit"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 overflow-y-auto modal-under-header">
      <div className="shift-modal-shell space-y-3 max-h-[85vh] overflow-y-auto overscroll-contain">
        <h2 className="shift-status-title">End Shift</h2>

        <label className="shift-field-label">End time</label>
        <input
          type="datetime-local"
          className="shift-field-input"
          value={endLocal}
          onChange={e => setEndLocal(e.target.value)}
        />
        <div className="shift-section-meta text-xs">
          Defaults to the scheduled end time when available. Extra time should only be used for real exceptions.
        </div>

        <label className="shift-field-label">Ending drawer count ($){isOther ? " (optional)" : ""}</label>
        <input
          className="shift-field-input"
          inputMode="decimal"
          value={drawer}
          onChange={e => setDrawer(e.target.value)}
        />

        {msg && (
          <div className="shift-flash shift-flash-warn text-sm">
            {msg}
          </div>
        )}

        <label className="shift-field-label">Change drawer count ($){isOther ? " (optional)" : ""}</label>
        <input
          className="shift-field-input"
          inputMode="decimal"
          value={changeDrawer}
          onChange={e => setChangeDrawer(e.target.value)}
        />

        {hasValidChange && changeNot200 && (
          <div className="shift-flash shift-flash-warn text-sm">
            Change drawer should be exactly $200.00.
          </div>
        )}

        {/* Variance confirmation - only shown when drawer is out of threshold */}
        {outOfThreshold && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
              I confirm this count is correct (required when outside threshold)
            </label>
          </>
        )}

        {(outOfThreshold || changeNot200) && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
            I notified manager (required if change drawer is not $200)
          </label>
        )}

        <label className="shift-field-label">Note (optional)</label>
        <input className="shift-field-input" value={note} onChange={e => setNote(e.target.value)} />

        {!isOther && salesTrackingEnabled && (
          <div className="employee-panel space-y-2">
            <div className="shift-status-title">Sales Report</div>
            {salesContextLoading && <div className="shift-note text-xs">Loading sales context...</div>}

            {shiftType === "open" && (
              <>
                <label className="shift-field-label">X Report Total ($)</label>
                <input
                  className="shift-field-input"
                  inputMode="decimal"
                  value={salesXReport}
                  onChange={e => setSalesXReport(e.target.value)}
                  placeholder="0.00"
                />
                <label className="shift-field-label">Transaction count <span className="text-gray-500 normal-case tracking-normal">(# of sales rung — optional)</span></label>
                <input
                  className="shift-field-input"
                  inputMode="numeric"
                  value={openTransactionCount}
                  onChange={e => setOpenTransactionCount(e.target.value)}
                  placeholder="e.g. 42"
                />
              </>
            )}

            {(shiftType === "close" || shiftType === "double") && !isRolloverNight && !useSafeCloseoutSalesForClose && (
              <>
                <label className="shift-field-label">Prior X Report ($)</label>
                <input
                  className="shift-field-input"
                  inputMode="decimal"
                  value={salesPriorX}
                  onChange={e => setSalesPriorX(e.target.value)}
                  placeholder="0.00"
                />
                <label className="shift-field-label">Z Report Total ($)</label>
                <input
                  className="shift-field-input"
                  inputMode="decimal"
                  value={salesZReport}
                  onChange={e => setSalesZReport(e.target.value)}
                  placeholder="0.00"
                />
                <label className="shift-field-label">Transaction count <span className="text-gray-500 normal-case tracking-normal">(# of sales rung — optional)</span></label>
                <input
                  className="shift-field-input"
                  inputMode="numeric"
                  value={closeTransactionCount}
                  onChange={e => setCloseTransactionCount(e.target.value)}
                  placeholder="e.g. 42"
                />
              </>
            )}
            {(shiftType === "close" || shiftType === "double") && !isRolloverNight && useSafeCloseoutSalesForClose && (
              <>
                <div className="shift-flash shift-flash-success text-xs">
                  Using submitted Safe Closeout totals for close-shift sales.
                </div>
                <label className="shift-field-label">Prior X Report ($)</label>
                <input
                  className="shift-field-input"
                  inputMode="decimal"
                  value={salesPriorX}
                  onChange={e => setSalesPriorX(e.target.value)}
                  placeholder="Enter if missing"
                />
                <div className="shift-section-meta text-xs">
                  Only needed if opener X report was not entered earlier.
                </div>
                <label className="shift-field-label">Transaction count <span className="text-gray-500 normal-case tracking-normal">(# of sales rung - required)</span></label>
                <input
                  className="shift-field-input"
                  inputMode="numeric"
                  value={closeTransactionCount}
                  onChange={e => setCloseTransactionCount(e.target.value)}
                  placeholder="e.g. 42"
                />
              </>
            )}
            {(shiftType === "close" || shiftType === "double") && isRolloverNight && (
              <>
                <div className="shift-flash shift-flash-warn text-xs">
                  10pm Z/Prior-X is entered from the shift page. At clock out, enter transaction count for the full close period.
                </div>
                <label className="shift-field-label">Transaction count <span className="text-gray-500 normal-case tracking-normal">(# of sales rung - required)</span></label>
                <input
                  className="shift-field-input"
                  inputMode="numeric"
                  value={closeTransactionCount}
                  onChange={e => setCloseTransactionCount(e.target.value)}
                  placeholder="e.g. 42"
                />
              </>
            )}
          </div>
        )}

        {salesNeedsConfirm && (
          <div className="shift-flash shift-flash-warn space-y-2">
            <div className="text-sm">
              Sales numbers do not balance.
              {salesVarianceCents != null ? ` Variance: $${(salesVarianceCents / 100).toFixed(2)}.` : ""}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={salesConfirmChecked}
                onChange={e => setSalesConfirmChecked(e.target.checked)}
              />
              I confirm these sales numbers are correct (this will be flagged for review)
            </label>
          </div>
        )}

        {/* Final confirmation to prevent accidental clock-outs */}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={doubleCheck} onChange={e => setDoubleCheck(e.target.checked)} />
          I understand I'm ending my shift.
        </label>

        {err && <div className="shift-flash shift-flash-error text-sm">{err}</div>}

        <div className="flex gap-2 justify-end">
          <button className="shift-button-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            className="shift-button disabled:opacity-50"
            onClick={async () => {
              setErr(null);

              const d = toCstDateFromLocalInput(endLocal);
              if (!d || Number.isNaN(d.getTime())) {
                setErr("Invalid date/time.");
                return;
              }
              if (shiftType === "close") {
                const rounded = roundTo30Minutes(d);
                const cst = getCstDowMinutes(rounded);
                if (!storeKey || !cst) {
                  triggerClockWindowModal("Outside allowed clock window");
                  return;
                }
                const windowCheck = isTimeWithinWindow({
                  storeKey,
                  shiftType: "close" as WindowShiftType,
                  localDow: cst.dow,
                  minutes: cst.minutes,
                });
                if (!windowCheck.ok) {
                  triggerClockWindowModal(windowCheck.windowLabel);
                  return;
                }
              }

              // Determine auth token
              if (!authToken) {
                setErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
                return;
              }

              if (!isOther && salesTrackingEnabled) {
                if (shiftType === "open") {
                  const openTxn = openTransactionCount.trim();
                  if (!(openTxn !== "" && /^\d+$/.test(openTxn) && Number(openTxn) > 0)) {
                    setErr("Transaction count is required before clock-out for open shifts.");
                    return;
                  }
                }
                if (shiftType === "close" || shiftType === "double") {
                  const closeTxn = closeTransactionCount.trim();
                  if (!(closeTxn !== "" && /^\d+$/.test(closeTxn) && Number(closeTxn) > 0)) {
                    setErr("Transaction count is required before clock-out for close/double shifts.");
                    return;
                  }
                }
              }

              setSaving(true);
              try {
                const res = await fetch("/api/end-shift", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                  },
                  body: JSON.stringify({
                    qrToken,
                    shiftId,
                    endAt: d.toISOString(),
                    endDrawerCents: isOther ? (hasValidDrawer ? cents : null) : cents,
                    changeDrawerCents: isOther ? (hasValidChange ? changeCents : null) : changeCents,
                    salesXReportCents: requiresSalesForOpen ? salesXReportCents : null,
                    salesZReportCents: requiresSalesForClose ? salesZReportCents : null,
                    salesPriorXCents: isCloseOrDouble ? salesPriorXCents : null,
                    salesConfirmed: salesNeedsConfirm ? salesConfirmChecked : false,
                    confirmed: outOfThreshold ? confirm : false,
                    notifiedManager: (outOfThreshold || changeNot200) ? notify : false,
                    note: note || null,
                    openTransactionCount: (() => {
                      const v = openTransactionCount.trim();
                      return v !== "" && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null;
                    })(),
                    closeTransactionCount: (() => {
                      const v = closeTransactionCount.trim();
                      return v !== "" && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null;
                    })(),
                  }),
                });

                const json = await res.json();
                if (!res.ok) {
                  if (json?.requiresSalesConfirm) {
                    setSalesNeedsConfirm(true);
                    setSalesVarianceCents(typeof json?.salesVarianceCents === "number" ? json.salesVarianceCents : null);
                    return;
                  }
                  if (json?.code === "CLOCK_WINDOW_VIOLATION") {
                    triggerClockWindowModal(json?.windowLabel ?? "Outside allowed clock window");
                    return;
                  }
                  throw new Error(json?.error || "Failed to end shift.");
                }

                setSalesNeedsConfirm(false);
                setSalesConfirmChecked(false);
                setSalesVarianceCents(null);

                if (salesTrackingEnabled && (shiftType === "close" || shiftType === "double") && isRolloverNight && businessDate) {
                  setShowRolloverPrompt(true);
                  return;
                }

                onClose();
                onSuccess();
                stopAlarm();
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : "Failed to end shift.");
              } finally {
                setSaving(false);
              }
            }}
          >
            Confirm End Shift
          </button>
        </div>

        {outOfThreshold && !confirm && (
          <div className="shift-section-meta text-xs">
            Confirmation is required when the drawer is outside the allowed threshold.
          </div>
        )}
      </div>

      {clockWindowModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="shift-modal-shell w-full max-w-md space-y-3 text-center">
            <div className="shift-status-title">Contact Manager Immediately</div>
            <div className="shift-section-meta text-xs">
              The alarm indicates an invalid time entry and stops once the entry is corrected or the process is exited.
            </div>
            <div className="shift-flash shift-flash-warn text-xs">Proper clock in window: {clockWindowModal.label}</div>
            <button
              className="shift-button-secondary mx-auto"
              onClick={() => setClockWindowModal({ open: false, label: "" })}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

