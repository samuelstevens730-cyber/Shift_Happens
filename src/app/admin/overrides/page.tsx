/**
 * Long Shift Overrides Page - Approve shifts exceeding maximum duration threshold
 *
 * This administrative page displays shifts that have exceeded the maximum allowed duration
 * (typically 13+ hours) and require manual override approval before being processed for
 * payroll. This prevents payroll errors from forgotten clock-outs or system glitches.
 *
 * Features:
 * - View all shifts requiring duration override approval
 * - Display shift details including store, employee, start/end times, and calculated duration
 * - Require approval note explaining why the long shift is valid
 * - One-click approval with mandatory justification
 * - Automatic list refresh after approval
 *
 * Business Logic:
 * - Shifts over the threshold (e.g., 13 hours) are flagged for review
 * - Approval note is required - empty notes are rejected
 * - Approved shifts are removed from the pending list and become eligible for payroll
 * - This acts as a safeguard against paying for incorrectly long shifts
 * - Common valid reasons include double shifts, overnight coverage, or special events
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type OverrideRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  employeeName: string | null;
  shiftType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationHours: number | null;
};

type OverridesResponse = { rows: OverrideRow[] } | { error: string };
type SimpleResponse = { ok: true } | { error: string };

function formatWhen(value: string | null) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function OverridesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const actionId = searchParams.get("actionId");
  const actionStoreId = searchParams.get("storeId");
  const highlightedShiftId =
    actionId?.startsWith("people-") ? actionId.replace("people-", "") : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/overrides");
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
          router.replace("/login?next=/admin/overrides");
          return;
        }

        const res = await fetch("/api/admin/overrides", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as OverridesResponse;
        if (!alive) return;
        if (!res.ok || "error" in json) {
          const msg = "error" in json ? json.error : "Failed to load overrides.";
          setError(msg);
          setRows([]);
          return;
        }
        setRows(json.rows);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load overrides.");
        setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [isAuthed, router]);

  async function approveShift(shiftId: string) {
    if (savingIds.has(shiftId)) return;
    setSavingIds(prev => new Set(prev).add(shiftId));
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/overrides");
        return;
      }

      const note = (notes[shiftId] || "").trim();
      if (!note) {
        setError("Approval note is required.");
        return;
      }

      const res = await fetch(`/api/admin/overrides/${shiftId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ note }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        const msg = "error" in json ? json.error : "Failed to approve override.";
        setError(msg);
        return;
      }

      setRows(prev => prev.filter(r => r.id !== shiftId));
      setNotes(prev => {
        const copy = { ...prev };
        delete copy[shiftId];
        return copy;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to approve override.");
    } finally {
      setSavingIds(prev => {
        const copy = new Set(prev);
        copy.delete(shiftId);
        return copy;
      });
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Long Shift Overrides</h1>

        {source === "dashboard" && (
          <div className="banner text-xs border border-cyan-500/40 bg-cyan-500/10 text-cyan-100">
            Opened from Command Center Action Items{actionStoreId ? " · Store filter applied where possible." : "."}
          </div>
        )}

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="space-y-3">
          {rows.map(r => (
            <div
              key={r.id}
              className={`card card-pad space-y-2 ${
                highlightedShiftId === r.id ? "border-cyan-400/80 ring-1 ring-cyan-400/40" : ""
              }`}
            >
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div className="text-sm muted">
                  <b>{r.storeName || "Unknown Store"}</b>
                </div>
                <div className="text-xs muted">
                  Ended: {formatWhen(r.endedAt)}
                </div>
              </div>

              <div className="text-sm">
                Employee: <b>{r.employeeName || "Unknown"}</b>{" "}
                {r.shiftType && <span>- Shift: {r.shiftType}</span>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div>Started: <b>{formatWhen(r.startedAt)}</b></div>
                <div>Duration: <b>{r.durationHours != null ? `${r.durationHours} hrs` : "--"}</b></div>
                <div>Status: <b>Requires override</b></div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  className="input text-sm"
                  placeholder="Approval note (required)"
                  value={notes[r.id] ?? ""}
                  onChange={e => setNotes(prev => ({ ...prev, [r.id]: e.target.value }))}
                />
                <button
                  className="btn-primary px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() => approveShift(r.id)}
                  disabled={savingIds.has(r.id)}
                >
                  {savingIds.has(r.id) ? "Saving..." : "Approve"}
                </button>
              </div>
            </div>
          ))}

          {!rows.length && (
            <div className="card card-pad text-center text-sm muted">
              No shifts require override.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
