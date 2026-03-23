"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type OverrideRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  employeeName: string | null;
  shiftType: string | null;
  plannedStartAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationHours: number | null;
  overrideNote: string | null;
};

type OverridesResponse = { rows: OverrideRow[] } | { error: string };
type BulkResponse = { ok: true; reviewedCount: number; shiftIds: string[] } | { error: string };
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

function OverridesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const actionId = searchParams.get("actionId");
  const actionStoreId = searchParams.get("storeId");
  const highlightedShiftId =
    actionId?.startsWith("people-") ? actionId.replace("people-", "") : null;

  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [drawerRow, setDrawerRow] = useState<OverrideRow | null>(null);
  const [drawerActionReason, setDrawerActionReason] = useState("");
  const [drawerApprovalNote, setDrawerApprovalNote] = useState("");
  const [drawerSaving, setDrawerSaving] = useState(false);

  async function fetchRows() {
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/overrides");
      return;
    }

    const res = await fetch("/api/admin/overrides", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as OverridesResponse;
    if (!res.ok || "error" in json) {
      throw new Error("error" in json ? json.error : "Failed to load overrides.");
    }
    setRows(json.rows);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/overrides");
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

  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    (async () => {
      try {
        await fetchRows();
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load overrides.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    setSelectedIds(prev => new Set([...prev].filter(id => rows.some(row => row.id === id))));
    if (drawerRow && !rows.some(row => row.id === drawerRow.id)) {
      setDrawerRow(null);
      setDrawerActionReason("");
      setDrawerApprovalNote("");
    }
  }, [rows, drawerRow]);

  const visibleRows = useMemo(() => {
    if (!actionStoreId) return rows;
    return rows.filter(row => row.storeId === actionStoreId);
  }, [actionStoreId, rows]);

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(row => selectedIds.has(row.id));

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleRows.forEach(row => next.delete(row.id));
      } else {
        visibleRows.forEach(row => next.add(row.id));
      }
      return next;
    });
  }

  async function approveSingle(shiftId: string, note: string) {
    setSavingIds(prev => new Set(prev).add(shiftId));
    setError(null);
    setSuccess(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/overrides");
        return false;
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
        throw new Error("error" in json ? json.error : "Failed to approve override.");
      }

      setRows(prev => prev.filter(row => row.id !== shiftId));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(shiftId);
        return next;
      });
      setSuccess("Scheduled shift variation approved.");
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to approve override.");
      return false;
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(shiftId);
        return next;
      });
    }
  }

  async function bulkReview(action: "clear" | "approve", shiftIds: string[], reason: string, note?: string) {
    if (!shiftIds.length) return false;
    setBulkSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/overrides");
        return false;
      }

      const res = await fetch("/api/admin/overrides/bulk-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shiftIds,
          action,
          reason,
          note: note ?? null,
        }),
      });
      const json = (await res.json()) as BulkResponse;
      if (!res.ok || "error" in json) {
        throw new Error("error" in json ? json.error : "Failed to review selected items.");
      }

      const clearedIds = new Set(json.shiftIds);
      setRows(prev => prev.filter(row => !clearedIds.has(row.id)));
      setSelectedIds(prev => new Set([...prev].filter(id => !clearedIds.has(id))));
      setSuccess(
        action === "clear"
          ? `Cleared ${json.reviewedCount} scheduled shift variation${json.reviewedCount === 1 ? "" : "s"}.`
          : `Approved ${json.reviewedCount} scheduled shift variation${json.reviewedCount === 1 ? "" : "s"}.`
      );
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to review selected items.");
      return false;
    } finally {
      setBulkSaving(false);
    }
  }

  async function clearSelected() {
    const ids = visibleRows.filter(row => selectedIds.has(row.id)).map(row => row.id);
    const reason = bulkReason.trim();
    if (!ids.length) {
      setError("Select at least one scheduled shift variation.");
      return;
    }
    if (!reason) {
      setError("Bulk clear reason is required.");
      return;
    }
    const ok = await bulkReview("clear", ids, reason);
    if (ok) setBulkReason("");
  }

  async function clearFromDrawer() {
    if (!drawerRow) return;
    const reason = drawerActionReason.trim();
    if (!reason) {
      setError("Review reason is required to clear this flag.");
      return;
    }
    setDrawerSaving(true);
    const ok = await bulkReview("clear", [drawerRow.id], reason);
    if (ok) {
      setDrawerRow(null);
      setDrawerActionReason("");
      setDrawerApprovalNote("");
    }
    setDrawerSaving(false);
  }

  async function approveFromDrawer() {
    if (!drawerRow) return;
    const note = drawerApprovalNote.trim();
    if (!note) {
      setError("Approval note is required.");
      return;
    }
    setDrawerSaving(true);
    const ok = await approveSingle(drawerRow.id, note);
    if (ok) {
      setDrawerRow(null);
      setDrawerActionReason("");
      setDrawerApprovalNote("");
    }
    setDrawerSaving(false);
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-7xl mx-auto space-y-6 pb-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Scheduled Shift Variations</h1>
            <p className="text-sm muted">
              Review flagged shifts, clear false positives in bulk, or open an item for a closer review.
            </p>
          </div>
          <div className="text-xs muted">
            {visibleRows.length} open item{visibleRows.length === 1 ? "" : "s"}
          </div>
        </div>

        {source === "dashboard" && (
          <div className="banner text-xs border border-cyan-500/40 bg-cyan-500/10 text-cyan-100">
            Opened from Command Center Action Items{actionStoreId ? " · Store filter applied." : "."}
          </div>
        )}

        {error && <div className="banner banner-error text-sm">{error}</div>}
        {success && <div className="banner text-sm">{success}</div>}

        <div className="card card-pad space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <b>{selectedIds.size}</b> selected
            </div>
            <button className="btn-secondary px-3 py-2 text-sm" onClick={toggleSelectVisible}>
              {allVisibleSelected ? "Clear Visible Selection" : "Select Visible"}
            </button>
          </div>
          <textarea
            className="input min-h-[88px] text-sm"
            placeholder="Reason for bulk clear. Example: Scheduled double matched planned start and clock-out times."
            value={bulkReason}
            onChange={e => setBulkReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              onClick={() => void clearSelected()}
              disabled={bulkSaving || selectedIds.size === 0}
            >
              {bulkSaving ? "Reviewing..." : "Clear Selected"}
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {visibleRows.map(row => {
            const selected = selectedIds.has(row.id);
            return (
              <div
                key={row.id}
                className={`card card-pad ${highlightedShiftId === row.id ? "border-cyan-400/80 ring-1 ring-cyan-400/40" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected}
                      onChange={() => toggleSelect(row.id)}
                    />
                    <div className="space-y-1">
                      <div className="text-sm">
                        <b>{row.employeeName || "Unknown"}</b> · {row.storeName || "Unknown Store"}
                      </div>
                      <div className="text-xs muted">
                        {row.shiftType || "Unknown"} · Planned start {formatWhen(row.plannedStartAt)} · Ended {formatWhen(row.endedAt)}
                      </div>
                      <div className="text-xs muted">
                        Started {formatWhen(row.startedAt)} · Duration {row.durationHours != null ? `${row.durationHours} hrs` : "--"}
                      </div>
                      {row.overrideNote && <div className="text-xs muted">Current note: {row.overrideNote}</div>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-secondary px-3 py-2 text-sm"
                      onClick={() => {
                        setDrawerRow(row);
                        setDrawerActionReason("");
                        setDrawerApprovalNote("");
                      }}
                    >
                      Review
                    </button>
                    <Link href={`/admin/shifts/${row.id}`} className="btn-secondary px-3 py-2 text-sm">
                      Open Shift
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}

          {!visibleRows.length && (
            <div className="card card-pad text-center text-sm muted">
              No scheduled shift variations need review.
            </div>
          )}
        </div>
      </div>

      {drawerRow && (
        <div className="fixed inset-0 z-40 bg-black/50">
          <div className="absolute inset-y-0 right-0 w-full max-w-xl bg-[#0f1115] border-l border-white/10 shadow-2xl overflow-y-auto">
            <div className="p-5 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Review Scheduled Shift Variation</h2>
                  <div className="text-sm muted">
                    {drawerRow.employeeName || "Unknown"} · {drawerRow.storeName || "Unknown Store"}
                  </div>
                </div>
                <button className="btn-secondary px-3 py-2 text-sm" onClick={() => setDrawerRow(null)}>
                  Close
                </button>
              </div>

              <div className="card card-pad space-y-2">
                <div className="text-sm"><b>Shift type:</b> {drawerRow.shiftType || "--"}</div>
                <div className="text-sm"><b>Planned start:</b> {formatWhen(drawerRow.plannedStartAt)}</div>
                <div className="text-sm"><b>Started:</b> {formatWhen(drawerRow.startedAt)}</div>
                <div className="text-sm"><b>Ended:</b> {formatWhen(drawerRow.endedAt)}</div>
                <div className="text-sm"><b>Duration:</b> {drawerRow.durationHours != null ? `${drawerRow.durationHours} hrs` : "--"}</div>
                {drawerRow.overrideNote && <div className="text-sm"><b>Existing note:</b> {drawerRow.overrideNote}</div>}
                <div className="pt-2">
                  <Link href={`/admin/shifts/${drawerRow.id}`} className="btn-secondary px-3 py-2 text-sm inline-flex">
                    Open Full Shift Detail
                  </Link>
                </div>
              </div>

              <div className="card card-pad space-y-3">
                <div className="text-sm font-medium">Clear Flag</div>
                <textarea
                  className="input min-h-[88px] text-sm"
                  placeholder="Reason for clearing this flag."
                  value={drawerActionReason}
                  onChange={e => setDrawerActionReason(e.target.value)}
                />
                <button
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                  onClick={() => void clearFromDrawer()}
                  disabled={drawerSaving}
                >
                  {drawerSaving ? "Saving..." : "Clear Flag"}
                </button>
              </div>

              <div className="card card-pad space-y-3">
                <div className="text-sm font-medium">Approve and Keep Review Trail</div>
                <textarea
                  className="input min-h-[88px] text-sm"
                  placeholder="Approval note for why this scheduled shift variation is acceptable."
                  value={drawerApprovalNote}
                  onChange={e => setDrawerApprovalNote(e.target.value)}
                />
                <button
                  className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                  onClick={() => void approveFromDrawer()}
                  disabled={drawerSaving || savingIds.has(drawerRow.id)}
                >
                  {drawerSaving || savingIds.has(drawerRow.id) ? "Saving..." : "Approve Variation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OverridesPage() {
  return (
    <Suspense fallback={<div className="app-shell">Loading...</div>}>
      <OverridesContent />
    </Suspense>
  );
}
