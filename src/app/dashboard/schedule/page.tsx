/**
 * Employee Schedule - My Schedule
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";
import PinGate from "@/components/PinGate";

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

function formatCstShortDate(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
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
    timeZone: "America/Chicago",
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

function getPayPeriodKey(dateStr: string) {
  const dt = new Date(`${dateStr}T00:00:00`);
  const { year, month, day } = getCstDateParts(dt);
  const lastDay = new Date(year, month, 0).getDate();
  if (day <= 15) {
    return `${year}-${String(month).padStart(2, "0")}-01 to ${year}-${String(month).padStart(2, "0")}-15`;
  }
  return `${year}-${String(month).padStart(2, "0")}-16 to ${year}-${String(month).padStart(2, "0")}-${lastDay}`;
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = sessionStorage.getItem(PIN_TOKEN_KEY);
    if (token) setPinToken(token);
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
      const client = createEmployeeSupabase(pinToken);
      const { data, error: shiftErr } = await client
        .from("schedule_shifts")
        .select(
          "id, store_id, shift_date, shift_type, shift_mode, scheduled_start, scheduled_end, schedules!inner(period_start, period_end, status), stores(name)"
        )
        .order("shift_date", { ascending: false })
        .returns<ScheduleShiftRow[]>();

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
  }, [pinToken]);

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

  return (
    <div className="app-shell">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">My Schedule</h1>
          <span className="text-xs muted">Employee</span>
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

        <div className="card card-pad space-y-3">
          <div className="grid grid-cols-6 gap-2 text-xs muted">
            <div>Date</div>
            <div>Store</div>
            <div>Shift</div>
            <div>Start</div>
            <div>End</div>
            <div>Hours</div>
          </div>
          <div className="space-y-2">
            {filteredShifts.map(s => {
              const hours = calcHours(s.scheduled_start, s.scheduled_end);
              return (
                <div key={s.id} className="grid grid-cols-6 gap-2 text-sm">
                  <div>{formatCstShortDate(new Date(`${s.shift_date}T00:00:00`))}</div>
                  <div>{s.stores?.name ?? s.store_id}</div>
                  <div>{s.shift_type === "open" ? "AM" : s.shift_type === "close" ? "PM" : s.shift_type}</div>
                  <div>{formatTimeLabel(s.scheduled_start)}</div>
                  <div>{formatTimeLabel(s.scheduled_end)}</div>
                  <div>{hours ? hours.toFixed(2) : "--"}</div>
                </div>
              );
            })}
            {!filteredShifts.length && <div className="text-sm muted">No scheduled shifts found.</div>}
          </div>
        </div>

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
