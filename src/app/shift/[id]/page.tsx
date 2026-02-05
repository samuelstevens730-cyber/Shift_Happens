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
import { isOutOfThreshold, roundTo30Minutes, thresholdMessage } from "@/lib/kioskRules";
import { getCstDowMinutes, isTimeWithinWindow, toStoreKey, WindowShiftType } from "@/lib/clockWindows";
import { playAlarm, stopAlarm } from "@/lib/alarm";
import { supabase } from "@/lib/supabaseClient";
import HomeHeader from "@/components/HomeHeader";

const PIN_TOKEN_KEY = "sh_pin_token";

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

function getCstOffsetMinutes(isoLike: string) {
  const dt = new Date(isoLike);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(dt);
  const tz = parts.find(p => p.type === "timeZoneName")?.value || "";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2] || "0");
  return hours * 60 + (hours < 0 ? -mins : mins);
}

function toCstDateFromLocalInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  const isoLike = `${y}-${m}-${d}T${hh}:${mm}:00Z`;
  const offset = getCstOffsetMinutes(isoLike);
  if (offset == null) return null;
  const utcMillis = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)) - offset * 60000;
  return new Date(utcMillis);
}

function shouldShowVarianceControls(drawerCents: number, expectedCents: number) {
  if (!Number.isFinite(drawerCents) || !Number.isFinite(expectedCents)) return false;
  return isOutOfThreshold(drawerCents, expectedCents);
}

