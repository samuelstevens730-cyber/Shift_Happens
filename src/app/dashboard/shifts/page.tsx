/**
 * Employee Timecard - My Shifts
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { createEmployeeSupabase } from "@/lib/employeeSupabase";
import PinGate from "@/components/PinGate";
import HomeHeader from "@/components/HomeHeader";

type Store = { id: string; name: string };
type Profile = { id: string; name: string; active: boolean | null };

type ShiftRow = {
  id: string;
  store_id: string;
  shift_type: string;
  planned_start_at: string;
  started_at: string;
  ended_at: string | null;
  stores?: { name: string } | null;
};

const PIN_TOKEN_KEY = "sh_pin_token";
const PIN_PROFILE_KEY = "sh_pin_profile_id";

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

function formatCstTime(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCstShortDate(dt: Date) {
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
  });
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

function getPayPeriodKey(dt: Date) {
  const { year, month, day } = getCstDateParts(dt);
  const lastDay = new Date(year, month, 0).getDate();
  if (day <= 15) {
    return `${year}-${String(month).padStart(2, "0")}-01 to ${year}-${String(month).padStart(2, "0")}-15`;
  }
  return `${year}-${String(month).padStart(2, "0")}-16 to ${year}-${String(month).padStart(2, "0")}-${lastDay}`;
}

export default function EmployeeShiftsPage() {
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterStore, setFilterStore] = useState<string>("all");
  const [filterPeriod, setFilterPeriod] = useState<string>("all");

  // Check auth: Supabase session FIRST, then PIN token, then redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    async function checkAuth() {
      // 1. Check Supabase session FIRST
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Manager logged in - get their profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("user_id", user.id)
          .single();
        
        if (profile) {
          setProfileId(profile.id);
          setPinToken("manager"); // Flag to indicate manager auth
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
      window.location.href = "/login?next=/dashboard/shifts";
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
      
      let data: ShiftRow[] | null = null;
      let shiftErr: Error | null = null;
      
      if (pinToken === "manager") {
        // Manager auth - use regular supabase with RLS
        const result = await supabase
          .from("shifts")
          .select("id, store_id, shift_type, planned_start_at, started_at, ended_at, stores(name)")
          .order("planned_start_at", { ascending: false })
          .returns<ShiftRow[]>();
        data = result.data;
        shiftErr = result.error;
      } else {
        // Employee auth - use employee JWT
        const client = createEmployeeSupabase(pinToken);
        const result = await client
          .from("shifts")
          .select("id, store_id, shift_type, planned_start_at, started_at, ended_at, stores(name)")
          .order("planned_start_at", { ascending: false })
          .returns<ShiftRow[]>();
        data = result.data;
        shiftErr = result.error;
      }

      if (!alive) return;
      if (shiftErr) {
        setError(shiftErr.message);
        return;
      }
      setShifts(data ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [pinToken]);

  const periods = useMemo(() => {
    const set = new Set<string>();
    shifts.forEach(s => {
      const dt = new Date(s.planned_start_at ?? s.started_at);
      if (!Number.isNaN(dt.getTime())) set.add(getPayPeriodKey(dt));
    });
    return Array.from(set);
  }, [shifts]);

  const filteredShifts = useMemo(() => {
    return shifts.filter(s => {
      if (filterStore !== "all" && s.store_id !== filterStore) return false;
      if (filterPeriod !== "all") {
        const dt = new Date(s.planned_start_at ?? s.started_at);
        const key = getPayPeriodKey(dt);
        if (key !== filterPeriod) return false;
      }
      return true;
    });
  }, [shifts, filterStore, filterPeriod]);

  const periodTotals = useMemo(() => {
    const totals = new Map<string, number>();
    filteredShifts.forEach(s => {
      if (!s.ended_at) return;
      const start = new Date(s.planned_start_at ?? s.started_at);
      const end = new Date(s.ended_at);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
      const hours = (end.getTime() - start.getTime()) / 3600000;
      const key = getPayPeriodKey(new Date(s.planned_start_at ?? s.started_at));
      totals.set(key, (totals.get(key) ?? 0) + hours);
    });
    return totals;
  }, [filteredShifts]);

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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">My Shifts</h1>
          <span className="text-xs muted">Employee</span>
        </div>

        <div className="card card-pad space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm muted">Store</label>
              <select
                className="select"
                value={filterStore}
                onChange={e => setFilterStore(e.target.value)}
              >
                <option value="all">All stores</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
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
            <div>Clock In</div>
            <div>Clock Out</div>
            <div>Hours</div>
            <div>Status</div>
          </div>
          <div className="space-y-2">
            {filteredShifts.map(s => {
              const start = new Date(s.planned_start_at ?? s.started_at);
              const end = s.ended_at ? new Date(s.ended_at) : null;
              const hours = end ? (end.getTime() - start.getTime()) / 3600000 : null;
              const periodKey = getPayPeriodKey(new Date(s.planned_start_at ?? s.started_at));
              return (
                <div key={s.id} className="grid grid-cols-6 gap-2 text-sm">
                  <div>{formatCstShortDate(new Date(s.planned_start_at ?? s.started_at))}</div>
                  <div>{s.stores?.name ?? s.store_id}</div>
                  <div>{formatCstTime(start)}</div>
                  <div>{end ? formatCstTime(end) : "--"}</div>
                  <div>{hours != null ? hours.toFixed(2) : "--"}</div>
                  <div>{s.ended_at ? "Closed" : "Open"}</div>
                  {filterPeriod === "all" && (
                    <div className="col-span-6 text-xs muted">
                      Pay period: {periodKey}
                    </div>
                  )}
                </div>
              );
            })}
            {!filteredShifts.length && <div className="text-sm muted">No shifts found.</div>}
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
