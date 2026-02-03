/**
 * Schedule Builder - Manager UI
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };
type TemplateRow = {
  id: string;
  store_id: string;
  day_of_week: number;
  shift_type: "open" | "close";
  start_time: string;
  end_time: string;
  is_overnight: boolean | null;
};
type MembershipRow = {
  store_id: string;
  profile: { id: string; name: string | null; active: boolean | null } | null;
};
type ScheduleRow = {
  id: string;
  store_id: string;
  period_start: string;
  period_end: string;
  status: string;
};
type ShiftRow = {
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

type Assignment = {
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

const SHIFT_TYPES: Array<{ key: "open" | "close"; label: string }> = [
  { key: "open", label: "AM" },
  { key: "close", label: "PM" },
];

function getBearerToken() {
  return supabase.auth.getSession().then(({ data }) => data.session?.access_token || "");
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

function calcHours(start: string, end: string) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  if (e < s) e += 24 * 60;
  return (e - s) / 60;
}

function getWeekKey(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

function hashColor(id: string) {
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

export default function AdminSchedulerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
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
    return () => { alive = false; };
  }, [router]);

  const loadMeta = useCallback(async () => {
    setError(null);
    const token = await getBearerToken();
    if (!token) {
      router.replace("/login?next=/admin/scheduler");
      return;
    }
    const res = await fetch("/api/admin/schedules", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as SchedulesResponse | { error: string };
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load schedules.");
      return;
    }
    setStores(json.stores);
    setTemplates(json.templates);
    setMemberships(json.memberships);
    setSchedules(json.schedules);
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

  const loadDetails = useCallback(async () => {
    const token = await getBearerToken();
    if (!token) return;
    const nextAssignments: Record<string, Assignment> = {};
    for (const store of stores) {
      const schedule = scheduleMap[store.id];
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
        const key = `${s.store_id}|${s.shift_date}|${s.shift_type}`;
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
  }, [stores, scheduleMap]);

  useEffect(() => {
    if (!isAuthed) return;
    void loadDetails();
  }, [isAuthed, scheduleMap, loadDetails]);

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

  const templateLookup = useCallback((storeId: string, dateStr: string, shiftType: "open" | "close") => {
    const d = new Date(`${dateStr}T00:00:00`);
    const dow = d.getDay();
    return (templatesByStore[storeId] ?? []).find(t => t.day_of_week === dow && t.shift_type === shiftType);
  }, [templatesByStore]);

  function setAssignment(storeId: string, dateStr: string, shiftType: "open" | "close", next: Assignment) {
    const key = `${storeId}|${dateStr}|${shiftType}`;
    setAssignments(prev => ({ ...prev, [key]: next }));
    setDirtyKeys(prev => new Set(prev).add(key));
  }

  function handleEmployeeChange(storeId: string, dateStr: string, shiftType: "open" | "close", profileId: string) {
    const current = assignments[`${storeId}|${dateStr}|${shiftType}`];
    const shiftMode = current?.shiftMode ?? "standard";
    setAssignment(storeId, dateStr, shiftType, { ...current, profileId, shiftMode });
  }

  function handleModeChange(storeId: string, dateStr: string, shiftType: "open" | "close", shiftMode: Assignment["shiftMode"]) {
    const key = `${storeId}|${dateStr}|${shiftType}`;
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
  }

  function handleOtherTimeChange(storeId: string, dateStr: string, shiftType: "open" | "close", field: "start" | "end", value: string) {
    const key = `${storeId}|${dateStr}|${shiftType}`;
    const current = assignments[key];
    if (!current) return;
    const next = { ...current };
    if (field === "start") next.scheduledStart = value;
    if (field === "end") next.scheduledEnd = value;
    setAssignment(storeId, dateStr, shiftType, next);
  }

  const totals = useMemo(() => {
    const byEmployee: Record<string, number> = {};
    const byStore: Record<string, number> = {};
    let grandTotal = 0;

    for (const store of stores) {
      for (const dateStr of dates) {
        for (const shiftType of SHIFT_TYPES) {
          const key = `${store.id}|${dateStr}|${shiftType.key}`;
          const a = assignments[key];
          if (!a?.profileId) continue;
          const tpl = templateLookup(store.id, dateStr, shiftType.key);
          const start = a.shiftMode === "other" ? a.scheduledStart : tpl?.start_time;
          const end = a.shiftMode === "other" ? a.scheduledEnd : tpl?.end_time;
          if (!start || !end) continue;
          const hours = calcHours(start, end);
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
          const key = `${store.id}|${dateStr}|${shiftType.key}`;
          const a = assignments[key];
          if (!a?.profileId) continue;
          const tpl = templateLookup(store.id, dateStr, shiftType.key);
          const start = a.shiftMode === "other" ? a.scheduledStart : tpl?.start_time;
          const end = a.shiftMode === "other" ? a.scheduledEnd : tpl?.end_time;
          if (!start || !end) continue;
          const hours = calcHours(start, end);
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

  const conflicts = useMemo(() => {
    const seen = new Map<string, string[]>();
    for (const dateStr of dates) {
      for (const shiftType of SHIFT_TYPES) {
        for (const store of stores) {
          const key = `${store.id}|${dateStr}|${shiftType.key}`;
          const a = assignments[key];
          if (!a?.profileId) continue;
          const conflictKey = `${dateStr}:${shiftType.key}:${a.profileId}`;
          const list = seen.get(conflictKey) ?? [];
          list.push(store.name);
          seen.set(conflictKey, list);
        }
      }
    }
    return Array.from(seen.entries())
      .filter(([, storeNames]) => storeNames.length > 1)
      .map(([key, storeNames]) => {
        const [dateStr, shiftType, profileId] = key.split(":");
        const name = memberships.find(m => m.profile?.id === profileId)?.profile?.name ?? profileId.slice(0, 8);
        return `${name} is double-booked on ${dateStr} (${shiftType}) across ${storeNames.join(" & ")}`;
      });
  }, [assignments, dates, stores, memberships]);

  const saveDraft = useCallback(async () => {
    setSaving(true);
    if (conflicts.length) {
      setError("Resolve double-booking conflicts before saving.");
      setSaving(false);
      return;
    }
    try {
      const token = await getBearerToken();
      if (!token) return;
      for (const store of stores) {
        const assignmentsPayload: Array<Assignment & { date: string; shiftType: "open" | "close" }> = [];
        const schedule = scheduleMap[store.id];
        if (!schedule) continue;
        for (const dateStr of dates) {
          for (const shiftType of SHIFT_TYPES) {
            const key = `${store.id}|${dateStr}|${shiftType.key}`;
            if (!dirtyKeys.has(key)) continue;
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }, [dates, dirtyKeys, scheduleMap, stores, assignments, loadDetails, conflicts]);

  const publishSchedules = useCallback(async () => {
    setSaving(true);
    try {
      const token = await getBearerToken();
      if (!token) return;
      for (const store of stores) {
        const schedule = scheduleMap[store.id];
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
  }, [stores, scheduleMap, loadMeta]);

  async function ensureSchedules() {
    setError(null);
    const token = await getBearerToken();
    if (!token) return;
    const res = await fetch("/api/admin/schedules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ periodStart, periodEnd }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error || "Failed to create schedules.");
      return;
    }
    await loadMeta();
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Scheduler</h1>
          <div className="text-xs muted">Admin</div>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}
        {conflicts.length > 0 && (
          <div className="banner banner-error text-sm">
            <div className="font-semibold">Double-booking detected</div>
            <ul className="list-disc pl-5">
              {conflicts.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {weeklyWarnings.length > 0 && (
          <div className="banner text-sm">
            <div className="font-semibold">40+ hour warnings</div>
            <ul className="list-disc pl-5">
              {weeklyWarnings.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="card card-pad grid gap-4 sm:grid-cols-4 items-end">
          <div>
            <label className="text-sm muted">Month</label>
            <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          <div>
            <label className="text-sm muted">Pay period</label>
            <select className="select" value={half} onChange={e => setHalf(e.target.value as "first" | "second")}>
              <option value="first">1st-15th</option>
              <option value="second">16th-EOM</option>
            </select>
          </div>
          <div className="text-sm muted">
            {periodStart} to {periodEnd}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary px-4 py-2" onClick={ensureSchedules}>
              Create/Load
            </button>
            <button className="btn-primary px-4 py-2 disabled:opacity-50" onClick={saveDraft} disabled={saving}>
              {saving ? "Saving..." : "Save Draft"}
            </button>
            <button className="btn-primary px-4 py-2 disabled:opacity-50" onClick={publishSchedules} disabled={saving}>
              Publish
            </button>
          </div>
        </div>

        <div className="card card-pad overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/40">
              <tr>
                <th className="text-left px-2 py-2">Date</th>
                {stores.map(store => (
                  SHIFT_TYPES.map(shift => (
                    <th key={`${store.id}-${shift.key}`} className="text-left px-2 py-2">
                      {store.name} {shift.label}
                    </th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map(dateStr => (
                <tr key={dateStr} className="border-t border-white/10">
                  <td className="px-2 py-2 whitespace-nowrap">{dateStr}</td>
                  {stores.map(store => (
                    SHIFT_TYPES.map(shift => {
                      const key = `${store.id}|${dateStr}|${shift.key}`;
                      const current = assignments[key];
                      const employees = employeesByStore[store.id] ?? [];
                      const tpl = templateLookup(store.id, dateStr, shift.key);
                      const cellStart = current?.shiftMode === "other" ? current?.scheduledStart : tpl?.start_time;
                      const cellEnd = current?.shiftMode === "other" ? current?.scheduledEnd : tpl?.end_time;
                      return (
                        <td key={key} className="px-2 py-2 align-top min-w-[220px]">
                          <div className="space-y-1">
                            <select
                              className="select text-sm"
                              value={current?.profileId ?? ""}
                              onChange={e => handleEmployeeChange(store.id, dateStr, shift.key, e.target.value)}
                            >
                              <option value="">Unassigned</option>
                              {employees.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                            <select
                              className="select text-sm"
                              value={current?.shiftMode ?? "standard"}
                              onChange={e => handleModeChange(store.id, dateStr, shift.key, e.target.value as Assignment["shiftMode"])}
                            >
                              <option value="standard">Standard</option>
                              <option value="double">Double</option>
                              <option value="other">Other</option>
                            </select>
                            {current?.shiftMode === "other" && (
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="time"
                                  className="input text-sm"
                                  value={current?.scheduledStart ?? ""}
                                  onChange={e => handleOtherTimeChange(store.id, dateStr, shift.key, "start", e.target.value)}
                                />
                                <input
                                  type="time"
                                  className="input text-sm"
                                  value={current?.scheduledEnd ?? ""}
                                  onChange={e => handleOtherTimeChange(store.id, dateStr, shift.key, "end", e.target.value)}
                                />
                              </div>
                            )}
                            <div className="text-xs muted">
                              {cellStart && cellEnd ? `${cellStart} - ${cellEnd}` : "Template missing"}
                            </div>
                            {current?.profileId && (
                              <div className={`text-xs px-2 py-1 rounded border ${hashColor(current.profileId)}`}>
                                {employees.find(p => p.id === current.profileId)?.name ?? "Employee"}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card card-pad grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-sm font-medium">Total hours by store</div>
            <div className="text-sm muted space-y-1">
              {stores.map(s => (
                <div key={s.id} className="flex items-center justify-between">
                  <span>{s.name}</span>
                  <span>{(totals.byStore[s.id] ?? 0).toFixed(2)} hrs</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">Total hours by employee</div>
            <div className="text-sm muted space-y-1 max-h-48 overflow-auto">
              {Object.entries(totals.byEmployee).map(([profileId, hours]) => {
                const name = memberships.find(m => m.profile?.id === profileId)?.profile?.name ?? profileId.slice(0, 8);
                return (
                  <div key={profileId} className="flex items-center justify-between">
                    <span>{name}</span>
                    <span>{hours.toFixed(2)} hrs</span>
                  </div>
                );
              })}
              {!Object.keys(totals.byEmployee).length && <div>No assignments yet.</div>}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">Grand total</div>
            <div className="text-2xl font-semibold">{totals.grandTotal.toFixed(2)} hrs</div>
            <div className="text-xs muted">Overnight shifts handled (end &lt; start).</div>
          </div>
        </div>
      </div>
    </div>
  );
}