function formatDateTime(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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

  // Auth state for API calls
  const [pinToken, setPinToken] = useState<string | null>(null);
  const [managerAccessToken, setManagerAccessToken] = useState<string | null>(null);
  const [managerSession, setManagerSession] = useState(false);

  // Load auth tokens on mount
  useEffect(() => {
    // Load PIN token from session storage
    const storedToken = sessionStorage.getItem(PIN_TOKEN_KEY);
    if (storedToken) {
      setPinToken(storedToken);
    }

    // Check for Supabase manager session
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const hasSession = Boolean(data?.session?.user);
      setManagerSession(hasSession);
      if (hasSession && data?.session?.access_token) {
        setManagerAccessToken(data.session.access_token);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const hasSession = Boolean(session?.user);
      setManagerSession(hasSession);
      if (hasSession && session?.access_token) {
        setManagerAccessToken(session.access_token);
      } else {
        setManagerAccessToken(null);
      }
    });

    return () => {
      alive = false;
      sub?.subscription.unsubscribe();
    };
  }, []);

  // Convert backend "checkedGroupLabels" -> frontend Set of group.norm keys
  const seedDoneFromState = useCallback((json: ShiftState) => {
    const labels = json.checkedGroupLabels || [];
    const groups = json.checklistGroups || [];

    const labelToNorm = new Map(groups.map(g => [g.label, g.norm]));
    const norms = labels.map(l => labelToNorm.get(l)).filter((x): x is string => Boolean(x));

    setDone(new Set(norms));
  }, []);

  const resolveAuthToken = useCallback(async () => {
    if (managerAccessToken) return managerAccessToken;
    if (pinToken) return pinToken;
    const { data } = await supabase.auth.getSession();
    const hasSession = Boolean(data?.session?.user);
    setManagerSession(hasSession);
    if (hasSession && data?.session?.access_token) {
      setManagerAccessToken(data.session.access_token);
      return data.session.access_token;
    }
    return null;
  }, [managerAccessToken, pinToken]);

  const reloadShift = useCallback(async () => {
    const query = qrToken ? `?t=${encodeURIComponent(qrToken)}` : "";
    const authToken = await resolveAuthToken();
    if (!authToken) {
      return;
    }
    const res = await fetch(`/api/shift/${shiftId}${query}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load shift.");

    setState(json);
    seedDoneFromState(json);

    // If shift already ended, redirect to completion page
    if (json.shift?.ended_at) {
      const doneQuery = qrToken ? `?t=${encodeURIComponent(qrToken)}` : "";
      router.replace(`/shift/${shiftId}/done${doneQuery}`);
    }
  }, [resolveAuthToken, qrToken, shiftId, router, seedDoneFromState]);

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

  const endNote = useMemo(() => {
    return (state?.counts || []).find(c => c.count_type === "end")?.note ?? null;
  }, [state]);

  /**
   * Mark an assignment as acknowledged (messages) or completed (tasks).
   * Updates local state optimistically.
   */
  async function updateAssignment(assignmentId: string, action: "ack" | "complete") {
    setErr(null);
    const authToken = await resolveAuthToken();
    if (!authToken) {
      setErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
      return;
    }
    const res = await fetch(`/api/shift/${shiftId}/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
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
    ? formatDateTime(reusedStartedAt)
    : "an earlier time";

  return (
    <div className="min-h-screen">
      <HomeHeader
        isManager={managerSession}
        isAuthenticated={managerSession || Boolean(pinToken)}
        profileId={state?.shift?.profile_id ?? null}
      />
      <div className="p-6 pb-24">
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

        {endNote && (
          <div className="text-sm border rounded p-3">
            End note: <b>{endNote}</b>
          </div>
        )}

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
        <div className="sticky-cta">
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
        </div>

        {showClockOut && (
          <ClockOutModal
            shiftId={shiftId}
            qrToken={qrToken}
            expectedCents={state.store.expected_drawer_cents}
            storeName={state.store.name}
            shiftType={state.shift.shift_type}
            isOther={shiftType === "other"}
            onClose={() => setShowClockOut(false)}
            onSuccess={() => {
              router.replace("/");
            }}
            pinToken={pinToken}
            managerAccessToken={managerAccessToken}
            managerSession={managerSession}
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
  storeName,
  shiftType,
  isOther,
  onClose,
  onSuccess,
  pinToken,
  managerAccessToken,
  managerSession,
}: {
  shiftId: string;
  qrToken: string;
  expectedCents: number;
  storeName: string;
  shiftType: ShiftType;
  isOther: boolean;
  pinToken: string | null;
  managerAccessToken: string | null;
  managerSession: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [endLocal, setEndLocal] = useState(toLocalInputValue());
  const [drawer, setDrawer] = useState("200");
  const [changeDrawer, setChangeDrawer] = useState("200");
  const [confirm, setConfirm] = useState(false);
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState("");
  const [doubleCheck, setDoubleCheck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clockWindowModal, setClockWindowModal] = useState<{ open: boolean; label: string }>({
    open: false,
    label: "",
  });

  const storeKey = toStoreKey(storeName);

  function triggerClockWindowModal(label: string) {
    playAlarm();
    setClockWindowModal({ open: true, label });
  }

  const cents = Math.round(Number(drawer) * 100);
  const changeCents = Math.round(Number(changeDrawer) * 100);
  const hasValidDrawer = Number.isFinite(cents);
  const hasValidChange = Number.isFinite(changeCents);
  const msg = hasValidDrawer ? thresholdMessage(cents, expectedCents) : null;
  const outOfThreshold = hasValidDrawer ? shouldShowVarianceControls(cents, expectedCents) : false;
  const changeNot200 = hasValidChange ? changeCents !== 20000 : false;

  // Reset confirmations when drawer goes back in range
  useEffect(() => {
    if (!outOfThreshold && !changeNot200) {
      setConfirm(false);
      setNotify(false);
    }
  }, [outOfThreshold, changeNot200]);

  const canSubmit =
    !saving &&
    doubleCheck &&
    (isOther ? true : hasValidDrawer && hasValidChange) &&
    (outOfThreshold ? confirm : true) &&
    (changeNot200 ? notify : true);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 overflow-y-auto modal-under-header">
      <div className="w-full max-w-md bg-white text-black rounded-2xl p-4 space-y-3 max-h-[85vh] overflow-y-auto overscroll-contain">
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

        <label className="text-sm">Change drawer count ($){isOther ? " (optional)" : ""}</label>
        <input
          className="w-full border rounded p-2"
          inputMode="decimal"
          value={changeDrawer}
          onChange={e => setChangeDrawer(e.target.value)}
        />

        {hasValidChange && changeNot200 && (
          <div className="text-sm border rounded p-2 text-amber-700 border-amber-300">
            Change drawer should be exactly $200.00.
          </div>
        )}

        {/* Variance confirmation - only shown when drawer is out of threshold */}
        {outOfThreshold && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />
              I confirm this count is correct (required when outside threshold)
            </label>
          </>
        )}

        {(outOfThreshold || changeNot200) && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
            I notified manager (required if change drawer is not $200)
          </label>
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

              const d = toCstDateFromLocalInput(endLocal);
              if (!d || Number.isNaN(d.getTime())) {
                setErr("Invalid date/time.");
                return;
              }
              if (shiftType === "close") {
                const rounded = roundTo30Minutes(d);
                const cst = getCstDowMinutes(rounded);
                if (!storeKey || !cst) {
                  triggerClockWindowModal("Outside allowed clock window");
                  return;
                }
                const windowCheck = isTimeWithinWindow({
                  storeKey,
                  shiftType: "close" as WindowShiftType,
                  localDow: cst.dow,
                  minutes: cst.minutes,
                });
                if (!windowCheck.ok) {
                  triggerClockWindowModal(windowCheck.windowLabel);
                  return;
                }
              }

              // Determine auth token
              const authToken = managerSession ? managerAccessToken : pinToken;
              if (!authToken) {
                setErr(managerSession ? "Session expired. Please refresh." : "Please authenticate with your PIN.");
                return;
              }

              setSaving(true);
              try {
                const res = await fetch("/api/end-shift", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                  },
                  body: JSON.stringify({
                    qrToken,
                    shiftId,
                    endAt: d.toISOString(),
                    endDrawerCents: isOther ? (hasValidDrawer ? cents : null) : cents,
                    changeDrawerCents: isOther ? (hasValidChange ? changeCents : null) : changeCents,
                    confirmed: outOfThreshold ? confirm : false,
                    notifiedManager: (outOfThreshold || changeNot200) ? notify : false,
                    note: note || null,
                  }),
                });

                const json = await res.json();
                if (!res.ok) {
                  if (json?.code === "CLOCK_WINDOW_VIOLATION") {
                    triggerClockWindowModal(json?.windowLabel ?? "Outside allowed clock window");
                    return;
                  }
                  throw new Error(json?.error || "Failed to end shift.");
                }

                onClose();
                onSuccess();
                stopAlarm();
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

      {clockWindowModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card card-pad w-full max-w-md space-y-3 text-center">
            <div className="text-lg font-semibold">CONTACT MANAGER IMMEDIATELY.</div>
            <div className="text-xs muted">
              The alarm indicates an invalid time entry and stops once the entry is corrected or the process is exited.
            </div>
            <div className="text-xs muted">Proper clock in window: {clockWindowModal.label}</div>
            <button
              className="btn-secondary px-4 py-2"
              onClick={() => setClockWindowModal({ open: false, label: "" })}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
