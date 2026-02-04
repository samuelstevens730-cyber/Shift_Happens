/**
 * Employee Schedule - My Schedule
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";
import PinGate from "@/components/PinGate";
import HomeHeader from "@/components/HomeHeader";

type Store = { id: string; name: string };
type Profile = { id: string; name: string; active: boolean | null };

type ScheduleRow = {
  period_start: string;
  period_end: string;
  status: string;
};

type ScheduleShiftRow = {
  id: string;
  store_id: string;
  shift_date: string;
  shift_type: string;
  shift_mode: string;
  scheduled_start: string;
  scheduled_end: string;
  schedules?: ScheduleRow | null;
  stores?: { name: string } | null;
};

const PIN_TOKEN_KEY = "sh_pin_token";
const PIN_PROFILE_KEY = "sh_pin_profile_id";
const CST_TZ = "America/Chicago";

function formatCstLongDate(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    timeZone: CST_TZ,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatCstWeekday(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    timeZone: CST_TZ,
    weekday: "long",
  });
}

function formatCstCompactLabel(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    timeZone: CST_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeLabel(value?: string) {
  if (!value) return "";
  const parts = value.split(":");
  const hour = Number(parts[0]);
  if (Number.isNaN(hour)) return value;
  const minute = (parts[1] ?? "00").slice(0, 2);
  const hour12 = ((hour + 11) % 12) + 1;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour12}:${minute} ${suffix}`;
}

function toMinutes(value?: string) {
  if (!value) return NaN;
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

function calcHours(start: string, end: string) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  if (e < s) e += 24 * 60;
  return (e - s) / 60;
}

function getCstDateParts(dt: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

function getCstDateKey(dt: Date) {
  const { year, month, day } = getCstDateParts(dt);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(dateKey: string, days: number) {
  const dt = new Date(`${dateKey}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return getCstDateKey(dt);
}

function getPayPeriodKey(dateStr: string) {
  const dt = new Date(`${dateStr}T00:00:00`);
  const { year, month, day } = getCstDateParts(dt);
  const lastDay = new Date(year, month, 0).getDate();
  if (day <= 15) {
    return `${year}-${String(month).padStart(2, "0")}-01 to ${year}-${String(month).padStart(2, "0")}-15`;
  }
  return `${year}-${String(month).padStart(2, "0")}-16 to ${year}-${String(month).padStart(2, "0")}-${lastDay}`;
}

function getStoreAccent(name?: string | null) {
  if (!name) {
    return {
      label: "Store",
      color: "rgba(255, 255, 255, 0.6)",
      bg: "rgba(255, 255, 255, 0.08)",
      border: "rgba(255, 255, 255, 0.2)",
    };
  }
  const upper = name.toUpperCase();
  if (upper.includes("LV1")) {
    return {
      label: "LV1",
      color: "rgba(32, 240, 138, 0.95)",
      bg: "rgba(32, 240, 138, 0.12)",
      border: "rgba(32, 240, 138, 0.4)",
    };
  }
  if (upper.includes("LV2")) {
    return {
      label: "LV2",
      color: "rgba(180, 112, 255, 0.95)",
      bg: "rgba(180, 112, 255, 0.16)",
      border: "rgba(180, 112, 255, 0.5)",
    };
  }
  return {
    label: name,
    color: "rgba(255, 255, 255, 0.7)",
    bg: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.2)",
  };
}

function getShiftTypeLabel(shift: ScheduleShiftRow) {
  if (shift.shift_mode === "double") return "Double";
  if (shift.shift_type === "open") return "AM";
  if (shift.shift_type === "close") return "PM";
  if (shift.shift_type === "other") return "Other";
  return shift.shift_type;
}

function getShiftStatusLabel(shiftDate: string, shifts: ScheduleShiftRow[]) {
  if (!shifts.length) return { label: "Off today", tone: "muted" as const };
  const nowCst = new Date(new Date().toLocaleString("en-US", { timeZone: CST_TZ }));
  const todayKey = getCstDateKey(nowCst);
  if (shiftDate !== todayKey) return { label: "Scheduled", tone: "muted" as const };

  const sorted = [...shifts].sort(
    (a, b) => toMinutes(a.scheduled_start) - toMinutes(b.scheduled_start)
  );
  const primary = sorted[0];
  const startMin = toMinutes(primary.scheduled_start);
  let endMin = toMinutes(primary.scheduled_end);
  if (Number.isNaN(startMin) || Number.isNaN(endMin)) return { label: "Scheduled", tone: "muted" as const };
  if (endMin < startMin) endMin += 24 * 60;
  const nowMin = nowCst.getHours() * 60 + nowCst.getMinutes();

  if (nowMin >= startMin && nowMin < endMin) {
    return { label: "Working now", tone: "active" as const };
  }
  if (nowMin < startMin) {
    const diff = startMin - nowMin;
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;
    if (hours >= 1) {
      return { label: `Starts in ${hours} hr${hours > 1 ? "s" : ""}`, tone: "upcoming" as const };
    }
    return { label: `Starts in ${minutes} min`, tone: "upcoming" as const };
  }
  return { label: "Shift complete", tone: "muted" as const };
}

function getWeekStartKey(dateKey: string) {
  const dt = new Date(`${dateKey}T00:00:00`);
  const day = dt.getDay();
  const diff = (day + 6) % 7;
  dt.setDate(dt.getDate() - diff);
  return getCstDateKey(dt);
}

function StoreBadge({ name }: { name?: string | null }) {
  const accent = getStoreAccent(name);
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: accent.color, background: accent.bg, borderColor: accent.border }}
    >
      {accent.label}
    </span>
  );
}

function ShiftTypeBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80">
      {label}
    </span>
  );
}

function WeekCard({
  dateKey,
  shifts,
}: {
  dateKey: string;
  shifts: ScheduleShiftRow[];
}) {
  const dt = new Date(`${dateKey}T00:00:00`);
  const orderedShifts = [...shifts].sort(
    (a, b) => toMinutes(a.scheduled_start) - toMinutes(b.scheduled_start)
  );
  const storeName = orderedShifts[0]?.stores?.name ?? orderedShifts[0]?.store_id;
  const hasShift = orderedShifts.length > 0;
  const shiftLabel = hasShift
    ? orderedShifts.length > 1
      ? "Multiple"
      : getShiftTypeLabel(orderedShifts[0])
    : "No shift";
  const timeLabel = hasShift
    ? orderedShifts
        .map(s => `${formatTimeLabel(s.scheduled_start)} - ${formatTimeLabel(s.scheduled_end)}`)
        .join(" / ")
    : "Off";
  const totalHours = hasShift
    ? orderedShifts.reduce((total, s) => total + calcHours(s.scheduled_start, s.scheduled_end), 0)
    : 0;

  return (
    <details className={`card ${!hasShift ? "card-muted" : ""} card-pad`}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
        <div className="flex flex-col">
          <span className="text-xs muted">{formatCstCompactLabel(dt)}</span>
          <span className={`text-base font-semibold ${!hasShift ? "muted" : ""}`}>{shiftLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasShift && <StoreBadge name={storeName} />}
          <span className={`text-sm font-semibold ${!hasShift ? "muted" : ""}`}>{timeLabel}</span>
        </div>
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="muted">Time</span>
          <span className={!hasShift ? "muted" : ""}>{timeLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="muted">Hours</span>
          <span className={!hasShift ? "muted" : ""}>{hasShift ? `${totalHours.toFixed(2)} hrs` : "--"}</span>
        </div>
        {hasShift && (
          <div className="flex flex-wrap items-center gap-2">
            <StoreBadge name={storeName} />
            <ShiftTypeBadge label={shiftLabel} />
          </div>
        )}
      </div>
    </details>
  );
}

export default function EmployeeSchedulePage() {
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [scheduleShifts, setScheduleShifts] = useState<ScheduleShiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  // Check auth: Supabase session FIRST, then PIN token, then redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    async function checkAuth() {
      // 1. Check Supabase session FIRST
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Manager logged in - allow schedule access regardless of profile row
        setPinToken("manager"); // Flag to indicate manager auth

        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (profile) {
          setProfileId(profile.id);
        }
        return;
      }
      
      // 2. No Supabase session - check for PIN token (employee auth)
      const token = sessionStorage.getItem(PIN_TOKEN_KEY);
      if (token) {
        setPinToken(token);
        const storedProfile = sessionStorage.getItem(PIN_PROFILE_KEY);
        if (storedProfile) setProfileId(storedProfile);
        return;
      }
      
      // 3. No auth at all - redirect to login
      window.location.href = "/login?next=/dashboard/schedule";
    }
    
    checkAuth();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: storeData } = await supabase
          .from("stores")
          .select("id, name")
          .order("name", { ascending: true })
          .returns<Store[]>();

        const { data: profileData } = await supabase
          .from("profiles")
          .select("id, name, active")
          .order("name", { ascending: true })
          .returns<Profile[]>();

        if (!alive) return;
        const filteredProfiles = (profileData ?? []).filter(p => p.active !== false);
        setStores(storeData ?? []);
        setProfiles(filteredProfiles);
        if (!storeId) setStoreId(storeData?.[0]?.id ?? "");
        if (!profileId) setProfileId(filteredProfiles?.[0]?.id ?? "");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storeId, profileId]);

  useEffect(() => {
    if (!pinToken) return;
    let alive = true;
    (async () => {
      setError(null);
      
      let data: ScheduleShiftRow[] | null = null;
      let shiftErr: Error | null = null;
      
      if (pinToken === "manager") {
        // Manager auth - use regular supabase with RLS
        if (!profileId) {
          setScheduleShifts([]);
          setError("No profile is linked to this manager account. Ask an admin to link your profile.");
          return;
        }
        let query = supabase
          .from("schedule_shifts")
          .select(
            "id, store_id, shift_date, shift_type, shift_mode, scheduled_start, scheduled_end, schedules!inner(period_start, period_end, status), stores(name)"
          )
          .eq("schedules.status", "published")
          .order("shift_date", { ascending: true });

        query = query.eq("profile_id", profileId);

        const result = await query.returns<ScheduleShiftRow[]>();
        data = result.data;
        shiftErr = result.error;
      } else {
        // Employee auth - use employee JWT
        const client = createEmployeeSupabase(pinToken);
        const result = await client
          .from("schedule_shifts")
          .select(
            "id, store_id, shift_date, shift_type, shift_mode, scheduled_start, scheduled_end, schedules!inner(period_start, period_end, status), stores(name)"
          )
          .eq("schedules.status", "published")
          .order("shift_date", { ascending: true })
          .returns<ScheduleShiftRow[]>();
        data = result.data;
        shiftErr = result.error;
      }

      if (!alive) return;
      if (shiftErr) {
        setError(shiftErr.message);
        return;
      }
      setScheduleShifts(data ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [pinToken, refreshKey]);

  const periods = useMemo(() => {
    const set = new Set<string>();
    scheduleShifts.forEach(s => {
      set.add(getPayPeriodKey(s.shift_date));
    });
    return Array.from(set);
  }, [scheduleShifts]);

  const filteredShifts = useMemo(() => {
    return scheduleShifts.filter(s => {
      if (filterPeriod !== "all") {
        const key = getPayPeriodKey(s.shift_date);
        if (key !== filterPeriod) return false;
      }
      return true;
    });
  }, [scheduleShifts, filterPeriod]);

  const periodTotals = useMemo(() => {
    const totals = new Map<string, number>();
    filteredShifts.forEach(s => {
      const hours = calcHours(s.scheduled_start, s.scheduled_end);
      const key = getPayPeriodKey(s.shift_date);
      totals.set(key, (totals.get(key) ?? 0) + hours);
    });
    return totals;
  }, [filteredShifts]);

  const todayKey = getCstDateKey(new Date());
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, ScheduleShiftRow[]>();
    filteredShifts.forEach(shift => {
      const key = shift.shift_date;
      const list = map.get(key) ?? [];
      list.push(shift);
      map.set(key, list);
    });
    return map;
  }, [filteredShifts]);

  const todayShifts = shiftsByDate.get(todayKey) ?? [];
  const todayDate = new Date(`${todayKey}T00:00:00`);
  const todayStatus = getShiftStatusLabel(todayKey, todayShifts);
  const todayStoreName = todayShifts[0]?.stores?.name ?? todayShifts[0]?.store_id;
  const todayShiftType = todayShifts.length > 1 ? "Double" : todayShifts[0] ? getShiftTypeLabel(todayShifts[0]) : "Off";
  const todayTimeRange = todayShifts.length
    ? todayShifts
        .map(s => `${formatTimeLabel(s.scheduled_start)} - ${formatTimeLabel(s.scheduled_end)}`)
        .join(" / ")
    : "No shift scheduled";
  const todayHours = todayShifts.reduce(
    (total, s) => total + calcHours(s.scheduled_start, s.scheduled_end),
    0
  );

  const weekDays = useMemo(() => {
    return Array.from({ length: 6 }).map((_, idx) => addDays(todayKey, idx + 1));
  }, [todayKey]);

  const futureShiftDates = useMemo(() => {
    const cutoff = addDays(todayKey, 6);
    return Array.from(shiftsByDate.keys()).filter(key => key > cutoff);
  }, [shiftsByDate, todayKey]);

  const futureWeeks = useMemo(() => {
    const groups = new Set<string>();
    futureShiftDates.forEach(dateKey => {
      groups.add(getWeekStartKey(dateKey));
    });
    return Array.from(groups.values()).sort((a, b) => a.localeCompare(b));
  }, [futureShiftDates]);

  // Check if user is manager for HomeHeader
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsManager(!!data.user);
    });
  }, []);

  return (
    <div className="bento-shell">
      <HomeHeader isManager={isManager} />
      <div className="max-w-4xl mx-auto space-y-4 px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">My Schedule</h1>
            <p className="text-sm muted">Tap a day to expand details. Pull to refresh if updates are missing.</p>
          </div>
          <button
            className="btn-secondary px-4 py-2 text-sm"
            type="button"
            onClick={() => setRefreshKey(prev => prev + 1)}
          >
            Refresh
          </button>
        </div>

        <div className="card card-pad space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm muted">Pay period</label>
              <select
                className="select"
                value={filterPeriod}
                onChange={e => setFilterPeriod(e.target.value)}
              >
                <option value="all">All periods</option>
                {periods.map(p => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <section className="space-y-3">
          <div className="text-sm uppercase tracking-widest text-white/40">Today</div>
          <div className="card card-pad space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-3xl font-semibold">{formatCstLongDate(todayDate)}</div>
                <div className="text-sm muted">{formatCstWeekday(todayDate)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {todayShifts.length > 0 && <StoreBadge name={todayStoreName} />}
                <ShiftTypeBadge label={todayShiftType} />
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-lg font-semibold">{todayTimeRange}</div>
              <div className="text-sm muted">{todayHours ? `${todayHours.toFixed(2)} hrs` : "0.00 hrs"}</div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                  todayStatus.tone === "active"
                    ? "border-green-400/40 text-green-200"
                    : todayStatus.tone === "upcoming"
                    ? "border-purple-400/40 text-purple-200"
                    : "border-white/10 text-white/70"
                }`}
              >
                {todayStatus.label}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm uppercase tracking-widest text-white/40">This Week</div>
            <span className="text-xs muted">Next 6 days</span>
          </div>
          <div className="space-y-3">
            {weekDays.map(dateKey => (
              <WeekCard
                key={dateKey}
                dateKey={dateKey}
                shifts={shiftsByDate.get(dateKey) ?? []}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <details className="card card-pad">
            <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold">
              <span>Future Weeks</span>
              <span className="text-xs muted">{futureWeeks.length} week{futureWeeks.length === 1 ? "" : "s"}</span>
            </summary>
            <div className="mt-4 space-y-4">
              {futureWeeks.length === 0 && (
                <div className="text-sm muted">No future shifts beyond this week.</div>
              )}
              {futureWeeks.map(weekKey => (
                <div key={weekKey} className="space-y-2">
                  <div className="text-xs uppercase tracking-widest text-white/40">
                    Week of {formatCstCompactLabel(new Date(`${weekKey}T00:00:00`))}
                  </div>
                  <div className="space-y-2">
                    {Array.from({ length: 7 }).map((_, idx) => {
                      const dateKey = addDays(weekKey, idx);
                      return (
                        <WeekCard key={dateKey} dateKey={dateKey} shifts={shiftsByDate.get(dateKey) ?? []} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>

        {periodTotals.size > 0 && (
          <div className="card card-pad space-y-2">
            <div className="text-sm font-medium">Total hours by pay period</div>
            <div className="space-y-1 text-sm">
              {Array.from(periodTotals.entries()).map(([period, total]) => (
                <div key={period} className="flex items-center justify-between">
                  <span>{period}</span>
                  <span className="font-semibold">{total.toFixed(2)} hrs</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!filteredShifts.length && (
          <div className="card card-pad text-sm muted">No scheduled shifts found.</div>
        )}
      </div>

      <PinGate
        loading={loading}
        stores={stores}
        profiles={profiles}
        qrToken=""
        tokenStore={null}
        storeId={storeId}
        setStoreId={setStoreId}
        profileId={profileId}
        setProfileId={setProfileId}
        onAuthorized={setPinToken}
      />
    </div>
  );
}

