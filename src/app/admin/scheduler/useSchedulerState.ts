"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export type Store = { id: string; name: string };
export type TemplateRow = {
  id: string;
  store_id: string;
  day_of_week: number;
  shift_type: "open" | "close";
  start_time: string;
  end_time: string;
  is_overnight: boolean | null;
};
export type MembershipRow = {
  store_id: string;
  profile: { id: string; name: string | null; active: boolean | null } | null;
};
export type ScheduleRow = {
  id: string;
  store_id: string;
  period_start: string;
  period_end: string;
  status: string;
};
export type ShiftRow = {
  id: string;
  schedule_id: string;
  store_id: string;
  profile_id: string;
  shift_date: string;
  shift_type: "open" | "close";
  shift_mode: "standard" | "double" | "other";
  scheduled_start: string;
  scheduled_end: string;
};

export type Assignment = {
  profileId: string | null;
  shiftMode: "standard" | "double" | "other";
  scheduledStart?: string;
  scheduledEnd?: string;
};

type SchedulesResponse = {
  stores: Store[];
  memberships: MembershipRow[];
  templates: TemplateRow[];
  schedules: ScheduleRow[];
};

type ScheduleDetailResponse = {
  schedule: ScheduleRow;
  shifts: ShiftRow[];
  templates: TemplateRow[];
  memberships: MembershipRow[];
};

export const SHIFT_TYPES: Array<{ key: "open" | "close"; label: string }> = [
  { key: "open", label: "AM" },
  { key: "close", label: "PM" },
];

async function getBearerToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getPeriodBounds(monthStr: string, half: "first" | "second") {
  const [y, m] = monthStr.split("-").map(n => Number(n));
  const lastDay = new Date(y, m, 0).getDate();
  const start = half === "first" ? 1 : 16;
  const end = half === "first" ? 15 : lastDay;
  return {
    start: new Date(y, m - 1, start),
    end: new Date(y, m - 1, end),
  };
}

function dateRange(start: Date, end: Date) {
  const out: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    out.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(n => Number(n));
  return h * 60 + (m || 0);
}

export function calcHours(start: string, end: string) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  if (e < s) e += 24 * 60;
  return (e - s) / 60;
}

