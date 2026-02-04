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
type Profile = { id: string; name: string; active: boolean | null };
type EmployeeMessage = { id: string; content: string; created_at: string };

type ScheduleShift = {
  id: string;
  shift_date: string;
  shift_type: string;
  scheduled_start: string;
  scheduled_end: string;
  stores?: { name: string } | null;
};

  type TimeEntry = {
    id: string;
    planned_start_at?: string | null;
    started_at: string;
    ended_at: string | null;
    hours: number;
  };

function HomePageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const preselectedStore = searchParams.get("store");

  // Auth state
  const [hasAdminAuth, setHasAdminAuth] = useState(false);
  const [hasPinAuth, setHasPinAuth] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Modal state
  const [showAuthModal, setShowAuthModal] = useState(false);

  // PIN gate state
  const [showPinGate, setShowPinGate] = useState(false);
  const [pinLoading, setPinLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
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
      if (typeof window !== "undefined") {
        const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
        const pinStore = sessionStorage.getItem(PIN_STORE_KEY);
        const pinProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
        pinAuthed = !!(pinToken && pinStore && pinProfile);
      }

      if (!alive) return;

      setHasAdminAuth(adminAuthed);
      setHasPinAuth(pinAuthed);
      setAuthChecked(true);

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

      // Fetch schedule shifts (next 7 days)
      const today = new Date().toISOString().split("T")[0];
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      
      const { data: shifts } = await client
        .from("schedule_shifts")
        .select("id, shift_date, shift_type, scheduled_start, scheduled_end, stores(name), schedules!inner(status)")
        .eq("schedules.status", "published")
        .eq("profile_id", targetProfileId)
        .gte("shift_date", today)
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

  // Fetch stores/profiles when showing PIN gate
  useEffect(() => {
    if (!showPinGate) return;

    let alive = true;
    setPinLoading(true);

    async function loadData() {
      try {
        const [storesRes, profilesRes] = await Promise.all([
          supabase.from("stores").select("id, name").order("name"),
          supabase.from("profiles").select("id, name, active").order("name"),
        ]);

        if (!alive) return;

        const storesData = storesRes.data || [];
        const profilesData = (profilesRes.data || []).filter(
          (p) => p.active !== false
        );

        setStores(storesData);
        setProfiles(profilesData);

        // Set defaults - use preselected store from QR if available
        if (preselectedStore && storesData.find((s: Store) => s.id === preselectedStore)) {
          setStoreId(preselectedStore);
        } else if (storesData.length > 0 && !storeId) {
          setStoreId(storesData[0].id);
        }
        if (profilesData.length > 0 && !profileId) {
          setProfileId(profilesData[0].id);
        }
      } finally {
        if (alive) setPinLoading(false);
      }
    }

    loadData();
    return () => { alive = false; };
  }, [showPinGate, preselectedStore, storeId, profileId]);

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

  // Nav items: HOME | ADMIN | LOGOUT
  const navItems = [
    { href: "/", label: "HOME", active: pathname === "/" },
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
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              sessionStorage.removeItem(PIN_TOKEN_KEY);
              sessionStorage.removeItem(PIN_STORE_KEY);
              sessionStorage.removeItem(PIN_PROFILE_KEY);
              setHasAdminAuth(false);
              setHasPinAuth(false);
              router.push("/");
            }}
            className="bento-nav-link bento-nav-inactive"
          >
            LOGOUT
          </button>
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
              scheduleShifts.length > 0 ? (
                <div className="text-center">
                  <p className="text-lg font-bold text-white">
                    {new Date(scheduleShifts[0].shift_date).toLocaleDateString("en-US", { weekday: "short" })}
                  </p>
                  <p className="text-sm text-sky-400">
                    {scheduleShifts[0].scheduled_start?.slice(0, 5)} - {scheduleShifts[0].scheduled_end?.slice(0, 5)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(scheduleShifts[0].shift_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
              ) : (
                <p className="text-gray-400 text-sm">No upcoming shifts</p>
              )
            }
            expandedContent={
              <div className="space-y-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, idx) => {
                  const shift = scheduleShifts.find(s => new Date(s.shift_date).getDay() === idx);
                  const isToday = new Date().getDay() === idx;
                  return (
                    <div
                      key={day}
                      className={`flex justify-between items-center py-2 px-3 rounded-lg ${
                        isToday ? "bg-sky-500/20 border border-sky-500/30" : "bg-white/5"
                      }`}
                    >
                      <span className="text-sm font-medium w-10">{day}</span>
                      <span className="text-sm text-gray-300">
                        {shift ? `${shift.scheduled_start?.slice(0, 5)} - ${shift.scheduled_end?.slice(0, 5)}` : "OFF"}
                      </span>
                      {shift && (
                        <span className="text-xs text-gray-500">
                          {((new Date(`2000-01-01T${shift.scheduled_end}`).getTime() - 
                            new Date(`2000-01-01T${shift.scheduled_start}`).getTime()) / 3600000).toFixed(1)}h
                        </span>
                      )}
                    </div>
                  );
                })}
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4">
          <div className="card card-pad w-full max-w-sm space-y-6">
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
          profiles={profiles}
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
