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
import Image from "next/image";
import { useEffect, useState, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";
import PinGate from "@/components/PinGate";
import ExpandableCard from "@/components/ExpandableCard";
import { Clock, Calendar, FileText, Shield, X, Timer } from "lucide-react";

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
  const pathname = usePathname();
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
      const profileId = sessionStorage.getItem(PIN_PROFILE_KEY);
      if (!profileId) return;

      const { data } = await supabase
        .from("employee_messages")
        .select("id, content, created_at")
        .eq("profile_id", profileId)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!alive) return;
      if (data) setEmployeeMessages(data);
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
        .order("shift_date", { ascending: true })
        .limit(10);

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

  // Dismiss employee message
  const dismissMessage = async (messageId: string) => {
    await supabase.from("employee_messages").update({ is_read: true }).eq("id", messageId);
    setEmployeeMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

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

  // Nav items: HOME | ADMIN | LOGOUT
    const scheduleHref = navProfileId ? `/schedule?profileId=${encodeURIComponent(navProfileId)}` : "/schedule";
    const shiftsHref = navProfileId ? `/shifts?profileId=${encodeURIComponent(navProfileId)}` : "/shifts";
    const navItems = [
      { href: "/", label: "HOME", active: pathname === "/" },
      ...(hasAdminAuth || hasPinAuth
        ? [
            { href: scheduleHref, label: "MY SCHEDULE", active: pathname === "/schedule" },
            { href: shiftsHref, label: "MY SHIFTS", active: pathname === "/shifts" },
          ]
        : []),
      ...(hasAdminAuth ? [{ href: "/admin", label: "ADMIN", active: pathname === "/admin" }] : []),
    ];

  if (!authChecked) {
    return (
      <div className="bento-shell flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bento-shell">
      {/* Top Bar: Logo + Navigation */}
      <div className="bento-top-bar">
        <Image
          src="/brand/no_cap_logo.jpg"
          alt="No Cap Smoke Shop"
          width={120}
          height={120}
          priority
          className="bento-logo"
        />
        <nav className="bento-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`bento-nav-link ${item.active ? "bento-nav-active" : "bento-nav-inactive"}`}
            >
              {item.label}
            </Link>
          ))}
            {hasAdminAuth || hasPinAuth ? (
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  sessionStorage.removeItem(PIN_TOKEN_KEY);
                  sessionStorage.removeItem(PIN_STORE_KEY);
                  sessionStorage.removeItem(PIN_PROFILE_KEY);
                  setHasAdminAuth(false);
                  setHasPinAuth(false);
                  setNavProfileId(null);
                  router.push("/");
                }}
                className="bento-nav-link bento-nav-inactive"
              >
                LOGOUT
              </button>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="bento-nav-link bento-nav-inactive"
              >
                LOGIN
              </button>
            )}
          </nav>
        </div>

      {/* Employee Messages Banner */}
      {employeeMessages.length > 0 && (
        <div className="w-full px-4 mb-4">
          {employeeMessages.map((message) => (
            <div
              key={message.id}
              className="bg-[var(--card)] border border-[var(--green)]/30 rounded-xl p-4 relative"
            >
              <h3 className="text-[var(--green)] font-semibold text-sm mb-1">
                Message from Management
              </h3>
              <p className="text-sm text-[var(--text)]">{message.content}</p>
              <button
                onClick={() => dismissMessage(message.id)}
                className="absolute top-2 right-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bento Grid - No DASHBOARD card */}
      <div className="bento-container">
        {/* Left Column */}
        <div className="bento-left">
          {/* TIME CLOCK - redirects to clock page */}
          <Link href="/clock" className="bento-card bento-time-clock">
            <div className="flex flex-col items-center justify-center gap-3">
              <Clock className="w-10 h-10 md:w-12 md:h-12" style={{ color: "var(--green)" }} strokeWidth={1.5} />
              <span className="bento-card-title">TIME CLOCK</span>
            </div>
          </Link>

          {/* REQUESTS */}
          {showRequests ? (
            <Link href="/dashboard/shifts" className="bento-card bento-requests">
              <div className="flex flex-col items-center justify-center gap-3">
                <FileText className="w-10 h-10 md:w-12 md:h-12 text-amber-400" strokeWidth={1.5} />
                <span className="bento-card-title">REQUESTS</span>
              </div>
            </Link>
          ) : (
            <div className="bento-card bento-requests bento-card-disabled">
              <div className="flex flex-col items-center justify-center gap-3">
                <FileText className="w-10 h-10 md:w-12 md:h-12 text-amber-400" strokeWidth={1.5} />
                <span className="bento-card-title">REQUESTS</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="bento-right">
          {/* MY SCHEDULE - Expandable */}
          <ExpandableCard
            title="MY SCHEDULE"
            icon={Calendar}
            iconColor="text-sky-400"
            borderColor="bento-my-schedule"
            disabled={!showMySchedule}
            fullViewLink="/dashboard/schedule"
            fullViewText="View full schedule"
            collapsedContent={
              <div className="w-full space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center text-[10px] uppercase tracking-widest text-white/50">
                  <div>Yesterday</div>
                  <div>Today</div>
                  <div>Tomorrow</div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[yesterdayKey, todayKey, tomorrowKey].map(key => {
                    const shiftsForDay = scheduleShifts.filter(s => s.shift_date === key);
                    return (
                      <div key={key} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-2">
                        <div className="text-xs font-semibold text-white">
                          {getShiftTimeRange(shiftsForDay)}
                        </div>
                        <div className="text-[10px] text-white/60">
                          {getStoreLabel(shiftsForDay)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            }
            expandedContent={
              <div className="space-y-2">
                {expandedKeys.map(key => {
                  const shiftsForDay = scheduleShifts.filter(s => s.shift_date === key);
                  const isToday = key === todayKey;
                  return (
                    <div
                      key={key}
                      className={`flex justify-between items-center py-2 px-3 rounded-lg ${
                        isToday ? "bg-sky-500/20 border border-sky-500/30" : "bg-white/5"
                      }`}
                    >
                      <span className="text-sm font-medium w-24">{formatCstLabel(key)}</span>
                      <span className="text-sm text-gray-300">{getShiftTimeRange(shiftsForDay)}</span>
                      <span className="text-xs text-gray-500">{getStoreLabel(shiftsForDay)}</span>
                    </div>
                  );
                })}
                {showNextWeek && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs uppercase tracking-widest text-white/50">Next 7 days</div>
                    {nextWeekKeys.map(key => {
                      const shiftsForDay = scheduleShifts.filter(s => s.shift_date === key);
                      return (
                        <div
                          key={key}
                          className="flex justify-between items-center py-2 px-3 rounded-lg bg-white/5"
                        >
                          <span className="text-sm font-medium w-24">{formatCstLabel(key)}</span>
                          <span className="text-sm text-gray-300">{getShiftTimeRange(shiftsForDay)}</span>
                          <span className="text-xs text-gray-500">{getStoreLabel(shiftsForDay)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="-mx-4 mt-3 sticky bottom-0 bg-gradient-to-t from-[#0d0f12] via-[#0d0f12]/90 to-transparent px-4 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs py-2 text-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowNextWeek(prev => !prev);
                      }}
                    >
                      {showNextWeek ? "Hide next week" : "Next 7 days"}
                    </button>
                    <Link href="/dashboard/shifts" className="btn-secondary text-xs py-2 text-center">
                      View Full Schedule
                    </Link>
                  </div>
                </div>
              </div>
            }
          />

          {/* CURRENT HOURS - Expandable */}
          <ExpandableCard
            title="CURRENT HOURS"
            icon={Timer}
            iconColor="text-orange-400"
            borderColor="bento-hours"
            disabled={!showMySchedule}
            fullViewLink="/dashboard/shifts"
            fullViewText="View full timecard"
            collapsedContent={
              <div className="text-center">
                <p className="text-3xl font-bold text-white">{currentPeriodHours.toFixed(1)}</p>
                <p className="text-sm text-orange-400">hours this period</p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(payPeriodRange.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - {" "}
                  {new Date(payPeriodRange.end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
            }
            expandedContent={
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-white/10">
                  <span className="text-sm text-gray-400">Period Total</span>
                  <span className="text-xl font-bold text-orange-400">{currentPeriodHours.toFixed(2)} hrs</span>
                </div>
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {timeEntries.slice(0, 5).map((entry) => (
                    <div key={entry.id} className="flex justify-between items-center py-2 px-3 bg-white/5 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(entry.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(entry.started_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - {" "}
                          {entry.ended_at ? new Date(entry.ended_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "--"}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-white">{entry.hours.toFixed(1)}h</span>
                    </div>
                  ))}
                </div>
                {timeEntries.length === 0 && <p className="text-center text-gray-400 py-4">No hours logged this period</p>}
              </div>
            }
          />

          {/* ADMIN */}
          {showAdmin ? (
            <Link href="/admin" className="bento-card bento-admin">
              <div className="flex flex-col items-center justify-center gap-3">
                <Shield className="w-10 h-10 md:w-12 md:h-12 text-pink-400" strokeWidth={1.5} />
                <span className="bento-card-title">ADMIN</span>
              </div>
            </Link>
          ) : (
            <div className="bento-card bento-admin bento-card-disabled">
              <div className="flex flex-col items-center justify-center gap-3">
                <Shield className="w-10 h-10 md:w-12 md:h-12 text-pink-400" strokeWidth={1.5} />
                <span className="bento-card-title">ADMIN</span>
              </div>
            </div>
          )}
        </div>
      </div>

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
    <Suspense fallback={<div className="bento-shell flex items-center justify-center"><div className="text-muted">Loading...</div></div>}>
      <HomePageInner />
    </Suspense>
  );
}
