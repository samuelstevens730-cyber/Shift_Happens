/**
 * Shift Detail Page - Active Shift Management
 *
 * Main interface for employees during an active shift. Displays:
 * - Store and employee info
 * - Drawer counts (start, changeover for doubles, end)
 * - Shift checklist with required/optional items
 * - Manager assignments (tasks and messages)
 *
 * Clock-out is blocked until:
 * - All required checklist items are completed
 * - All messages are acknowledged
 * - All tasks are marked complete
 * - Changeover drawer count recorded (for double shifts)
 *
 * Automatically redirects to /shift/[id]/done when shift has ended.
 */

// src/app/shift/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { isOutOfThreshold, thresholdMessage } from "@/lib/kioskRules";

type ShiftType = "open" | "close" | "double" | "other";

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

  // legacy, safe to keep
  checklistItems: { id: string; label: string; sort_order: number; required: boolean }[];
  checkedItemIds: string[];

  // NEW grouped UI payload - checklist items grouped by label
  checklistGroups: {
    label: string;
    norm: string; // stable key for deduplication
    required: boolean;
    sort_order: number;
    itemIds: string[];
  }[];

  // IMPORTANT: backend currently returns labels, not norms
  checkedGroupLabels: string[];

  // Tasks/messages assigned by manager for this shift
  assignments: {
    id: string;
    type: "task" | "message";
    message: string;
    created_at: string;
    created_by: string | null;
    delivered_at: string | null;
    acknowledged_at: string | null;
    completed_at: string | null;
  }[];
};

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shouldShowVarianceControls(drawerCents: number, expectedCents: number) {
  if (!Number.isFinite(drawerCents) || !Number.isFinite(expectedCents)) return false;
  return isOutOfThreshold(drawerCents, expectedCents);
}

