/**
 * Shift Management Page - Administrative CRUD interface for employee shifts
 *
 * This page provides administrators and managers with full control over shift records
 * in the system. It serves as the central hub for manually managing shift data when
 * automatic clock-in/out processes need correction or manual entry is required.
 *
 * Features:
 * - Create new shifts with store, employee, shift type, planned start, actual start, and optional end time
 * - Edit existing shifts including shift type, planned start, started at, and ended at timestamps
 * - Soft-delete (remove) shifts from reports
 * - Filter shifts by date range, store, and employee
 * - Paginated list view with 25 shifts per page
 *
 * Business Logic:
 * - Shift types include: open, close, double, and other
 * - All date/time inputs are converted to ISO format for API submission
 * - Removed shifts are soft-deleted and excluded from reports but not permanently destroyed
 * - Audit trail tracks last action and who performed it for each shift
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };
type Profile = { id: string; name: string | null; active: boolean | null };

type ShiftRow = {
  id: string;
  storeId: string;
  storeName: string | null;
  profileId: string;
  profileName: string | null;
  shiftType: "open" | "close" | "double" | "other";
  plannedStartAt: string;
  startedAt: string;
  endedAt: string | null;
  manualClosed: boolean;
  manualClosedAt: string | null;
  manualClosedReviewStatus: string | null;
  manualClosedReviewedAt: string | null;
  manualClosedReviewedBy: string | null;
  lastAction: string | null;
  lastActionBy: string | null;
};

type ShiftsResponse =
  | { stores: Store[]; profiles: Profile[]; rows: ShiftRow[]; page: number; pageSize: number; total: number }
  | { error: string };

type SimpleResponse = { ok: true } | { error: string };

function toLocalInputValue(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminShiftsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [manualRows, setManualRows] = useState<ShiftRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [manualPage, setManualPage] = useState(1);
  const [manualTotal, setManualTotal] = useState(0);
  const pageSize = 25;

  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterStore, setFilterStore] = useState("all");
  const [filterProfile, setFilterProfile] = useState("all");

  const [formStoreId, setFormStoreId] = useState("");
  const [formProfileId, setFormProfileId] = useState("");
  const [formShiftType, setFormShiftType] = useState<ShiftRow["shiftType"]>("open");
  const [formPlannedStart, setFormPlannedStart] = useState(() => toLocalInputValue());
  const [formStartedAt, setFormStartedAt] = useState(() => toLocalInputValue());
  const [formEndedAt, setFormEndedAt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/shifts");
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

  const loadShifts = async (nextPage = page) => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/shifts");
      return;
    }

    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(pageSize),
      from: new Date(filterFrom).toISOString(),
      to: new Date(filterTo).toISOString(),
    });
    if (filterStore !== "all") params.set("storeId", filterStore);
    if (filterProfile !== "all") params.set("profileId", filterProfile);

    const res = await fetch(`/api/admin/shifts?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as ShiftsResponse;
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load shifts.");
      return;
    }

    setStores(json.stores);
    setProfiles(json.profiles);
    setRows(json.rows);
    setPage(json.page);
    setTotal(json.total);

    if (!formStoreId && json.stores.length) setFormStoreId(json.stores[0].id);
    if (!formProfileId && json.profiles.length) setFormProfileId(json.profiles[0].id);
  };

  const loadManualClosures = async (nextPage = manualPage) => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/shifts");
      return;
    }

    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(pageSize),
      from: new Date(filterFrom).toISOString(),
      to: new Date(filterTo).toISOString(),
      manualClosed: "1",
      manualClosedReviewed: "0",
    });
    if (filterStore !== "all") params.set("storeId", filterStore);
    if (filterProfile !== "all") params.set("profileId", filterProfile);

    const res = await fetch(`/api/admin/shifts?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as ShiftsResponse;
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load manual closures.");
      return;
    }

    setManualRows(json.rows);
    setManualPage(json.page);
    setManualTotal(json.total);
  };

  useEffect(() => {
    if (!isAuthed) return;
    void loadShifts(1);
    void loadManualClosures(1);
  }, [isAuthed]);

  const canCreate = useMemo(() => {
    return Boolean(formStoreId && formProfileId && formPlannedStart && formStartedAt);
  }, [formStoreId, formProfileId, formPlannedStart, formStartedAt]);

  async function createShift() {
    if (!canCreate || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/shifts");
        return;
      }

      const planned = new Date(formPlannedStart);
      const started = new Date(formStartedAt);
      if (Number.isNaN(planned.getTime()) || Number.isNaN(started.getTime())) {
        setError("Invalid start date/time.");
        return;
      }
      const ended = formEndedAt ? new Date(formEndedAt) : null;
      if (ended && Number.isNaN(ended.getTime())) {
        setError("Invalid end date/time.");
        return;
      }

      const res = await fetch("/api/admin/shifts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          storeId: formStoreId,
          profileId: formProfileId,
          shiftType: formShiftType,
          plannedStartAt: planned.toISOString(),
          startedAt: started.toISOString(),
          endedAt: ended ? ended.toISOString() : null,
        }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to add shift.");
        return;
      }

      await loadShifts(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add shift.");
    } finally {
      setSaving(false);
    }
  }

  async function updateShift(id: string, data: Partial<ShiftRow>) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/shifts");
        return;
      }

      const planned = data.plannedStartAt ? new Date(data.plannedStartAt) : null;
      const started = data.startedAt ? new Date(data.startedAt) : null;
      const ended = data.endedAt === null ? null : data.endedAt ? new Date(data.endedAt) : null;
      if ((planned && Number.isNaN(planned.getTime())) || (started && Number.isNaN(started.getTime())) || (ended && Number.isNaN(ended.getTime()))) {
        setError("Invalid date/time.");
        return;
      }

      const res = await fetch(`/api/admin/shifts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shiftType: data.shiftType,
          plannedStartAt: planned ? planned.toISOString() : undefined,
          startedAt: started ? started.toISOString() : undefined,
          endedAt: ended === null ? null : ended ? ended.toISOString() : undefined,
        }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to update shift.");
        return;
      }

      await loadShifts(page);
      await loadManualClosures(manualPage);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update shift.");
    } finally {
      setSaving(false);
    }
  }

  async function removeShift(id: string) {
    if (saving) return;
    if (!window.confirm("Remove this shift? It will disappear from reports.")) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/shifts");
        return;
      }

      const res = await fetch(`/api/admin/shifts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to remove shift.");
        return;
      }

      await loadShifts(page);
      await loadManualClosures(manualPage);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove shift.");
    } finally {
      setSaving(false);
    }
  }

  async function approveManualClose(id: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/shifts");
        return;
      }

      const res = await fetch(`/api/admin/shifts/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ manualCloseReview: "approved" }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to approve manual close.");
        return;
      }

      await loadManualClosures(manualPage);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to approve manual close.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Shifts</h1>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="card card-pad space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-lg font-medium">Review Shifts Closed Manually</div>
            <button className="btn-secondary px-3 py-1.5" onClick={() => loadManualClosures(1)} disabled={saving}>
              Refresh
            </button>
          </div>
          <div className="text-sm muted">
            These shifts were closed by employees outside the normal flow and require review.
          </div>
          <div className="space-y-3">
            {manualRows.map(r => (
              <ShiftCard
                key={r.id}
                row={r}
                onSave={updateShift}
                onRemove={removeShift}
                onApprove={approveManualClose}
                saving={saving}
                showApprove
              />
            ))}
            {!manualRows.length && (
              <div className="card card-pad text-center text-sm muted">
                No manual closures pending review.
              </div>
            )}
          </div>
          {manualTotal > pageSize && (
            <Pagination
              page={manualPage}
              pageSize={pageSize}
              total={manualTotal}
              onPageChange={p => loadManualClosures(p)}
            />
          )}
        </div>

        <div className="card card-pad space-y-4">
          <div className="text-lg font-medium">Add shift</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm muted">Store</label>
              <select className="select" value={formStoreId} onChange={e => setFormStoreId(e.target.value)}>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Employee</label>
              <select className="select" value={formProfileId} onChange={e => setFormProfileId(e.target.value)}>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Shift type</label>
              <select className="select" value={formShiftType} onChange={e => setFormShiftType(e.target.value as ShiftRow["shiftType"])}>
                <option value="open">Open</option>
                <option value="close">Close</option>
                <option value="double">Double</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Planned start</label>
              <input type="datetime-local" className="input" value={formPlannedStart} onChange={e => setFormPlannedStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Started at</label>
              <input type="datetime-local" className="input" value={formStartedAt} onChange={e => setFormStartedAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Ended at (optional)</label>
              <input type="datetime-local" className="input" value={formEndedAt} onChange={e => setFormEndedAt(e.target.value)} />
            </div>
          </div>
          <button className="btn-primary px-4 py-2 disabled:opacity-50" disabled={!canCreate || saving} onClick={createShift}>
            Add Shift
          </button>
        </div>

        <div className="card card-pad space-y-4">
          <div className="text-lg font-medium">Filters</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm muted">From</label>
              <input type="date" className="input" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">To</label>
              <input type="date" className="input" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Store</label>
              <select className="select" value={filterStore} onChange={e => setFilterStore(e.target.value)}>
                <option value="all">All</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Employee</label>
              <select className="select" value={filterProfile} onChange={e => setFilterProfile(e.target.value)}>
                <option value="all">All</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="btn-primary px-4 py-2"
            onClick={() => {
              void loadShifts(1);
              void loadManualClosures(1);
            }}
            disabled={saving}
          >
            Apply Filters
          </button>
        </div>

        <div className="space-y-3">
          {rows.map(r => (
            <ShiftCard
              key={r.id}
              row={r}
              onSave={updateShift}
              onRemove={removeShift}
              saving={saving}
            />
          ))}
          {!rows.length && (
            <div className="card card-pad text-center text-sm muted">
              No shifts found.
            </div>
          )}
        </div>

        {total > pageSize && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={p => loadShifts(p)}
          />
        )}
      </div>
    </div>
  );
}

function ShiftCard({
  row,
  onSave,
  onRemove,
  onApprove,
  saving,
  showApprove,
}: {
  row: ShiftRow;
  onSave: (id: string, data: Partial<ShiftRow>) => void;
  onRemove: (id: string) => void;
  onApprove?: (id: string) => void;
  saving: boolean;
  showApprove?: boolean;
}) {
  const [shiftType, setShiftType] = useState(row.shiftType);
  const [plannedStartAt, setPlannedStartAt] = useState(row.plannedStartAt);
  const [startedAt, setStartedAt] = useState(row.startedAt);
  const [endedAt, setEndedAt] = useState(row.endedAt ?? "");

  useEffect(() => {
    setShiftType(row.shiftType);
    setPlannedStartAt(row.plannedStartAt);
    setStartedAt(row.startedAt);
    setEndedAt(row.endedAt ?? "");
  }, [row]);

  return (
    <div className="card card-pad space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm muted">
          Store: <b>{row.storeName ?? "Unknown"}</b> · Employee: <b>{row.profileName ?? "Unknown"}</b>
        </div>
        <div className="text-xs muted">
          Last action: {row.lastAction ?? "—"}
        </div>
      </div>
      {row.manualClosed && !row.manualClosedReviewedAt && (
        <div className="text-xs text-amber-700">
          Manual closure pending review.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label className="text-xs muted">Shift type</label>
          <select className="select" value={shiftType} onChange={e => setShiftType(e.target.value as ShiftRow["shiftType"])}>
            <option value="open">Open</option>
            <option value="close">Close</option>
            <option value="double">Double</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs muted">Planned start</label>
          <input
            type="datetime-local"
            className="input"
            value={plannedStartAt.slice(0, 16)}
            onChange={e => setPlannedStartAt(new Date(e.target.value).toISOString())}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs muted">Started at</label>
          <input
            type="datetime-local"
            className="input"
            value={startedAt.slice(0, 16)}
            onChange={e => setStartedAt(new Date(e.target.value).toISOString())}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs muted">Ended at</label>
          <input
            type="datetime-local"
            className="input"
            value={endedAt ? endedAt.slice(0, 16) : ""}
            onChange={e => setEndedAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {showApprove && onApprove && (
          <button
            className="btn-primary px-4 py-2"
            onClick={() => onApprove(row.id)}
            disabled={saving}
          >
            Approve Manual Close
          </button>
        )}
        <button
          className="btn-primary px-4 py-2"
          onClick={() => onSave(row.id, { shiftType, plannedStartAt, startedAt, endedAt: endedAt || null })}
          disabled={saving}
        >
          Save Changes
        </button>
        <button
          className="btn-secondary px-4 py-2"
          onClick={() => onRemove(row.id)}
          disabled={saving}
        >
          Remove Shift
        </button>
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  for (let i = 1; i <= totalPages; i += 1) pages.push(i);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Prev
      </button>
      {pages.map(p => (
        <button
          key={p}
          className={p === page ? "btn-primary px-3 py-1.5" : "btn-secondary px-3 py-1.5"}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      <button className="btn-secondary px-3 py-1.5" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
