"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type OpenShiftRow = {
  id: string;
  storeName: string | null;
  expectedDrawerCents: number | null;
  employeeName: string | null;
  shiftType: string | null;
  plannedStartAt: string | null;
  startedAt: string | null;
  createdAt: string | null;
};

type OpenShiftResponse = { rows: OpenShiftRow[] } | { error: string };
type EndShiftResponse = { ok: true } | { error: string };

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function OpenShiftsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [rows, setRows] = useState<OpenShiftRow[]>([]);
  const [endTimes, setEndTimes] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [confirmShiftId, setConfirmShiftId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/open-shifts");
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

  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    (async () => {
      try {
        setError(null);
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        if (!token) {
          router.replace("/login?next=/admin/open-shifts");
          return;
        }

        const res = await fetch("/api/admin/open-shifts", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as OpenShiftResponse;
        if (!alive) return;
        if (!res.ok || "error" in json) {
          const msg = "error" in json ? json.error : "Failed to load open shifts.";
          setError(msg);
          setRows([]);
          return;
        }
        setRows(json.rows);
        setEndTimes(prev => {
          const next = { ...prev };
          json.rows.forEach(r => {
            if (!next[r.id]) next[r.id] = toLocalInputValue(new Date());
          });
          return next;
        });
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load open shifts.");
        setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [isAuthed, router]);

  const sortedRows = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      const aTime = a.startedAt || a.createdAt || a.plannedStartAt || "";
      const bTime = b.startedAt || b.createdAt || b.plannedStartAt || "";
      return bTime.localeCompare(aTime);
    });
    return copy;
  }, [rows]);

  async function endShift(shiftId: string) {
    if (savingIds.has(shiftId)) return;
    setSavingIds(prev => new Set(prev).add(shiftId));
    setError(null);
    try {
      const endLocal = endTimes[shiftId];
      const endAt = new Date(endLocal || "");
      if (Number.isNaN(endAt.getTime())) {
        setError("Invalid end time.");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/open-shifts");
        return;
      }

      const res = await fetch(`/api/admin/open-shifts/${shiftId}/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ endAt: endAt.toISOString() }),
      });
      const json = (await res.json()) as EndShiftResponse;
      if (!res.ok || "error" in json) {
        const msg = "error" in json ? json.error : "Failed to end shift.";
        setError(msg);
        return;
      }

      setRows(prev => prev.filter(r => r.id !== shiftId));
      setEndTimes(prev => {
        const next = { ...prev };
        delete next[shiftId];
        return next;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to end shift.");
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(shiftId);
        return next;
      });
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Open Shifts</h1>

        {error && <div className="text-sm text-red-600 border border-red-300 rounded p-3">{error}</div>}

        <div className="space-y-3">
          {sortedRows.map(r => (
            <div key={r.id} className="border rounded p-4 space-y-2">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div className="text-sm text-gray-600">
                  <b>{r.storeName || "Unknown Store"}</b>
                  {r.expectedDrawerCents != null && (
                    <span> (expected ${(r.expectedDrawerCents / 100).toFixed(2)})</span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  Started: {formatDate(r.startedAt)}
                </div>
              </div>

              <div className="text-sm">
                Employee: <b>{r.employeeName || "Unknown"}</b>{" "}
                {r.shiftType && <span>• Shift: {r.shiftType}</span>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div>Planned: <b>{formatDate(r.plannedStartAt)}</b></div>
                <div>Created: <b>{formatDate(r.createdAt)}</b></div>
                <div>Shift ID: <span className="text-gray-500">{r.id.slice(0, 8)}</span></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <label className="text-sm">End time</label>
                <input
                  type="datetime-local"
                  className="border rounded p-2 text-sm"
                  value={endTimes[r.id] ?? ""}
                  onChange={e => setEndTimes(prev => ({ ...prev, [r.id]: e.target.value }))}
                />
                <button
                  className="rounded bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() => setConfirmShiftId(r.id)}
                  disabled={savingIds.has(r.id)}
                >
                  {savingIds.has(r.id) ? "Saving..." : "End Shift"}
                </button>
              </div>
            </div>
          ))}

          {!sortedRows.length && (
            <div className="border rounded p-6 text-center text-gray-500 text-sm">
              No open shifts.
            </div>
          )}
        </div>
      </div>

      {confirmShiftId && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-4 space-y-4">
            <h2 className="text-lg font-semibold">Confirm End Shift</h2>
            <p className="text-sm text-gray-600">
              This will end the shift and record an admin placeholder drawer count.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 rounded border"
                onClick={() => setConfirmShiftId(null)}
                disabled={savingIds.has(confirmShiftId)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
                onClick={() => {
                  const id = confirmShiftId;
                  setConfirmShiftId(null);
                  void endShift(id);
                }}
                disabled={savingIds.has(confirmShiftId)}
              >
                Confirm End Shift
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