export function formatTimeLabel(value?: string) {
  if (!value) return "";
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  if (Number.isNaN(hour)) return value;
  const minute = (rawMinute ?? "00").slice(0, 2);
  const hour12 = ((hour + 11) % 12) + 1;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour12}:${minute} ${suffix}`;
}

function getWeekKey(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

export function hashColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const colors = [
    "bg-green-500/20 text-green-200 border-green-400/40",
    "bg-purple-500/20 text-purple-200 border-purple-400/40",
    "bg-cyan-500/20 text-cyan-200 border-cyan-400/40",
    "bg-amber-500/20 text-amber-200 border-amber-400/40",
    "bg-pink-500/20 text-pink-200 border-pink-400/40",
  ];
  return colors[Math.abs(hash) % colors.length];
}

export function assignmentKey(storeId: string, dateStr: string, shiftType: "open" | "close") {
  return `${storeId}|${dateStr}|${shiftType}`;
}

export function useSchedulerState() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const today = new Date();
  const [month, setMonth] = useState(() => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [half, setHalf] = useState<"first" | "second">(today.getDate() <= 15 ? "first" : "second");

  const [stores, setStores] = useState<Store[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [scheduleMap, setScheduleMap] = useState<Record<string, ScheduleRow>>({});
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const autoEnsureOnceRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/scheduler");
          return;
        }
        setIsAuthed(true);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to authenticate.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const loadMeta = useCallback(async () => {
    setError(null);
    const token = await getBearerToken();
    if (!token) {
      router.replace("/login?next=/admin/scheduler");
      return null;
    }
    const res = await fetch("/api/admin/schedules", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as SchedulesResponse | { error: string };
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load schedules.");
      return null;
    }
    setStores(json.stores);
    setTemplates(
      (json.templates ?? []).map((t: TemplateRow) => ({
        ...t,
        day_of_week: Number(t.day_of_week),
      }))
    );
    setMemberships(json.memberships);
    setSchedules(json.schedules);
    return json;
  }, [router]);

  useEffect(() => {
    if (!isAuthed) return;
    void loadMeta();
  }, [isAuthed, loadMeta]);

  const { start, end } = useMemo(() => getPeriodBounds(month, half), [month, half]);
  const periodStart = toISODate(start);
  const periodEnd = toISODate(end);
  const dates = useMemo(() => dateRange(start, end), [start, end]);

  useEffect(() => {
    const map: Record<string, ScheduleRow> = {};
    schedules.forEach(s => {
      if (s.period_start === periodStart && s.period_end === periodEnd) {
        map[s.store_id] = s;
      }
    });
    setScheduleMap(map);
  }, [schedules, periodStart, periodEnd]);

  const getScheduleForStore = useCallback(
    (storeId: string, list: ScheduleRow[] = schedules) =>
      list.find(s => s.store_id === storeId && s.period_start === periodStart && s.period_end === periodEnd) ?? null,
    [schedules, periodStart, periodEnd]
  );

  const loadDetails = useCallback(async () => {
    const token = await getBearerToken();
    if (!token) return;
    const nextAssignments: Record<string, Assignment> = {};
    for (const store of stores) {
      const schedule = getScheduleForStore(store.id);
      if (!schedule) continue;
      const res = await fetch(`/api/admin/schedules/${schedule.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as ScheduleDetailResponse | { error: string };
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to load schedule details.");
        return;
      }
      (json.shifts ?? []).forEach(s => {
        const key = assignmentKey(s.store_id, s.shift_date, s.shift_type);
        nextAssignments[key] = {
          profileId: s.profile_id,
          shiftMode: s.shift_mode,
          scheduledStart: s.scheduled_start,
          scheduledEnd: s.scheduled_end,
        };
      });
    }
    setAssignments(nextAssignments);
    setDirtyKeys(new Set());
  }, [stores, getScheduleForStore]);

  useEffect(() => {
    if (!isAuthed) return;
    void loadDetails();
  }, [isAuthed, loadDetails]);

  const employeesByStore = useMemo(() => {
    const map: Record<string, Array<{ id: string; name: string }>> = {};
    memberships.forEach(m => {
      if (!m.profile || m.profile.active === false) return;
      if (!map[m.store_id]) map[m.store_id] = [];
      map[m.store_id].push({ id: m.profile.id, name: m.profile.name ?? "Unnamed" });
    });
    Object.values(map).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
    return map;
  }, [memberships]);

  const templatesByStore = useMemo(() => {
    const map: Record<string, TemplateRow[]> = {};
    templates.forEach(t => {
      if (!map[t.store_id]) map[t.store_id] = [];
      map[t.store_id].push(t);
    });
    return map;
  }, [templates]);

  const templateLookup = useCallback(
    (storeId: string, dateStr: string, shiftType: "open" | "close") => {
      const d = new Date(`${dateStr}T00:00:00`);
      const dow = d.getDay();
      return (templatesByStore[storeId] ?? []).find(t => t.day_of_week === dow && t.shift_type === shiftType);
    },
    [templatesByStore]
  );

  const setAssignment = useCallback((storeId: string, dateStr: string, shiftType: "open" | "close", next: Assignment) => {
    const key = assignmentKey(storeId, dateStr, shiftType);
    setAssignments(prev => ({ ...prev, [key]: next }));
    setDirtyKeys(prev => new Set(prev).add(key));
  }, []);

  const handleEmployeeChange = useCallback(
    (storeId: string, dateStr: string, shiftType: "open" | "close", profileId: string) => {
      const current = assignments[assignmentKey(storeId, dateStr, shiftType)];
      const shiftMode = current?.shiftMode ?? "standard";
      setAssignment(storeId, dateStr, shiftType, { ...current, profileId, shiftMode });
    },
    [assignments, setAssignment]
  );

  const handleModeChange = useCallback(
    (storeId: string, dateStr: string, shiftType: "open" | "close", shiftMode: Assignment["shiftMode"]) => {
      const key = assignmentKey(storeId, dateStr, shiftType);
      const current = assignments[key];
      if (shiftMode === "double") {
        const profileId = current?.profileId || "";
        if (!profileId) {
          setError("Select an employee before choosing Double.");
          return;
        }
        setAssignment(storeId, dateStr, "open", { profileId, shiftMode: "double" });
        setAssignment(storeId, dateStr, "close", { profileId, shiftMode: "double" });
        return;
      }
      setAssignment(storeId, dateStr, shiftType, { ...current, shiftMode });
    },
    [assignments, setAssignment]
  );

  const handleOtherTimeChange = useCallback(
    (storeId: string, dateStr: string, shiftType: "open" | "close", field: "start" | "end", value: string) => {
      const key = assignmentKey(storeId, dateStr, shiftType);
      const current = assignments[key];
      if (!current) return;
      const next = { ...current };
      if (field === "start") next.scheduledStart = value;
      if (field === "end") next.scheduledEnd = value;
      setAssignment(storeId, dateStr, shiftType, next);
    },
    [assignments, setAssignment]
  );

  const totals = useMemo(() => {
    const byEmployee: Record<string, number> = {};
    const byStore: Record<string, number> = {};
    let grandTotal = 0;

    for (const store of stores) {
      for (const dateStr of dates) {
        for (const shiftType of SHIFT_TYPES) {
          const key = assignmentKey(store.id, dateStr, shiftType.key);
          const a = assignments[key];
          if (!a?.profileId) continue;
          const tpl = templateLookup(store.id, dateStr, shiftType.key);
          const startAt = a.shiftMode === "other" ? a.scheduledStart : tpl?.start_time;
          const endAt = a.shiftMode === "other" ? a.scheduledEnd : tpl?.end_time;
          if (!startAt || !endAt) continue;
          const hours = calcHours(startAt, endAt);
          byEmployee[a.profileId] = (byEmployee[a.profileId] ?? 0) + hours;
          byStore[store.id] = (byStore[store.id] ?? 0) + hours;
          grandTotal += hours;
        }
      }
    }

    return { byEmployee, byStore, grandTotal };
  }, [assignments, dates, stores, templateLookup]);

  const weeklyWarnings = useMemo(() => {
    const byEmployeeWeek: Record<string, number> = {};
    for (const store of stores) {
      for (const dateStr of dates) {
        for (const shiftType of SHIFT_TYPES) {
          const key = assignmentKey(store.id, dateStr, shiftType.key);
          const a = assignments[key];
          if (!a?.profileId) continue;
          const tpl = templateLookup(store.id, dateStr, shiftType.key);
          const startAt = a.shiftMode === "other" ? a.scheduledStart : tpl?.start_time;
          const endAt = a.shiftMode === "other" ? a.scheduledEnd : tpl?.end_time;
          if (!startAt || !endAt) continue;
          const hours = calcHours(startAt, endAt);
          const weekKey = `${a.profileId}:${getWeekKey(dateStr)}`;
          byEmployeeWeek[weekKey] = (byEmployeeWeek[weekKey] ?? 0) + hours;
        }
      }
    }
    return Object.entries(byEmployeeWeek)
      .filter(([, hours]) => hours > 40)
      .map(([key, hours]) => {
        const [profileId, weekStart] = key.split(":");
        const name = memberships.find(m => m.profile?.id === profileId)?.profile?.name ?? profileId.slice(0, 8);
        return `${name} exceeds 40 hrs (week of ${weekStart}): ${hours.toFixed(2)} hrs`;
      });
  }, [assignments, dates, stores, templateLookup, memberships]);

  const conflictDetails = useMemo(() => {
    const seen = new Map<string, Array<{ storeId: string; storeName: string }>>();
    for (const dateStr of dates) {
      for (const shiftType of SHIFT_TYPES) {
        for (const store of stores) {
          const key = assignmentKey(store.id, dateStr, shiftType.key);
          const a = assignments[key];
          if (!a?.profileId) continue;
          const conflictKey = `${dateStr}:${shiftType.key}:${a.profileId}`;
          const list = seen.get(conflictKey) ?? [];
          list.push({ storeId: store.id, storeName: store.name });
          seen.set(conflictKey, list);
        }
      }
    }

    const messages: string[] = [];
    const keys = new Set<string>();

    Array.from(seen.entries())
      .filter(([, list]) => list.length > 1)
      .forEach(([bucket, list]) => {
        const [dateStr, shiftType, profileId] = bucket.split(":");
        const name = memberships.find(m => m.profile?.id === profileId)?.profile?.name ?? profileId.slice(0, 8);
        messages.push(`${name} is double-booked on ${dateStr} (${shiftType}) across ${list.map(x => x.storeName).join(" & ")}`);
        list.forEach(item => {
          keys.add(assignmentKey(item.storeId, dateStr, shiftType as "open" | "close"));
        });
      });

    return { messages, keys };
  }, [assignments, dates, stores, memberships]);

  const unassignedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const store of stores) {
      for (const dateStr of dates) {
        for (const shiftType of SHIFT_TYPES) {
          const key = assignmentKey(store.id, dateStr, shiftType.key);
          if (!assignments[key]?.profileId) keys.add(key);
        }
      }
    }
    return keys;
  }, [assignments, stores, dates]);

  const persistAssignments = useCallback(
    async (forceAll = false, list?: ScheduleRow[]) => {
      if (conflictDetails.messages.length) {
        setError("Resolve double-booking conflicts before saving.");
        return false;
      }
      const token = await getBearerToken();
      if (!token) return false;
      for (const store of stores) {
        const assignmentsPayload: Array<Assignment & { date: string; shiftType: "open" | "close" }> = [];
        const schedule = getScheduleForStore(store.id, list ?? schedules);
        if (!schedule) continue;
        for (const dateStr of dates) {
          for (const shiftType of SHIFT_TYPES) {
            const key = assignmentKey(store.id, dateStr, shiftType.key);
            if (!forceAll && !dirtyKeys.has(key)) continue;
            const current = assignments[key];
            assignmentsPayload.push({
              date: dateStr,
              shiftType: shiftType.key,
              profileId: current?.profileId ?? null,
              shiftMode: current?.shiftMode ?? "standard",
              scheduledStart: current?.scheduledStart ?? undefined,
              scheduledEnd: current?.scheduledEnd ?? undefined,
            });
          }
        }
        if (!assignmentsPayload.length) continue;
        const res = await fetch(`/api/admin/schedules/${schedule.id}/assign-batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ assignments: assignmentsPayload }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error || "Failed to save schedule.");
        }
      }
      setDirtyKeys(new Set());
      await loadDetails();
      return true;
    },
    [dates, dirtyKeys, stores, assignments, loadDetails, conflictDetails.messages, getScheduleForStore, schedules]
  );

  const saveDraft = useCallback(async () => {
    setSaving(true);
    setInfo(null);
    try {
      await persistAssignments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }, [persistAssignments]);

  const ensureSchedules = useCallback(
    async (opts?: { auto?: boolean }) => {
      setError(null);
      const token = await getBearerToken();
      if (!token) return false;
      const res = await fetch("/api/admin/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json?.error || "Failed to create schedules.");
        return false;
      }
      await loadMeta();
      if (opts?.auto) {
        setInfo("Created schedules for this pay period, remember to save.");
      }
      return true;
    },
    [periodStart, periodEnd, loadMeta]
  );

  const publishSchedules = useCallback(async () => {
    setSaving(true);
    setInfo(null);
    try {
      const token = await getBearerToken();
      if (!token) return;
      let meta = await loadMeta();
      let metaSchedules = meta?.schedules ?? schedules;
      const missing = stores.some(store => !getScheduleForStore(store.id, metaSchedules));
      if (missing) {
        await ensureSchedules();
        meta = await loadMeta();
        metaSchedules = meta?.schedules ?? schedules;
      }
      if (stores.some(store => !getScheduleForStore(store.id, metaSchedules))) {
        setError("Schedules not initialized. Click Create/Load first.");
        return;
      }

      const saved = await persistAssignments(true, metaSchedules);
      if (!saved) return;
      for (const store of stores) {
        const schedule = getScheduleForStore(store.id, metaSchedules);
        if (!schedule) continue;
        const res = await fetch(`/api/admin/schedules/${schedule.id}/publish`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error || "Failed to publish schedule.");
        }
      }
      await loadMeta();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to publish schedules.");
    } finally {
      setSaving(false);
    }
  }, [stores, loadMeta, persistAssignments, getScheduleForStore, schedules, ensureSchedules]);

  useEffect(() => {
    if (!isAuthed) return;
    if (!stores.length) return;
    const periodKey = `${periodStart}:${periodEnd}`;
    const hasSchedulesForPeriod = stores.every(store =>
      schedules.some(s => s.store_id === store.id && s.period_start === periodStart && s.period_end === periodEnd)
    );
    if (!hasSchedulesForPeriod && !autoEnsureOnceRef.current.has(periodKey)) {
      autoEnsureOnceRef.current.add(periodKey);
      void ensureSchedules({ auto: true });
    }
  }, [isAuthed, stores, schedules, periodStart, periodEnd, ensureSchedules]);

  return {
    loading,
    isAuthed,
    error,
    setError,
    info,
    setInfo,
    month,
    setMonth,
    half,
    setHalf,
    stores,
    templates,
    memberships,
    schedules,
    scheduleMap,
    assignments,
    saving,
    periodStart,
    periodEnd,
    dates,
    employeesByStore,
    templateLookup,
    totals,
    weeklyWarnings,
    conflicts: conflictDetails.messages,
    conflictKeys: conflictDetails.keys,
    unassignedKeys,
    handleEmployeeChange,
    handleModeChange,
    handleOtherTimeChange,
    ensureSchedules,
    saveDraft,
    publishSchedules,
  };
}
