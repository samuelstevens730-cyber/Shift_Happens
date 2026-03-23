/**
 * Home Page - Consolidated Dashboard
 *
 * Features:
 * - Bento grid: TIME CLOCK (modal), MY SCHEDULE, REQUESTS, ADMIN
 * - Nav: HOME | ADMIN | LOGOUT
 * - Employee messages banner
 * - QR code store preselection via ?store=STORE_ID
 */

"use client";

import Link from "next/link";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";
import PinGate from "@/components/PinGate";
import ExpandableCard from "@/components/ExpandableCard";
import HomeHeader from "@/components/HomeHeader";
import RevealOnScroll from "@/components/RevealOnScroll";
import { ArrowRight, Calendar, ChevronDown, ChevronUp, Clock, FileText, Shield, Star, Timer, Trophy, X } from "lucide-react";
import type { EmployeePublicScoreboardResponse } from "@/types/employeePublicScoreboard";

// Storage keys (match PinGate.tsx)
const PIN_TOKEN_KEY = "sh_pin_token";
const PIN_STORE_KEY = "sh_pin_store_id";
const PIN_PROFILE_KEY = "sh_pin_profile_id";

type Store = { id: string; name: string };
type EmployeeMessage = { id: string; content: string; created_at: string };

type ScheduleShift = {
  id: string;
  shift_date: string;
  shift_type: string;
  scheduled_start: string;
  scheduled_end: string;
  shift_mode?: string | null;
  stores?: { name: string } | null;
};

type TimeEntry = {
  id: string;
  planned_start_at?: string | null;
  started_at: string;
  ended_at: string | null;
  hours: number;
};

type OpenShiftState = {
  shiftId: string;
  startedAt: string | null;
  shiftType: string | null;
  storeId: string | null;
  storeName: string | null;
};

type HeroState = {
  mode: "off" | "open" | "clocked-in";
  label: string;
  ctaLabel?: string;
  href: string;
  detail: string;
};

const CST_TZ = "America/Chicago";

function getCstDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysToKey(dateKey: string, days: number) {
  const dt = new Date(`${dateKey}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return getCstDateKey(dt);
}

function formatCstLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
    timeZone: CST_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getCstWeekdayIndex(dateKey: string) {
  const label = new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
    timeZone: CST_TZ,
    weekday: "short",
  });
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[label] ?? 0;
}

function formatTimeLabel(value?: string) {
  if (!value) return "";
  const [h, m] = value.split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return value;
  const minute = (m ?? "00").slice(0, 2);
  const hour12 = ((hour + 11) % 12) + 1;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour12}:${minute} ${suffix}`;
}

function toMinutes(value?: string) {
  if (!value) return NaN;
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

function getShiftTimeRange(shifts: ScheduleShift[]) {
  if (!shifts.length) return "Off";
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  shifts.forEach(shift => {
    const start = toMinutes(shift.scheduled_start);
    let end = toMinutes(shift.scheduled_end);
    if (Number.isNaN(start) || Number.isNaN(end)) return;
    if (end < start) end += 24 * 60;
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  });
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return "Off";
  const displayStart = formatTimeLabel(
    `${Math.floor(minStart / 60)
      .toString()
      .padStart(2, "0")}:${String(minStart % 60).padStart(2, "0")}`
  );
  const displayEndMinutes = maxEnd % (24 * 60);
  const displayEnd = formatTimeLabel(
    `${Math.floor(displayEndMinutes / 60)
      .toString()
      .padStart(2, "0")}:${String(displayEndMinutes % 60).padStart(2, "0")}`
  );
  return `${displayStart} - ${displayEnd}`;
}

function getStoreLabel(shifts: ScheduleShift[]) {
  if (!shifts.length) return "--";
  const names = shifts.map(s => s.stores?.name ?? "--").filter(Boolean);
  const unique = Array.from(new Set(names));
  return unique.length === 1 ? unique[0] : "Multiple";
}

function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedStore = searchParams.get("store");

  // Auth state
  const [hasAdminAuth, setHasAdminAuth] = useState(false);
  const [hasPinAuth, setHasPinAuth] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [navProfileId, setNavProfileId] = useState<string | null>(null);

  // Modal state
  const [showAuthModal, setShowAuthModal] = useState(false);

  // PIN gate state
  const [showPinGate, setShowPinGate] = useState(false);
  const [pinLoading, setPinLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");

  // Employee messages
  const [employeeMessages, setEmployeeMessages] = useState<EmployeeMessage[]>([]);

  // Schedule and hours data
  const [scheduleShifts, setScheduleShifts] = useState<ScheduleShift[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [currentPeriodHours, setCurrentPeriodHours] = useState(0);
  const [payPeriodRange, setPayPeriodRange] = useState({ start: "", end: "" });
  const [openShift, setOpenShift] = useState<OpenShiftState | null>(null);
  const [scoreboardPreview, setScoreboardPreview] = useState<{
    rank: number | null;
    score: number | null;
    grade: string | null;
  } | null>(null);

  // Check for existing auth on mount
  useEffect(() => {
    let alive = true;

    async function checkAuth() {
      // Check for admin session
      const { data: { session } } = await supabase.auth.getSession();
      const adminAuthed = !!session?.user;

      // Check for PIN session
      let pinAuthed = false;
      let pinProfileId: string | null = null;
      if (typeof window !== "undefined") {
        const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
        const pinStore = sessionStorage.getItem(PIN_STORE_KEY);
        const pinProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
        pinAuthed = !!(pinToken && pinStore && pinProfile);
        pinProfileId = pinProfile;
      }

      if (!alive) return;

      setHasAdminAuth(adminAuthed);
      setHasPinAuth(pinAuthed);
      setAuthChecked(true);
      if (pinProfileId) {
        setNavProfileId(pinProfileId);
      } else if (adminAuthed && session?.access_token) {
        const res = await fetch("/api/me/profile", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.profileId) setNavProfileId(data.profileId);
        }
      } else {
        setNavProfileId(null);
      }

      // If no auth at all, show the auth choice modal
      if (!adminAuthed && !pinAuthed) {
        setShowAuthModal(true);
      }
    }

    checkAuth();

    // Subscribe to auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const authed = !!session?.user;
      setHasAdminAuth(authed);
      if (authed) {
        setShowAuthModal(false);
      }
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Fetch employee messages when authenticated
  useEffect(() => {
    if (!hasPinAuth && !hasAdminAuth) return;

    let alive = true;
    async function fetchMessages() {
      const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
      const client = pinToken ? createEmployeeSupabase(pinToken) : supabase;
      let profileId = sessionStorage.getItem(PIN_PROFILE_KEY);
      if (!profileId && hasAdminAuth) {
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

      const { data, error } = await client
        .from("shift_assignments")
        .select("id, message, created_at")
        .eq("type", "message")
        .eq("target_profile_id", profileId)
        .is("deleted_at", null)
        .is("acknowledged_at", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!alive) return;
      if (error) {
        console.error("Failed to load messages:", error);
        return;
      }
      if (data) {
        setEmployeeMessages(
          (data ?? []).map((row) => ({
            id: row.id,
            content: row.message,
            created_at: row.created_at,
          }))
        );
      }
    }

    fetchMessages();
    return () => { alive = false; };
  }, [hasPinAuth, hasAdminAuth]);

  // Fetch schedule and hours data when authenticated
  useEffect(() => {
    if (!hasPinAuth && !hasAdminAuth) return;

    let alive = true;
    async function fetchData() {
      const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
      const profileId = sessionStorage.getItem(PIN_PROFILE_KEY);
      
      // Determine client based on auth type
      const client = pinToken ? createEmployeeSupabase(pinToken) : supabase;
      
      // Get profile ID for managers
      let targetProfileId = profileId;
      if (!targetProfileId && hasAdminAuth) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("auth_user_id", userData.user.id)
            .maybeSingle();
          if (profile) targetProfileId = profile.id;
        }
      }
      
      if (!targetProfileId) return;

      // Fetch schedule shifts (yesterday -> next 7 days, CST)
      const today = getCstDateKey(new Date());
      const yesterday = addDaysToKey(today, -1);
      const nextWeek = addDaysToKey(today, 7);
      
      const { data: shifts } = await client
        .from("schedule_shifts")
        .select("id, shift_date, shift_type, shift_mode, scheduled_start, scheduled_end, stores(name), schedules!inner(status)")
        .eq("schedules.status", "published")
        .eq("profile_id", targetProfileId)
        .gte("shift_date", yesterday)
        .lte("shift_date", nextWeek)
        .order("shift_date", { ascending: true });

      if (!alive) return;
      if (shifts) setScheduleShifts((shifts as unknown) as ScheduleShift[]);

      // Fetch current pay period hours
      const now = new Date();
      const day = now.getDate();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const lastDay = new Date(year, month, 0).getDate();
      
      let periodStart: string;
      let periodEnd: string;
      
      if (day <= 15) {
        periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
        periodEnd = `${year}-${String(month).padStart(2, "0")}-15`;
      } else {
        periodStart = `${year}-${String(month).padStart(2, "0")}-16`;
        periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
      }
      
      setPayPeriodRange({ start: periodStart, end: periodEnd });

      const { data: entries } = await client
        .from("shifts")
        .select("id, planned_start_at, started_at, ended_at")
        .eq("profile_id", targetProfileId)
        .gte("planned_start_at", `${periodStart}T00:00:00`)
        .lte("planned_start_at", `${periodEnd}T23:59:59`)
        .not("ended_at", "is", null)
        .order("planned_start_at", { ascending: false });

      if (!alive) return;
      if (entries) {
        const processedEntries = entries.map(e => {
          const start = new Date(e.planned_start_at ?? e.started_at);
          const end = e.ended_at ? new Date(e.ended_at) : null;
          const hours = end ? (end.getTime() - start.getTime()) / 3600000 : 0;
          return { ...e, hours };
        });
        setTimeEntries(processedEntries);
        setCurrentPeriodHours(processedEntries.reduce((sum, e) => sum + e.hours, 0));
      }
    }

    fetchData();
    return () => { alive = false; };
  }, [hasPinAuth, hasAdminAuth]);

  // Listen for PIN auth changes
  useEffect(() => {
    const checkPinAuth = () => {
      if (typeof window === "undefined") return;
      const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
      const pinStore = sessionStorage.getItem(PIN_STORE_KEY);
      const pinProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
      const pinAuthed = !!(pinToken && pinStore && pinProfile);
      setHasPinAuth(pinAuthed);
      if (pinAuthed) {
        setShowAuthModal(false);
        setShowPinGate(false);
      }
    };

    window.addEventListener("storage", checkPinAuth);
    return () => window.removeEventListener("storage", checkPinAuth);
  }, []);

  // Hide original header on home page
  useEffect(() => {
    const header = document.querySelector("header");
    if (header) {
      header.style.display = "none";
    }
    return () => {
      if (header) {
        header.style.display = "";
      }
    };
  }, []);

  // Fetch stores when showing PIN gate (NO profiles for security)
  useEffect(() => {
    if (!showPinGate) return;

    let alive = true;
    setPinLoading(true);

    async function loadData() {
      try {
        const { data: storesData } = await supabase
          .from("stores")
          .select("id, name")
          .order("name");

        if (!alive) return;

        const storesList = storesData || [];
        setStores(storesList);

        // Set defaults - use preselected store from QR if available
        if (preselectedStore && storesList.find((s: Store) => s.id === preselectedStore)) {
          setStoreId(preselectedStore);
        } else if (storesList.length > 0 && !storeId) {
          setStoreId(storesList[0].id);
        }
      } finally {
        if (alive) setPinLoading(false);
      }
    }

    loadData();
    return () => { alive = false; };
  }, [showPinGate, preselectedStore, storeId]);

  // Handle PIN authorization success
  const handlePinAuthorized = () => {
    setHasPinAuth(true);
    setShowPinGate(false);
    setShowAuthModal(false);
  };

  // Handle Employee choice
  const handleEmployeeChoice = () => {
    setShowAuthModal(false);
    setShowPinGate(true);
  };

  // Handle Admin choice
  const handleAdminChoice = () => {
    router.push("/login?next=/");
  };

  async function getAuthHeaderValue(): Promise<string | null> {
    const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
    if (pinToken) return `Bearer ${pinToken}`;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) return `Bearer ${session.access_token}`;
    return null;
  }

  // Dismiss employee message
  const dismissMessage = async (messageId: string) => {
    const authHeader = await getAuthHeaderValue();
    if (!authHeader) return;

    const res = await fetch(`/api/messages/${messageId}/dismiss`, {
      method: "POST",
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      console.error("Failed to dismiss message:", json?.error ?? res.statusText);
      return;
    }

    setEmployeeMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  useEffect(() => {
    if (!navProfileId) {
      setOpenShift(null);
      setScoreboardPreview(null);
      return;
    }

    let alive = true;

    async function loadOperationalPreview() {
      const targetProfileId = navProfileId;
      if (!targetProfileId) return;
      const authHeader = await getAuthHeaderValue();
      if (!authHeader) return;

      const scoreboardFrom = addDaysToKey(getCstDateKey(new Date()), -29);
      const scoreboardTo = getCstDateKey(new Date());

      const [openShiftRes, scoreboardRes] = await Promise.all([
        fetch(`/api/shift/open?profileId=${encodeURIComponent(targetProfileId)}`, {
          headers: { Authorization: authHeader },
        }),
        fetch(
          `/api/employee/scoreboard?from=${encodeURIComponent(scoreboardFrom)}&to=${encodeURIComponent(scoreboardTo)}&storeId=all`,
          { headers: { Authorization: authHeader } }
        ),
      ]);

      if (!alive) return;

      if (openShiftRes.ok) {
        const json = (await openShiftRes.json()) as Partial<OpenShiftState>;
        if (json?.shiftId) {
          setOpenShift({
            shiftId: json.shiftId,
            startedAt: json.startedAt ?? null,
            shiftType: json.shiftType ?? null,
            storeId: json.storeId ?? null,
            storeName: json.storeName ?? null,
          });
        } else {
          setOpenShift(null);
        }
      }

      if (scoreboardRes.ok) {
        const payload = (await scoreboardRes.json()) as EmployeePublicScoreboardResponse;
        const rows = payload.publicRows ?? [];
        const myRank = payload.myRow ? rows.findIndex((row) => row.profileId === payload.myRow?.profileId) + 1 : 0;
        setScoreboardPreview({
          rank: myRank > 0 ? myRank : null,
          score: payload.myRow?.score ?? null,
          grade: payload.myRow?.grade ?? null,
        });
      }
    }

    void loadOperationalPreview();

    return () => {
      alive = false;
    };
  }, [navProfileId, hasAdminAuth, hasPinAuth]);

  // Determine which cards to show
  const showMySchedule = hasPinAuth || hasAdminAuth;
  const showRequests = hasPinAuth || hasAdminAuth;
  const showAdmin = hasAdminAuth;

  const todayKey = getCstDateKey(new Date());
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const endOfWeekOffset = 6 - getCstWeekdayIndex(todayKey);
  const endOfWeekKey = addDaysToKey(todayKey, endOfWeekOffset < 0 ? 0 : endOfWeekOffset);
  const expandedKeys = Array.from({ length: endOfWeekOffset + 1 }).map((_, idx) =>
    addDaysToKey(todayKey, idx)
  );
  const nextWeekKeys = Array.from({ length: 7 }).map((_, idx) =>
    addDaysToKey(todayKey, endOfWeekOffset + 1 + idx)
  );
  const [showNextWeek, setShowNextWeek] = useState(false);

  const scheduleHref = navProfileId ? `/schedule?profileId=${encodeURIComponent(navProfileId)}` : "/schedule";
  const shiftsHref = navProfileId ? `/shifts?profileId=${encodeURIComponent(navProfileId)}` : "/shifts";
  const todayShifts = scheduleShifts.filter((shift) => shift.shift_date === todayKey);
  const tomorrowShifts = scheduleShifts.filter((shift) => shift.shift_date === tomorrowKey);
  const yesterdayShifts = scheduleShifts.filter((shift) => shift.shift_date === yesterdayKey);
  const nextScheduledShift = [...scheduleShifts]
    .sort((a, b) => {
      const dateA = `${a.shift_date}T${a.scheduled_start}`;
      const dateB = `${b.shift_date}T${b.scheduled_start}`;
      return dateA.localeCompare(dateB);
    })
    .find((shift) => shift.shift_date >= todayKey);
  const nextShiftLabel = nextScheduledShift
    ? `${formatCstLabel(nextScheduledShift.shift_date)} | ${formatTimeLabel(nextScheduledShift.scheduled_start)}`
    : "No scheduled shift loaded";
  const openShiftDateKey = openShift?.startedAt ? getCstDateKey(new Date(openShift.startedAt)) : null;
  const heroState: HeroState = openShift?.shiftId
    ? openShiftDateKey === todayKey
      ? {
          mode: "clocked-in",
          label: "Clock Out",
          href: `/shift/${openShift.shiftId}`,
          detail: openShift.storeName ?? "Open shift active",
        }
      : {
          mode: "open",
          label: "Recover Shift",
          href: `/shift/${openShift.shiftId}`,
          detail: openShift.storeName ?? "Resume open shift",
        }
    : {
        mode: "off",
        label: "Start Shift",
        ctaLabel: "Punch In",
        href: "/clock",
        detail: todayShifts.length ? getShiftTimeRange(todayShifts) : "Off shift",
      };

  const immediateActions = [
    { href: "/dashboard/requests", label: "Requests", detail: "Time off, swaps, corrections", enabled: showRequests },
    { href: shiftsHref, label: "My Shifts", detail: "Hours and prior shifts", enabled: showMySchedule },
    { href: scheduleHref, label: "Full Schedule", detail: "See the rest of the week", enabled: showMySchedule },
    ...(showAdmin ? [{ href: "/admin", label: "Admin", detail: "Manager tools", enabled: true }] : []),
    ...(showAdmin ? [{ href: "/admin/cleaning/report", label: "Cleaning Audit", detail: "Yesterday by store", enabled: true }] : []),
  ].filter((action) => action.enabled);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const visibleActions = showMoreActions ? immediateActions : immediateActions.slice(0, 4);

  if (!authChecked) {
    return (
      <div className="bento-shell employee-shell-loading">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bento-shell">
      <HomeHeader
        isManager={hasAdminAuth}
        isAuthenticated={hasAdminAuth || hasPinAuth}
        profileId={navProfileId}
        onLogin={() => setShowAuthModal(true)}
      />

      <main className="employee-home">
        <RevealOnScroll delayMs={0}>
          <Link href={heroState.href} className={`employee-time-hero employee-time-hero-${heroState.mode}`}>
            <div className="employee-time-label">Time Clock</div>
            <div className="employee-time-state">{heroState.label}</div>
            <div className="employee-time-meta">{heroState.detail}</div>
            <div className="employee-time-cta">
              {heroState.ctaLabel ?? heroState.label}
              <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        </RevealOnScroll>

        {employeeMessages.length > 0 && (
          <RevealOnScroll delayMs={40}>
            <section className="employee-message-stack">
            {employeeMessages.map((message) => (
              <div key={message.id} className="employee-message">
                <div className="employee-message-copy">
                  <div className="employee-message-kicker">Management Message</div>
                  <p>{message.content}</p>
                  <Link href="/dashboard/requests?tab=open" className="employee-inline-link">
                    View offers
                  </Link>
                </div>
                <button onClick={() => dismissMessage(message.id)} className="employee-dismiss">
                  <span>Dismiss</span>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            </section>
          </RevealOnScroll>
        )}

        <section className="employee-home-stack">
          <RevealOnScroll delayMs={70}>
            <ExpandableCard
              title="MY SCHEDULE"
              icon={Calendar}
              iconColor="text-[var(--accent-purple)]"
              borderColor="bento-my-schedule"
              disabled={!showMySchedule}
              fullViewLink={scheduleHref}
              fullViewText="Full schedule"
              collapsedContent={
                <div className="employee-schedule-triptych">
                  {[
                    { label: "Yesterday", shifts: yesterdayShifts },
                    { label: "Today", shifts: todayShifts },
                    { label: "Tomorrow", shifts: tomorrowShifts },
                  ].map((day) => (
                    <div key={day.label} className="employee-mini-day">
                      <span className="employee-mini-day-label">{day.label}</span>
                      <strong>{getShiftTimeRange(day.shifts)}</strong>
                      <span>{getStoreLabel(day.shifts)}</span>
                    </div>
                  ))}
                </div>
              }
              expandedContent={
                <div className="space-y-2">
                  {expandedKeys.slice(0, 5).map((key) => {
                    const shiftsForDay = scheduleShifts.filter((shift) => shift.shift_date === key);
                    const isToday = key === todayKey;
                    return (
                      <div key={key} className={`employee-schedule-row ${isToday ? "employee-schedule-row-active" : ""}`}>
                        <span className="text-sm font-medium w-24">{formatCstLabel(key)}</span>
                        <span className="text-sm text-gray-300">{getShiftTimeRange(shiftsForDay)}</span>
                        <span className="text-xs text-gray-500">{getStoreLabel(shiftsForDay)}</span>
                      </div>
                    );
                  })}
                </div>
              }
            />
          </RevealOnScroll>

          <RevealOnScroll delayMs={95}>
            <ExpandableCard
              title="CURRENT HOURS"
              icon={Timer}
              iconColor="text-[var(--accent-gold)]"
              borderColor="bento-hours"
              disabled={!showMySchedule}
              fullViewLink={shiftsHref}
              fullViewText="Full timecard"
              collapsedContent={
                <div className="text-center">
                  <p className="employee-metric-value">{currentPeriodHours.toFixed(1)}</p>
                  <p className="text-sm text-[var(--accent-gold)]">hours this period</p>
                  <p className="employee-metric-meta">
                    {payPeriodRange.start
                      ? `${new Date(payPeriodRange.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(payPeriodRange.end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : "Current pay period"}
                  </p>
                </div>
              }
              expandedContent={
                <div className="space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-white/10">
                    <span className="text-sm text-gray-400">Period Total</span>
                    <span className="text-xl font-bold text-[var(--accent-gold)]">{currentPeriodHours.toFixed(2)} hrs</span>
                  </div>
                  <div className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
                    {timeEntries.map((entry) => (
                      <div key={entry.id} className="employee-hours-row">
                        <div>
                          <p className="text-sm font-medium">
                            {new Date(entry.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                          <p className="text-xs text-gray-400">
                            {new Date(entry.started_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} -{" "}
                            {entry.ended_at
                              ? new Date(entry.ended_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                              : "--"}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-white">{entry.hours.toFixed(1)}h</span>
                      </div>
                    ))}
                  </div>
                  {timeEntries.length === 0 ? (
                    <p className="text-center text-gray-400 py-4">No hours logged this period.</p>
                  ) : null}
                </div>
              }
            />
          </RevealOnScroll>

          <RevealOnScroll delayMs={120}>
            <section className="employee-panel">
            <div className="employee-panel-header">
              <div>
                <div className="employee-section-kicker">Immediate Actions</div>
                <h2>Immediate Actions</h2>
              </div>
              {immediateActions.length > 4 ? (
                <button
                  type="button"
                  className="employee-inline-toggle"
                  onClick={() => setShowMoreActions((prev) => !prev)}
                >
                  {showMoreActions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              ) : null}
            </div>
            <div className="employee-panel-stack">
              {visibleActions.map((action) => (
                <Link key={action.href} href={action.href} className="employee-link-row">
                  <div>
                    <strong>{action.label}</strong>
                    <span>{action.detail}</span>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
            </section>
          </RevealOnScroll>

          <RevealOnScroll delayMs={145}>
            <section className="employee-panel employee-rank-card">
            <div className="employee-panel-header">
              <div>
                <div className="employee-section-kicker">Rankings</div>
                <h2>Scoreboard</h2>
              </div>
              <Trophy className="h-5 w-5 text-[var(--accent-gold)]" />
            </div>
            <div className="employee-rank-row">
              <div>
                <span className="employee-rank-label">Your Rank</span>
                <strong>{scoreboardPreview?.rank ? `#${scoreboardPreview.rank}` : "Unranked"}</strong>
              </div>
              <div>
                <span className="employee-rank-label">Score</span>
                <strong>{scoreboardPreview?.score != null ? scoreboardPreview.score.toFixed(1) : "--"}</strong>
              </div>
              <Link href="/scoreboard" className="employee-inline-link employee-rank-link">
                Full scoreboard
              </Link>
            </div>
            </section>
          </RevealOnScroll>

          {showRequests ? (
            <RevealOnScroll delayMs={170}>
              <Link href="/dashboard/requests?tab=advances" className="employee-lower-card">
                <div className="employee-section-kicker">Advance Request</div>
                <div className="employee-lower-row">
                  <strong>Submit Advance</strong>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            </RevealOnScroll>
          ) : null}

          {showRequests ? (
            <RevealOnScroll delayMs={195}>
              <Link href="/reviews" className="employee-lower-card">
                <div className="employee-section-kicker">Reviews</div>
                <div className="employee-lower-row">
                  <strong>Open Reviews</strong>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            </RevealOnScroll>
          ) : null}
        </section>
      </main>

      {/* Auth Choice Modal */}
      {showAuthModal && (
        <div className="auth-modal-overlay">
          <div className="card card-pad w-full max-w-sm space-y-6 shadow-2xl">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Welcome</h2>
              <p className="text-sm muted">Choose how you&apos;d like to sign in</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleEmployeeChoice}
                className="home-card home-card-green w-full"
              >
                <span className="text-lg">Employee</span>
                <span className="text-xs muted mt-1">Sign in with PIN</span>
              </button>

              <button
                onClick={handleAdminChoice}
                className="home-card home-card-pink w-full"
              >
                <span className="text-lg">Admin</span>
                <span className="text-xs muted mt-1">Sign in with email</span>
              </button>
            </div>

            <div className="text-xs muted text-center">
              Time Clock is available without signing in
            </div>
          </div>
        </div>
      )}

      {/* PIN Gate Modal */}
      {showPinGate && (
        <PinGate
          loading={pinLoading}
          stores={stores}
          qrToken=""
          tokenStore={null}
          storeId={storeId}
          setStoreId={setStoreId}
          profileId={profileId}
          setProfileId={setProfileId}
          onLockChange={() => {}}
          onAuthorized={handlePinAuthorized}
          onClose={() => {
            setShowPinGate(false);
            setShowAuthModal(true);
          }}
        />
      )}

    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="bento-shell employee-shell-loading"><div className="text-muted">Loading...</div></div>}>
      <HomePageInner />
    </Suspense>
  );
}
