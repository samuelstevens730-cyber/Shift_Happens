"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };
type CleaningTask = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sort_order: number;
  is_active: boolean;
};
type CleaningSchedule = {
  id: string;
  store_id: string;
  cleaning_task_id: string;
  day_of_week: number;
  shift_type: "am" | "pm";
  is_required: boolean;
};

type CleaningConfigResponse =
  | {
      stores: Store[];
      storeId: string | null;
      tasks: CleaningTask[];
      schedules: CleaningSchedule[];
    }
  | { error: string };

const DAYS = [
  { dow: 0, label: "Sun" },
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
] as const;

type ShiftType = "am" | "pm";

function matrixKey(taskId: string, dayOfWeek: number, shiftType: ShiftType) {
  return `${taskId}|${dayOfWeek}|${shiftType}`;
}

export default function AdminCleaningPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [requiredSet, setRequiredSet] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const loadConfig = async (nextStoreId?: string) => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/cleaning");
      return;
    }

    const qs = nextStoreId ? `?storeId=${encodeURIComponent(nextStoreId)}` : "";
    const res = await fetch(`/api/admin/cleaning${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as CleaningConfigResponse;
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load cleaning configuration.");
      return;
    }

    setStores(json.stores ?? []);
    setStoreId(json.storeId ?? "");
    setTasks((json.tasks ?? []).sort((a, b) => a.sort_order - b.sort_order));

    const keys = new Set<string>();
    (json.schedules ?? []).forEach(row => {
      if (!row.is_required) return;
      keys.add(matrixKey(row.cleaning_task_id, row.day_of_week, row.shift_type));
    });
    setRequiredSet(keys);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/cleaning");
          return;
        }
        setIsAuthed(true);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to check auth.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  useEffect(() => {
    if (!isAuthed) return;
    void loadConfig();
  }, [isAuthed]);

  const totalRequired = useMemo(() => requiredSet.size, [requiredSet]);

  const toggleCell = (taskId: string, dayOfWeek: number, shiftType: ShiftType) => {
    const key = matrixKey(taskId, dayOfWeek, shiftType);
    setRequiredSet(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    if (!storeId) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/cleaning");
        return;
      }

      const entries = Array.from(requiredSet).map(key => {
        const [cleaningTaskId, dayStr, shiftType] = key.split("|");
        return {
          cleaningTaskId,
          dayOfWeek: Number(dayStr),
          shiftType: shiftType as ShiftType,
          isRequired: true,
        };
      });

      const res = await fetch("/api/admin/cleaning", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ storeId, entries }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Failed to save cleaning configuration.");
        return;
      }
      await loadConfig(storeId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save cleaning configuration.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Cleaning Tasks</h1>
          <div className="text-sm muted">Store/day/shift matrix</div>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="card card-pad space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <label className="text-sm muted">Store</label>
              <select
                className="input"
                value={storeId}
                onChange={e => {
                  const next = e.target.value;
                  setStoreId(next);
                  void loadConfig(next);
                }}
              >
                {stores.map(store => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-sm muted">Required slots: {totalRequired}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="text-left border border-[var(--cardBorder)] p-2 sticky left-0 bg-[var(--card)] z-10">
                    Task
                  </th>
                  {DAYS.map(day => (
                    <th key={day.dow} className="border border-[var(--cardBorder)] p-2 text-center" colSpan={2}>
                      {day.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="border border-[var(--cardBorder)] p-2 sticky left-0 bg-[var(--card)] z-10" />
                  {DAYS.map(day => (
                    <FragmentShiftHeader key={`${day.dow}-am`} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id}>
                    <td className="border border-[var(--cardBorder)] p-2 sticky left-0 bg-[var(--card)] z-10">
                      <div className="font-medium">{task.name}</div>
                      {task.category && <div className="text-xs muted">{task.category}</div>}
                    </td>
                    {DAYS.map(day => (
                      <FragmentCell
                        key={`${task.id}-${day.dow}`}
                        checkedAm={requiredSet.has(matrixKey(task.id, day.dow, "am"))}
                        checkedPm={requiredSet.has(matrixKey(task.id, day.dow, "pm"))}
                        onToggleAm={() => toggleCell(task.id, day.dow, "am")}
                        onTogglePm={() => toggleCell(task.id, day.dow, "pm")}
                      />
                    ))}
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td className="border border-[var(--cardBorder)] p-3 text-sm muted" colSpan={15}>
                      No active cleaning tasks found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary px-4 py-2 disabled:opacity-50" disabled={saving || !storeId} onClick={save}>
              {saving ? "Saving..." : "Save Cleaning Matrix"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FragmentShiftHeader() {
  return (
    <>
      <th className="border border-[var(--cardBorder)] p-2 text-center text-xs">AM</th>
      <th className="border border-[var(--cardBorder)] p-2 text-center text-xs">PM</th>
    </>
  );
}

function FragmentCell({
  checkedAm,
  checkedPm,
  onToggleAm,
  onTogglePm,
}: {
  checkedAm: boolean;
  checkedPm: boolean;
  onToggleAm: () => void;
  onTogglePm: () => void;
}) {
  return (
    <>
      <td className="border border-[var(--cardBorder)] p-2 text-center">
        <input type="checkbox" checked={checkedAm} onChange={onToggleAm} />
      </td>
      <td className="border border-[var(--cardBorder)] p-2 text-center">
        <input type="checkbox" checked={checkedPm} onChange={onTogglePm} />
      </td>
    </>
  );
}
