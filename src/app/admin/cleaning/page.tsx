"use client";

import Link from "next/link";
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
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("");
  const [newTaskSortOrder, setNewTaskSortOrder] = useState("0");

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
  const activeTasks = useMemo(() => tasks.filter((task) => task.is_active), [tasks]);

  const saveTask = async (payload: {
    taskId?: string;
    name: string;
    description?: string | null;
    category?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }, method: "POST" | "PATCH") => {
    setTaskSaving(true);
    setTaskMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/cleaning");
        return false;
      }

      const res = await fetch("/api/admin/cleaning/tasks", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setTaskMessage(json.error ?? "Failed to save cleaning task.");
        return false;
      }

      await loadConfig(storeId || undefined);
      setTaskMessage(method === "POST" ? "Cleaning task added." : "Cleaning task updated.");
      return true;
    } catch (e: unknown) {
      setTaskMessage(e instanceof Error ? e.message : "Failed to save cleaning task.");
      return false;
    } finally {
      setTaskSaving(false);
    }
  };

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
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold uppercase tracking-tight text-[var(--text)]">Cleaning Tasks</h1>
            <div className="text-sm muted">Store/day/shift matrix</div>
          </div>
          <Link href="/admin/cleaning/report" className="btn-secondary px-4 py-2 text-sm">
            Open Cleaning Audit
          </Link>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}
        {taskMessage && <div className="banner text-sm">{taskMessage}</div>}

        <div className="card card-pad space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-medium">Manage Cleaning Tasks</div>
            <div className="text-sm muted">Create, edit, or deactivate tasks</div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_120px_auto]">
            <input
              className="input"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              placeholder="Task name"
            />
            <input
              className="input"
              value={newTaskDescription}
              onChange={(e) => setNewTaskDescription(e.target.value)}
              placeholder="Description"
            />
            <input
              className="input"
              value={newTaskCategory}
              onChange={(e) => setNewTaskCategory(e.target.value)}
              placeholder="Category"
            />
            <input
              className="input"
              type="number"
              value={newTaskSortOrder}
              onChange={(e) => setNewTaskSortOrder(e.target.value)}
              placeholder="Sort"
            />
            <button
              className="btn-primary px-4 py-2 disabled:opacity-50"
              disabled={taskSaving || !newTaskName.trim()}
              onClick={async () => {
                const ok = await saveTask(
                  {
                    name: newTaskName,
                    description: newTaskDescription,
                    category: newTaskCategory,
                    sortOrder: Number(newTaskSortOrder) || 0,
                    isActive: true,
                  },
                  "POST"
                );
                if (!ok) return;
                setNewTaskName("");
                setNewTaskDescription("");
                setNewTaskCategory("");
                setNewTaskSortOrder("0");
              }}
            >
              {taskSaving ? "Saving..." : "Add Task"}
            </button>
          </div>

          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskEditorRow
                key={task.id}
                task={task}
                disabled={taskSaving}
                onSave={(draft) => saveTask(draft, "PATCH")}
              />
            ))}
            {!tasks.length && <div className="text-sm muted">No cleaning tasks created yet.</div>}
          </div>
        </div>

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
                {activeTasks.map(task => (
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
                {activeTasks.length === 0 && (
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

function TaskEditorRow({
  task,
  disabled,
  onSave,
}: {
  task: CleaningTask;
  disabled: boolean;
  onSave: (draft: {
    taskId: string;
    name: string;
    description?: string | null;
    category?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description ?? "");
  const [category, setCategory] = useState(task.category ?? "");
  const [sortOrder, setSortOrder] = useState(String(task.sort_order));
  const [isActive, setIsActive] = useState(task.is_active);

  useEffect(() => {
    setName(task.name);
    setDescription(task.description ?? "");
    setCategory(task.category ?? "");
    setSortOrder(String(task.sort_order));
    setIsActive(task.is_active);
  }, [task]);

  return (
    <div className="grid gap-3 rounded border border-[var(--cardBorder)] p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_120px_auto_auto]">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" />
      <input
        className="input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
      />
      <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
      <input
        className="input"
        type="number"
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
        placeholder="Sort"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {isActive ? "Active" : "Inactive"}
      </label>
      <button
        className="btn-secondary px-4 py-2 disabled:opacity-50"
        disabled={disabled || !name.trim()}
        onClick={() =>
          void onSave({
            taskId: task.id,
            name,
            description,
            category,
            sortOrder: Number(sortOrder) || 0,
            isActive,
          })
        }
      >
        {disabled ? "Saving..." : "Save Task"}
      </button>
    </div>
  );
}
