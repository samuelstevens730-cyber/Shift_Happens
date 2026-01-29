// src/app/shift/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { thresholdMessage } from "@/lib/kioskRules";

type ShiftType = "open" | "close" | "double" | "other";

type ChecklistGroup = {
  label: string;
  required: boolean;
  sort_order: number;
  itemIds: string[];
};

type ShiftState = {
  store: { id: string; name: string; expected_drawer_cents: number };
  shift: {
    id: string;
    shift_type: ShiftType;
    started_at: string;
    ended_at: string | null;
  };
  employee: string | null;
  counts: {
    count_type: "start" | "changeover" | "end";
    drawer_cents: number;
    confirmed: boolean;
    notified_manager: boolean;
    note: string | null;
    counted_at: string;
  }[];

  // Raw items (legacy; keep for fallback rendering)
  checklistItems?: { id: string; label: string; sort_order: number; required: boolean }[];
  checkedItemIds?: string[];

  // Option A: deduped groups (preferred)
  checklistGroups?: ChecklistGroup[];
  checkedGroupLabels?: string[];
};

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ShiftPage() {
  const { id } = useParams<{ id: string }>();
  const shiftId = id;

  const router = useRouter();
  const search = useSearchParams();
  const qrToken = search.get("t") || "";

  const [state, setState] = useState<ShiftState | null>(null);

  // Option A done state: group label set
  const [doneLabels, setDoneLabels] = useState<Set<string>>(new Set());

  // Fallback done state (if API doesn’t provide groups yet)
  const [doneItemIds, setDoneItemIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showClockOut, setShowClockOut] = useState(false);

  async function refreshShift() {
    if (!qrToken) return;
    const res = await fetch(`/api/shift/${shiftId}?t=${encodeURIComponent(qrToken)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load shift.");
    setState(json);

    // Prefer group labels if present
    if (Array.isArray(json.checkedGroupLabels)) {
      setDoneLabels(new Set(json.checkedGroupLabels as string[]));
    } else {
      setDoneLabels(new Set());
    }

    // Legacy fallback
    if (Array.isArray(json.checkedItemIds)) {
      setDoneItemIds(new Set(json.checkedItemIds as string[]));
    } else {
      setDoneItemIds(new Set());
    }

    if (json.shift?.ended_at) {
      router.replace(`/shift/${shiftId}/done?t=${encodeURIComponent(qrToken)}`);
    }
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setErr(null);
        setLoading(true);
        if (!qrToken) throw new Error("Missing QR token in URL (?t=...).");
        if (!alive) return;
        await refreshShift();
      } catch (e: unknown) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : "Failed to load shift.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId, qrToken]);

  const shiftType = state?.shift.shift_type;

  const hasChangeover = useMemo(() => {
    return (state?.counts || []).some(c => c.count_type === "changeover");
  }, [state]);

  // Prefer groups; fallback to raw items converted to groups 1:1
  const displayGroups: ChecklistGroup[] = useMemo(() => {
    if (!state) return [];

    if (Array.isArray(state.checklistGroups) && state.checklistGroups.length) {
      return [...state.checklistGroups].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    // Legacy fallback: each item is its own “group”
    const items = state.checklistItems || [];
    return items
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(it => ({
        label: it.label,
        required: it.required,
        sort_order: it.sort_order,
        itemIds: [it.id],
      }));
  }, [state]);

  const usingGroups = useMemo(() => {
    return Boolean(state?.checklistGroups && state.checklistGroups.length);
  }, [state]);

  const requiredLabels = useMemo(() => {
    return displayGroups.filter(g => g.required).map(g => g.label);
  }, [displayGroups]);

  const remainingRequired = useMemo(() => {
    const done = usingGroups ? doneLabels : doneItemIds; // fallback behaves similarly because itemIds mapped to label
    return requiredLabels.filter(lbl => !done.has(lbl)).length;
  }, [requiredLabels, doneLabels, doneItemIds, usingGroups]);

  async function checkGroup(group: ChecklistGroup) {
    if (!qrToken) return;
    if (usingGroups && doneLabels.has(group.label)) return;
    if (!usingGroups && doneItemIds.has(group.label)) return; // fallback mapping uses label as key

    setErr(null);

    // optimistic
    if (usingGroups) {
      setDoneLabels(prev => new Set(prev).add(group.label));
    } else {
      setDoneItemIds(prev => new Set(prev).add(group.label));
    }

    const res = await fetch("/api/checklist/check-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shiftId,
        qrToken,
        itemIds: group.itemIds,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      // rollback optimism
      if (usingGroups) {
        setDoneLabels(prev => {
          const copy = new Set(prev);
          copy.delete(group.label);
          return copy;
        });
      } else {
        setDoneItemIds(prev => {
          const copy = new Set(prev);
          copy.delete(group.label);
          return copy;
        });
      }
      setErr(json?.error || "Failed to check item(s).");
      return;
    }

    // optional: hard refresh to ensure server truth (helps if multi-kiosk)
    // await refreshShift();
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!state) return <div className="p-6">No data.</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Shift</h1>

        <div className="text-sm text-gray-600">
          Store: <b>{state.store.name}</b> · Employee: <b>{state.employee || "Unknown"}</b> · Type:{" "}
          <b>{state.shift.shift_type}</b>
        </div>

        {shiftType === "double" && (
          <ChangeoverPanel
            shiftId={shiftId}
            qrToken={qrToken}
            expectedCents={state.store.expected_drawer_cents}
            alreadyConfirmed={hasChangeover}
            onDone={async () => {
              try {
                await refreshShift();
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : "Failed to refresh shift.");
              }
            }}
          />
        )}

        {shiftType !== "other" && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Checklist</div>

            {displayGroups.length === 0 ? (
              <div className="text-sm border rounded p-3">No checklist items found.</div>
            ) : (
              <ul className="border rounded divide-y">
                {displayGroups.map(g => {
                  const isDone = usingGroups ? doneLabels.has(g.label) : doneItemIds.has(g.label);
                  return (
                    <li key={g.label} className="flex items-center justify-between p-3">
                      <div>
                        <div>{g.label}</div>
                        <div className="text-xs text-gray-500">{g.required ? "Required" : "Optional"}</div>
                      </div>
                      <button
                        onClick={() => checkGroup(g)}
                        disabled={isDone}
                        className={`px-3 py-1 rounded ${isDone ? "bg-green-500 text-white" : "bg-gray-200"}`}
                      >
                        {isDone ? "Done" : "Check"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="text-sm">
              {remainingRequired > 0
                ? `Finish ${remainingRequired} required item${remainingRequired === 1 ? "" : "s"} before clock out.`
                : "All required items done."}
            </div>
          </div>
        )}

        <button
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
          disabled={shiftType !== "other" && remainingRequired > 0}
          onClick={() => setShowClockOut(true)}
        >
          Clock Out
        </button>

        {showClockOut && (
          <ClockOutModal
            shiftId={shiftId}
            qrToken={qrToken}
            expectedCents={state.store.expected_drawer_cents}
            isOther={shiftType === "other"}
            onClose={() => setShowClockOut(false)}
            onSuccess={() => router.replace(`/shift/${shiftId}/done?t=${encodeURIComponent(qrToken)}`)}
          />
        )}
      </div>
    </div>
  );
}

function ChangeoverPanel({
  shiftId,
  qrToken,
  expectedCents,
  alreadyConfirmed,
  onDone,
}: {
  shiftId: string;
  qrToken: string;
  expectedCents: number;
  alreadyConfirmed: boolean;
  onDone: () => void;
}) {
  const [drawer, setDrawer] = useState("200");
  const [confirm, setConfirm] = useState(false);
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (alreadyConfirmed) {
    return <div className="border rounded p-3 text-sm text-green-700">Changeover drawer count recorded.</div>;
  }

  const cents = Math.round(Number(drawer) * 100);
  const msg = Number.isFinite(cents) ? thresholdMessage(cents, expectedCents) : null;

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="text-sm font-medium">Mid-shift Changeover</div>

      <label className="text-sm">Drawer count ($)</label>
      <input className="w-full border rounded p-2" inputMode="decimal" value={drawer} onChange={e => setDrawer(e.target.value)} />

      {msg && <div className="text-sm border rounded p-2 text-amber-700 border-amber-300">{msg}</div>}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
        I confirm this count is correct (if outside threshold)
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
        I notified manager (optional v1)
      </label>

      <label className="text-sm">Note (optional)</label>
      <input className="w-full border rounded p-2" value={note} onChange={e => setNote(e.target.value)} />

      {err && <div className="text-sm text-red-600 border border-red-300 rounded p-2">{err}</div>}

      <button
        className="rounded bg-black text-white px-3 py-2 disabled:opacity-50"
        disabled={saving || !Number.isFinite(cents)}
        onClick={async () => {
          setErr(null);
          setSaving(true);
          try {
            const res = await fetch("/api/confirm-changeover", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                qrToken,
                shiftId,
                drawerCents: cents,
                confirmed: confirm,
                notifiedManager: notify,
                note: note || null,
              }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || "Failed to confirm changeover.");
            onDone();
          } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : "Failed to confirm changeover.");
          } finally {
            setSaving(false);
          }
        }}
      >
        Save Changeover Count
      </button>
    </div>
  );
}

function ClockOutModal({
  shiftId,
  qrToken,
  expectedCents,
  isOther,
  onClose,
  onSuccess,
}: {
  shiftId: string;
  qrToken: string;
  expectedCents: number;
  isOther: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [endLocal, setEndLocal] = useState(toLocalInputValue());
  const [drawer, setDrawer] = useState("200");
  const [confirm, setConfirm] = useState(false);
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState("");
  const [doubleCheck, setDoubleCheck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cents = Math.round(Number(drawer) * 100);
  const msg = Number.isFinite(cents) ? thresholdMessage(cents, expectedCents) : null;

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-4 space-y-3">
        <h2 className="text-lg font-semibold">End Shift</h2>

        <label className="text-sm">End time</label>
        <input type="datetime-local" className="w-full border rounded p-2" value={endLocal} onChange={e => setEndLocal(e.target.value)} />

        <label className="text-sm">Ending drawer count ($){isOther ? " (optional)" : ""}</label>
        <input className="w-full border rounded p-2" inputMode="decimal" value={drawer} onChange={e => setDrawer(e.target.value)} />

        {msg && <div className="text-sm border rounded p-2 text-amber-700 border-amber-300">{msg}</div>}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
          I confirm this count is correct (if outside threshold)
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
          I notified manager (optional v1)
        </label>

        <label className="text-sm">Note (optional)</label>
        <input className="w-full border rounded p-2" value={note} onChange={e => setNote(e.target.value)} />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={doubleCheck} onChange={e => setDoubleCheck(e.target.checked)} />
          I understand I’m ending my shift.
        </label>

        {err && <div className="text-sm text-red-600 border border-red-300 rounded p-2">{err}</div>}

        <div className="flex gap-2 justify-end">
          <button className="px-3 py-1.5 rounded border" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            disabled={saving || !doubleCheck || (!isOther && !Number.isFinite(cents))}
            className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
            onClick={async () => {
              setErr(null);
              const d = new Date(endLocal);
              if (Number.isNaN(d.getTime())) {
                setErr("Invalid date/time.");
                return;
              }

              setSaving(true);
              try {
                const res = await fetch("/api/end-shift", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    qrToken,
                    shiftId,
                    endAt: d.toISOString(),
                    endDrawerCents: isOther ? (Number.isFinite(cents) ? cents : null) : cents,
                    confirmed: confirm,
                    notifiedManager: notify,
                    note: note || null,
                  }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json?.error || "Failed to end shift.");
                onClose();
                onSuccess();
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : "Failed to end shift.");
              } finally {
                setSaving(false);
              }
            }}
          >
            Confirm End Shift
          </button>
        </div>
      </div>
    </div>
  );
}