export default function ShiftPage() {
  const { id } = useParams<{ id: string }>();
  const shiftId = id;

  const router = useRouter();
  const search = useSearchParams();
  const qrToken = search.get("t") || "";
  // Indicates this shift was reused (employee already clocked in today)
  const reused = search.get("reused") === "1";
  const reusedStartedAt = search.get("startedAt");

  const [state, setState] = useState<ShiftState | null>(null);

  // done = Set of GROUP NORMS, always.
  const [done, setDone] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showClockOut, setShowClockOut] = useState(false);
  const [showReuseBanner, setShowReuseBanner] = useState(reused);

  // Convert backend "checkedGroupLabels" -> frontend Set of group.norm keys
  const seedDoneFromState = useCallback((json: ShiftState) => {
    const labels = json.checkedGroupLabels || [];
    const groups = json.checklistGroups || [];

    const labelToNorm = new Map(groups.map(g => [g.label, g.norm]));
    const norms = labels.map(l => labelToNorm.get(l)).filter((x): x is string => Boolean(x));

    setDone(new Set(norms));
  }, []);

  const reloadShift = useCallback(async () => {
    const query = qrToken ? `?t=${encodeURIComponent(qrToken)}` : "";
    const res = await fetch(`/api/shift/${shiftId}${query}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load shift.");

    setState(json);
    seedDoneFromState(json);

    // If shift already ended, redirect to completion page
    if (json.shift?.ended_at) {
      const doneQuery = qrToken ? `?t=${encodeURIComponent(qrToken)}` : "";
      router.replace(`/shift/${shiftId}/done${doneQuery}`);
    }
  }, [qrToken, shiftId, router, seedDoneFromState]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setErr(null);
        setLoading(true);
        await reloadShift();
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
  }, [reloadShift]);

  const shiftType = state?.shift.shift_type;

  // Check if changeover count already exists (for double shifts)
  const hasChangeover = useMemo(() => {
    return (state?.counts || []).some(c => c.count_type === "changeover");
  }, [state]);

  // Get all required checklist group keys
  const requiredGroupKeys = useMemo(() => {
    return (state?.checklistGroups || [])
      .filter(g => g.required)
      .map(g => g.norm);
  }, [state]);

  // Count remaining required items not yet completed
  const remainingRequired = useMemo(() => {
    return requiredGroupKeys.filter(k => !done.has(k)).length;
  }, [requiredGroupKeys, done]);

  // Messages that haven't been acknowledged yet
  const pendingMessages = useMemo(() => {
    return (state?.assignments || []).filter(a => a.type === "message" && !a.acknowledged_at);
  }, [state]);

  // Tasks that haven't been completed yet
  const pendingTasks = useMemo(() => {
    return (state?.assignments || []).filter(a => a.type === "task" && !a.completed_at);
  }, [state]);

  /**
   * Mark an assignment as acknowledged (messages) or completed (tasks).
   * Updates local state optimistically.
   */
  async function updateAssignment(assignmentId: string, action: "ack" | "complete") {
    setErr(null);
    const res = await fetch(`/api/shift/${shiftId}/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(json?.error || "Failed to update assignment.");
      return;
    }
    // Optimistic update
    setState(prev => {
      if (!prev) return prev;
      const nextAssignments = (prev.assignments || []).map(a => {
        if (a.id !== assignmentId) return a;
        if (action === "ack") return { ...a, acknowledged_at: new Date().toISOString() };
        return { ...a, completed_at: new Date().toISOString() };
      });
      return { ...prev, assignments: nextAssignments };
    });
  }

  /**
   * Mark a checklist group as complete.
   * Uses optimistic UI, rolls back on failure.
   */
  async function checkGroup(group: { norm: string; itemIds: string[] }) {
    if (done.has(group.norm)) return;

    setErr(null);
    setDone(prev => new Set(prev).add(group.norm)); // optimistic

    const res = await fetch("/api/checklist/check-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftId, qrToken, itemIds: group.itemIds }),
    });

    const json = await res.json();

    if (!res.ok) {
      // Rollback optimistic update
      setDone(prev => {
        const copy = new Set(prev);
        copy.delete(group.norm);
        return copy;
      });
      setErr(json?.error || "Failed to check item group.");
      return;
    }

    // If you want strict truth instead of optimistic UI, uncomment:
    // await reloadShift();
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!state) return <div className="p-6">No data.</div>;

  const reuseLabel = reusedStartedAt
    ? new Date(reusedStartedAt).toLocaleString()
    : "an earlier time";

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Shift</h1>

        {/* Banner shown when redirected to existing open shift */}
        {showReuseBanner && (
          <div className="banner text-sm">
            Redirected to currently open shift started at {reuseLabel}.
            <button
              className="ml-3 underline"
              onClick={() => setShowReuseBanner(false)}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="text-sm text-gray-600">
          Store: <b>{state.store.name}</b> · Employee: <b>{state.employee || "Unknown"}</b> · Type:{" "}
          <b>{state.shift.shift_type}</b>
        </div>

        {/* Double shifts require mid-shift drawer count */}
        {shiftType === "double" && (
          <ChangeoverPanel
            shiftId={shiftId}
            qrToken={qrToken}
            expectedCents={state.store.expected_drawer_cents}
            alreadyConfirmed={hasChangeover}
            onDone={reloadShift}
          />
        )}

        {/* Checklist section - not shown for "other" shift types */}
        {shiftType !== "other" && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Checklist</div>

            {(state.checklistGroups || []).length === 0 ? (
              <div className="text-sm border rounded p-3">No checklist items found.</div>
            ) : (
              <ul className="border rounded divide-y">
                {state.checklistGroups.map(g => {
                  const isDone = done.has(g.norm);
                  return (
                    <li key={g.norm} className="flex items-center justify-between p-3">
                      <div>
                        <div>{g.label}</div>
                        <div className="text-xs text-gray-500">{g.required ? "Required" : "Optional"}</div>
                      </div>
                      <button
                        onClick={() => checkGroup(g)}
                        disabled={isDone}
                        className={`px-3 py-1 rounded text-black ${isDone ? "bg-green-500" : "bg-gray-200"}`}
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
                ? `Finish ${remainingRequired} required task${remainingRequired === 1 ? "" : "s"} before clock out.`
                : "All required tasks done."}
            </div>
          </div>
        )}

        {/* Manager assignments section */}
        {(pendingMessages.length > 0 || pendingTasks.length > 0) && (
          <div className="space-y-3">
            {/* Messages require acknowledgment */}
            {pendingMessages.length > 0 && (
              <div className="border rounded p-3 space-y-2">
                <div className="text-sm font-medium">Manager Messages</div>
                <div className="space-y-2">
                  {pendingMessages.map(m => (
                    <label key={m.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(m.acknowledged_at)}
                        onChange={() => updateAssignment(m.id, "ack")}
                      />
                      <span>{m.message}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks require completion */}
            {pendingTasks.length > 0 && (
              <div className="border rounded p-3 space-y-2">
                <div className="text-sm font-medium">Tasks</div>
                <div className="space-y-2">
                  {pendingTasks.map(t => (
                    <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{t.message}</span>
                      <button
                        className="px-3 py-1 rounded border"
                        onClick={() => updateAssignment(t.id, "complete")}
                      >
                        Mark Complete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {pendingMessages.length + pendingTasks.length > 0 && (
          <div className="text-sm">
            Please acknowledge all messages and complete all tasks before clocking out.
          </div>
        )}

        {/* Clock out button - disabled until all requirements met */}
        <button
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
          disabled={
            (shiftType !== "other" && remainingRequired > 0) ||
            pendingMessages.length > 0 ||
            pendingTasks.length > 0
          }
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
            onSuccess={() => {
              router.replace("/");
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Changeover Panel - Mid-shift drawer count for double shifts
 *
 * Double shifts require a drawer count at the midpoint when one employee
 * hands off to another. This panel collects that count with variance detection.
 */
/* ------------------- ChangeoverPanel (REAL) ------------------- */
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

  const cents = Math.round(Number(drawer) * 100);
  const msg = Number.isFinite(cents) ? thresholdMessage(cents, expectedCents) : null;
  const outOfThreshold = shouldShowVarianceControls(cents, expectedCents);

  // If you go back into normal range, wipe the extra acknowledgements.
  useEffect(() => {
    if (!outOfThreshold) {
      setConfirm(false);
      setNotify(false);
    }
  }, [outOfThreshold]);

  if (alreadyConfirmed) {
    return <div className="border rounded p-3 text-sm text-green-700">Changeover drawer count recorded.</div>;
  }

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="text-sm font-medium">Mid-shift Changeover</div>

      <label className="text-sm">Drawer count ($)</label>
      <input
        className="w-full border rounded p-2"
        inputMode="decimal"
        value={drawer}
        onChange={e => setDrawer(e.target.value)}
      />

      {msg && (
        <div className="text-sm border rounded p-2 text-amber-700 border-amber-300">
          {msg}
        </div>
      )}

      {/* Variance confirmation - only shown when drawer is out of threshold */}
      {outOfThreshold && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
            I confirm this count is correct (required when outside threshold)
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
            I notified manager (optional)
          </label>
        </>
      )}

      <label className="text-sm">Note (optional)</label>
      <input className="w-full border rounded p-2" value={note} onChange={e => setNote(e.target.value)} />

      {err && <div className="text-sm text-red-600 border border-red-300 rounded p-2">{err}</div>}

      <button
        className="rounded bg-black text-white px-3 py-2 disabled:opacity-50"
        disabled={saving || !Number.isFinite(cents) || (outOfThreshold && !confirm)}
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
                confirmed: outOfThreshold ? confirm : false,
                notifiedManager: outOfThreshold ? notify : false,
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

      {outOfThreshold && !confirm && (
        <div className="text-xs text-gray-600">
          Confirmation is required when the drawer is outside the allowed threshold.
        </div>
      )}
    </div>
  );
}

/**
 * Clock Out Modal - End shift confirmation dialog
 *
 * Collects end time and drawer count, validates against thresholds,
 * and requires explicit confirmation to prevent accidental clock-outs.
 */
/* ------------------- ClockOutModal (REAL) ------------------- */
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
  const hasValidDrawer = Number.isFinite(cents);
  const msg = hasValidDrawer ? thresholdMessage(cents, expectedCents) : null;
  const outOfThreshold = hasValidDrawer ? shouldShowVarianceControls(cents, expectedCents) : false;

  // Reset confirmations when drawer goes back in range
  useEffect(() => {
    if (!outOfThreshold) {
      setConfirm(false);
      setNotify(false);
    }
  }, [outOfThreshold]);

  const canSubmit =
    !saving &&
    doubleCheck &&
    (isOther ? true : hasValidDrawer) &&
    (outOfThreshold ? confirm : true);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4">
      <div className="w-full max-w-md bg-white text-black rounded-2xl p-4 space-y-3">
        <h2 className="text-lg font-semibold">End Shift</h2>

        <label className="text-sm">End time</label>
        <input
          type="datetime-local"
          className="w-full border rounded p-2"
          value={endLocal}
          onChange={e => setEndLocal(e.target.value)}
        />

        <label className="text-sm">Ending drawer count ($){isOther ? " (optional)" : ""}</label>
        <input
          className="w-full border rounded p-2"
          inputMode="decimal"
          value={drawer}
          onChange={e => setDrawer(e.target.value)}
        />

        {msg && (
          <div className="text-sm border rounded p-2 text-amber-700 border-amber-300">
            {msg}
          </div>
        )}

        {/* Variance confirmation - only shown when drawer is out of threshold */}
        {outOfThreshold && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
              I confirm this count is correct (required when outside threshold)
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
              I notified manager (optional)
            </label>
          </>
        )}

        <label className="text-sm">Note (optional)</label>
        <input className="w-full border rounded p-2" value={note} onChange={e => setNote(e.target.value)} />

        {/* Final confirmation to prevent accidental clock-outs */}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={doubleCheck} onChange={e => setDoubleCheck(e.target.checked)} />
          I understand I'm ending my shift.
        </label>

        {err && <div className="text-sm text-red-600 border border-red-300 rounded p-2">{err}</div>}

        <div className="flex gap-2 justify-end">
          <button className="px-3 py-1.5 rounded border" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            disabled={!canSubmit}
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
                    endDrawerCents: isOther ? (hasValidDrawer ? cents : null) : cents,
                    confirmed: outOfThreshold ? confirm : false,
                    notifiedManager: outOfThreshold ? notify : false,
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

        {outOfThreshold && !confirm && (
          <div className="text-xs text-gray-600">
            Confirmation is required when the drawer is outside the allowed threshold.
          </div>
        )}
      </div>
    </div>
  );
}
