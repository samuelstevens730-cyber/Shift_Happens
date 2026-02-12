/**
 * Admin Settings Page - Store configuration and checklist management
 *
 * This administrative page provides configuration options for individual stores,
 * including expected drawer amounts and shift checklists. Managers can customize
 * the opening and closing procedures for each store location.
 *
 * Features:
 * - Select and configure individual store locations
 * - Set expected drawer amount (used for variance calculations)
 * - Manage opening shift checklists with customizable tasks
 * - Manage closing shift checklists with customizable tasks
 * - Add, remove, and reorder checklist items
 * - Mark checklist items as required or optional
 *
 * Business Logic:
 * - Expected drawer amount is stored in cents and displayed/edited in dollars
 * - Checklists are per-store and per-shift-type (open vs close)
 * - Checklist items have a sort order that determines display sequence
 * - Required items must be completed before an employee can finish their shift
 * - Changes to checklists affect future shifts; existing shifts retain their original checklist
 * - Client-side IDs are generated for new items until they are saved to the server
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Store = {
  id: string;
  name: string;
  expected_drawer_cents: number;
  payroll_variance_warn_hours: number;
  payroll_shift_drift_warn_hours: number;
};
type ChecklistItem = {
  id?: string;
  client_id: string;
  label: string;
  sort_order: number;
  required: boolean;
};
type ChecklistTemplate = {
  id: string;
  name: string;
  shift_type: "open" | "close";
  items: ChecklistItem[];
};

type SettingsResponse =
  | { stores: Store[]; storeId: string | null; templates: ChecklistTemplate[] }
  | { error: string };

type SimpleResponse = { ok: true } | { error: string };

function newClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string>("");
  const [expectedDrawer, setExpectedDrawer] = useState<string>("");
  const [payrollVarianceWarnHours, setPayrollVarianceWarnHours] = useState<string>("2");
  const [payrollShiftDriftWarnHours, setPayrollShiftDriftWarnHours] = useState<string>("2");
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [activeShift, setActiveShift] = useState<"open" | "close">("open");
  const [savingStore, setSavingStore] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/settings");
          return;
        }
        setIsAuthed(true);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [router]);

  const loadSettings = async (nextStoreId?: string) => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/settings");
      return;
    }

    const qs = nextStoreId ? `?storeId=${encodeURIComponent(nextStoreId)}` : "";
    const res = await fetch(`/api/admin/settings${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as SettingsResponse;
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load settings.");
      return;
    }

    const nextStores = json.stores ?? [];
    setStores(nextStores);
    const selectedStoreId = json.storeId ?? "";
    setStoreId(selectedStoreId);

    const expected = nextStores.find(s => s.id === selectedStoreId)?.expected_drawer_cents ?? 0;
    const selectedStore = nextStores.find(s => s.id === selectedStoreId);
    setExpectedDrawer((expected / 100).toFixed(2));
    setPayrollVarianceWarnHours(String(selectedStore?.payroll_variance_warn_hours ?? 2));
    setPayrollShiftDriftWarnHours(String(selectedStore?.payroll_shift_drift_warn_hours ?? 2));

    const withClientIds = (json.templates ?? []).map(t => ({
      ...t,
      items: t.items.map(it => ({
        ...it,
        client_id: it.id ?? newClientId(),
      })),
    }));
    setTemplates(withClientIds);
  };

  useEffect(() => {
    if (!isAuthed) return;
    void loadSettings();
  }, [isAuthed]);

  const activeTemplate = useMemo(
    () => templates.find(t => t.shift_type === activeShift) ?? null,
    [templates, activeShift]
  );

  const storeOptions = useMemo(() => {
    return stores.map(s => ({ id: s.id, name: s.name }));
  }, [stores]);

  const canSaveStore = !savingStore && storeId.length > 0;
  const canSaveChecklist = !savingChecklist && Boolean(activeTemplate);

  const updateActiveTemplateItems = (updater: (items: ChecklistItem[]) => ChecklistItem[]) => {
    setTemplates(prev =>
      prev.map(t => {
        if (!activeTemplate || t.id !== activeTemplate.id) return t;
        return { ...t, items: updater(t.items) };
      })
    );
  };

  const addItem = () => {
    updateActiveTemplateItems(items => {
      const nextSort = items.length ? Math.max(...items.map(i => i.sort_order)) + 1 : 1;
      return [
        ...items,
        { client_id: newClientId(), label: "", sort_order: nextSort, required: true },
      ];
    });
  };

  const removeItem = (clientId: string) => {
    updateActiveTemplateItems(items => items.filter(i => i.client_id !== clientId));
  };

  const updateItem = (clientId: string, patch: Partial<ChecklistItem>) => {
    updateActiveTemplateItems(items =>
      items.map(i => (i.client_id === clientId ? { ...i, ...patch } : i))
    );
  };

  async function saveStoreSettings() {
    if (!canSaveStore) return;
    setSavingStore(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/settings");
        return;
      }

      const dollars = Number(expectedDrawer);
      if (!Number.isFinite(dollars)) {
        setError("Expected drawer must be a valid number.");
        return;
      }
      const varianceWarn = Number(payrollVarianceWarnHours);
      if (!Number.isFinite(varianceWarn) || varianceWarn < 0) {
        setError("Payroll variance threshold must be 0 or higher.");
        return;
      }
      const driftWarn = Number(payrollShiftDriftWarnHours);
      if (!Number.isFinite(driftWarn) || driftWarn < 0) {
        setError("Shift drift threshold must be 0 or higher.");
        return;
      }

      const res = await fetch("/api/admin/settings/store", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          storeId,
          expectedDrawerCents: Math.max(0, Math.round(dollars * 100)),
          payrollVarianceWarnHours: varianceWarn,
          payrollShiftDriftWarnHours: driftWarn,
        }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to update store.");
        return;
      }
      await loadSettings(storeId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update store.");
    } finally {
      setSavingStore(false);
    }
  }

  async function saveChecklist() {
    if (!activeTemplate || !canSaveChecklist) return;
    setSavingChecklist(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/settings");
        return;
      }

      const itemsPayload = activeTemplate.items.map(it => ({
        id: it.id,
        label: it.label,
        sort_order: it.sort_order,
        required: it.required,
      }));

      const res = await fetch("/api/admin/settings/checklists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ templateId: activeTemplate.id, items: itemsPayload }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to update checklist.");
        return;
      }

      await loadSettings(storeId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update checklist.");
    } finally {
      setSavingChecklist(false);
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <span className="text-sm muted">Store configuration</span>
        </div>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="card card-pad space-y-4">
          <div className="text-lg font-medium">Store</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm muted">Location</label>
              <select
                className="input"
                value={storeId}
                onChange={e => {
                  const next = e.target.value;
                  setStoreId(next);
                  void loadSettings(next);
                }}
              >
                {storeOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Expected drawer ($)</label>
              <input
                className="input"
                inputMode="decimal"
                value={expectedDrawer}
                onChange={e => setExpectedDrawer(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Payroll variance warn threshold (hours)</label>
              <input
                className="input"
                inputMode="decimal"
                value={payrollVarianceWarnHours}
                onChange={e => setPayrollVarianceWarnHours(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Shift drift warn threshold (hours)</label>
              <input
                className="input"
                inputMode="decimal"
                value={payrollShiftDriftWarnHours}
                onChange={e => setPayrollShiftDriftWarnHours(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn-primary px-4 py-2 disabled:opacity-50"
            onClick={saveStoreSettings}
            disabled={!canSaveStore}
          >
            {savingStore ? "Saving..." : "Save Store Settings"}
          </button>
        </div>

        <div className="card card-pad space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-medium">Checklists</div>
            <div className="segmented">
              <button
                className={activeShift === "open" ? "segment segment-active" : "segment"}
                onClick={() => setActiveShift("open")}
              >
                Open
              </button>
              <button
                className={activeShift === "close" ? "segment segment-active" : "segment"}
                onClick={() => setActiveShift("close")}
              >
                Close
              </button>
            </div>
          </div>

          {!activeTemplate && (
            <div className="banner banner-warn text-sm">No checklist found for this store.</div>
          )}

          {activeTemplate && (
            <div className="space-y-3">
              {activeTemplate.items.map(item => (
                <div key={item.client_id} className="grid gap-2 rounded border border-[var(--cardBorder)] p-3 sm:grid-cols-[1fr_120px_100px_auto]">
                  <div className="space-y-1">
                    <label className="text-xs muted">Task</label>
                    <input
                      className="input"
                      value={item.label}
                      onChange={e => updateItem(item.client_id, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs muted">Order</label>
                    <input
                      className="input"
                      type="number"
                      value={item.sort_order}
                      onChange={e => updateItem(item.client_id, { sort_order: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs muted">Required</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={item.required}
                        onChange={e => updateItem(item.client_id, { required: e.target.checked })}
                      />
                      <span className="text-sm">{item.required ? "Yes" : "No"}</span>
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      className="btn-secondary px-3 py-2"
                      onClick={() => removeItem(item.client_id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary px-3 py-2" onClick={addItem}>
                  Add Task
                </button>
                <button
                  className="btn-primary px-4 py-2 disabled:opacity-50"
                  onClick={saveChecklist}
                  disabled={!canSaveChecklist}
                >
                  {savingChecklist ? "Saving..." : "Save Checklist"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
