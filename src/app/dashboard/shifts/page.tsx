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

type ShiftRow = {
  id: string;
  store_id: string;
  shift_type: string;
  planned_start_at: string;
  started_at: string;
  ended_at: string | null;
  stores?: { name: string } | null;
};

type CoverageRow = {
  id: string;
  coverage_store_id: string;
  shift_date: string;
  time_in: string;
  time_out: string;
  notes: string | null;
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
    weekday: "short",
    month: "short",
    day: "numeric",
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
  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [managerProfileId, setManagerProfileId] = useState("");
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [coverageShifts, setCoverageShifts] = useState<CoverageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterStore, setFilterStore] = useState<string>("all");
  const [filterPeriod, setFilterPeriod] = useState<string>("all");
  const [expandedShiftIds, setExpandedShiftIds] = useState<Set<string>>(new Set());

  // Check auth: Supabase session FIRST, then PIN token, then redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    async function checkAuth() {
      // 1. Check Supabase session FIRST
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Manager logged in - get their profile
        setPinToken("manager"); // Flag to indicate manager auth
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        
        if (profile) {
          setManagerProfileId(profile.id);
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
    if (pinToken === "manager") return;
    let alive = true;
    (async () => {
      try {
        const { data: storeData } = await supabase
          .from("stores")
          .select("id, name")
          .order("name", { ascending: true })
          .returns<Store[]>();

        if (!alive) return;
        setStores(storeData ?? []);
        if (!storeId) setStoreId(storeData?.[0]?.id ?? "");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pinToken, storeId, profileId]);

  useEffect(() => {
    if (!pinToken) return;
    let alive = true;
    (async () => {
      setError(null);
      
      let data: ShiftRow[] | null = null;
      let shiftErr: Error | null = null;
      
      if (pinToken === "manager") {
        // Manager auth - use regular supabase with RLS
        if (!managerProfileId) {
          setShifts([]);
          setError("No profile is linked to this manager account. Ask an admin to link your profile.");
          return;
        }
        let query = supabase
          .from("shifts")
          .select("id, store_id, shift_type, planned_start_at, started_at, ended_at, stores(name)")
          .order("planned_start_at", { ascending: false });
        query = query.eq("profile_id", managerProfileId);
        const result = await query.returns<ShiftRow[]>();
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

      // Fetch approved coverage shifts — mirror the EXACT same auth branching above
      let coverageData: CoverageRow[] = [];
      if (pinToken === "manager") {
        // Manager Supabase session — use `supabase` client + explicit profile_id filter
        const { data: covData } = await supabase
          .from("coverage_shift_requests")
          .select("id, coverage_store_id, shift_date, time_in, time_out, notes, stores:coverage_store_id(name)")
          .eq("profile_id", managerProfileId)
          .eq("status", "approved")
          .order("time_in", { ascending: false });
        coverageData = (covData ?? []) as unknown as CoverageRow[];
      } else {
        // Employee PIN auth — createEmployeeSupabase embeds the PIN JWT
        const client = createEmployeeSupabase(pinToken!);
        const { data: covData } = await client
          .from("coverage_shift_requests")
          .select("id, coverage_store_id, shift_date, time_in, time_out, notes, stores:coverage_store_id(name)")
          .eq("status", "approved")
          .order("time_in", { ascending: false });
        coverageData = (covData ?? []) as unknown as CoverageRow[];
      }
      if (alive) setCoverageShifts(coverageData);
    })();
    return () => {
      alive = false;
    };
  }, [pinToken, managerProfileId, profileId]);

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
    coverageShifts.forEach(c => {
      const start = new Date(c.time_in);
      const end   = new Date(c.time_out);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
      const hours = (end.getTime() - start.getTime()) / 3_600_000;
      const key   = getPayPeriodKey(new Date(c.time_in));
      totals.set(key, (totals.get(key) ?? 0) + hours);
    });
    return totals;
  }, [filteredShifts, coverageShifts]);

  // Check if user is manager for HomeHeader
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsManager(!!data.user);
    });
  }, []);

  return (
    <div className="bento-shell">
      <HomeHeader
        isManager={isManager}
        isAuthenticated={Boolean(pinToken) || Boolean(managerProfileId)}
        profileId={managerProfileId || profileId || null}
      />
      <div className="w-full space-y-4 px-4 py-4">
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

        <div className="space-y-3">
          {filteredShifts.map(s => {
            const start = new Date(s.planned_start_at ?? s.started_at);
            const end = s.ended_at ? new Date(s.ended_at) : null;
            const hours = end ? (end.getTime() - start.getTime()) / 3600000 : null;
            const periodKey = getPayPeriodKey(new Date(s.planned_start_at ?? s.started_at));
            const isExpanded = expandedShiftIds.has(s.id);
            return (
              <div key={s.id} className="card card-pad">
                <button
                  type="button"
                  className="w-full text-left"
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpandedShiftIds(prev => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{formatCstShortDate(start)}</div>
                      <div className="text-xs muted truncate">{s.stores?.name ?? s.store_id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-xs font-medium text-cyan-200">
                        {hours != null ? `${hours.toFixed(2)} hrs` : "--"}
                      </span>
                      <span className="text-xs muted">{isExpanded ? "Hide" : "Details"}</span>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-xs muted">Time In</div>
                      <div>{formatCstTime(start)}</div>
                    </div>
                    <div>
                      <div className="text-xs muted">Time Out</div>
                      <div>{end ? formatCstTime(end) : "--"}</div>
                    </div>
                    <div>
                      <div className="text-xs muted">Status</div>
                      <div>
                        <span
                          className={
                            s.ended_at
                              ? "inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/80"
                              : "inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300"
                          }
                        >
                          {s.ended_at ? "Closed" : "Open"}
                        </span>
                      </div>
                    </div>
                    {filterPeriod === "all" && (
                      <div>
                        <div className="text-xs muted">Pay Period</div>
                        <div>{periodKey}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!filteredShifts.length && (
            <div className="card card-pad text-sm muted">No shifts found.</div>
          )}
          {coverageShifts.map(c => (
            <div key={c.id} className="card card-pad space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs rounded-full px-2 py-0.5 bg-blue-500/20 text-blue-300 font-semibold">
                  Coverage
                </span>
                <span className="text-sm font-medium">{c.stores?.name ?? "Other store"}</span>
              </div>
              <div className="text-sm muted">{c.shift_date}</div>
              <div className="text-sm muted">
                {new Date(c.time_in).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}
                {" – "}
                {new Date(c.time_out).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}
                {" · "}
                {((new Date(c.time_out).getTime() - new Date(c.time_in).getTime()) / 3_600_000).toFixed(1)} hrs
              </div>
              {c.notes && <div className="text-xs muted italic">{c.notes}</div>}
            </div>
          ))}
        </div>
      </div>

      <PinGate
        loading={loading}
        stores={stores}
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
