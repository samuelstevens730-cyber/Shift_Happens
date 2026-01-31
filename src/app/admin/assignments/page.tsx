/**
 * Assignments Admin Page - Task and message assignment management
 *
 * This administrative page allows managers to create, view, and manage tasks and messages
 * that are assigned to employees or stores. Assignments are delivered to employees at the
 * start of their next shift and must be acknowledged (messages) or completed (tasks).
 *
 * Features:
 * - Create new tasks or messages targeted to specific employees or entire stores
 * - Filter assignments by date range, store, employee, and completion status
 * - View assignment details including delivery status, acknowledgment, and completion times
 * - Add audit notes to assignments for administrative tracking
 * - Delete individual assignments or bulk delete based on current filters
 * - Paginated list view with 25 assignments per page
 *
 * Business Logic:
 * - Tasks require completion confirmation; messages only require acknowledgment
 * - Store-targeted assignments are delivered to the next employee who clocks in at that store
 * - Employee-targeted assignments wait until that specific employee starts a shift
 * - Delivery tracking shows which shift and employee received the assignment
 * - Audit notes provide a way for admins to add context without modifying the original message
 * - Bulk delete respects current filters to allow targeted cleanup of old assignments
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Store = { id: string; name: string };
type User = { id: string; name: string; active: boolean };

type Assignment = {
  id: string;
  type: "task" | "message";
  message: string;
  target_profile_id: string | null;
  target_profile_name: string | null;
  target_store_id: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  delivered_at: string | null;
  delivered_shift_id: string | null;
  delivered_profile_id: string | null;
  delivered_profile_name: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  audit_note: string | null;
  audit_note_updated_at: string | null;
  audit_note_by: string | null;
  audit_note_by_name: string | null;
};

type AssignmentsResponse =
  | { stores: Store[]; users: User[]; assignments: Assignment[]; page: number; pageSize: number; total: number }
  | { error: string };

type SimpleResponse = { ok: true } | { error: string };

function formatWhen(value: string | null) {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function AssignmentsAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const [type, setType] = useState<"task" | "message">("task");
  const [targetMode, setTargetMode] = useState<"profile" | "store">("profile");
  const [targetProfileId, setTargetProfileId] = useState("");
  const [targetStoreId, setTargetStoreId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterStore, setFilterStore] = useState("all");
  const [filterProfile, setFilterProfile] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "completed">("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!alive) return;
        if (!user) {
          router.replace("/login?next=/admin/assignments");
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

  const loadAssignments = async (nextPage = page) => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/assignments");
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
    if (filterStatus !== "all") params.set("status", filterStatus);

    const res = await fetch(`/api/admin/assignments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as AssignmentsResponse;
    if (!res.ok || "error" in json) {
      setError("error" in json ? json.error : "Failed to load assignments.");
      return;
    }
    setStores(json.stores);
    setUsers(json.users);
    setAssignments(json.assignments);
    setPage(json.page);
    setTotal(json.total);
  };

  useEffect(() => {
    if (!isAuthed) return;
    void loadAssignments(1);
  }, [isAuthed]);

  const canCreate = useMemo(() => {
    if (!message.trim()) return false;
    if (targetMode === "profile") return Boolean(targetProfileId);
    return Boolean(targetStoreId);
  }, [message, targetMode, targetProfileId, targetStoreId]);

  async function createAssignment() {
    if (!canCreate || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/assignments");
        return;
      }

      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type,
          message: message.trim(),
          targetProfileId: targetMode === "profile" ? targetProfileId : undefined,
          targetStoreId: targetMode === "store" ? targetStoreId : undefined,
        }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to create assignment.");
        return;
      }

      setMessage("");
      setTargetProfileId("");
      setTargetStoreId("");
      await loadAssignments(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create assignment.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAuditNote(id: string, note: string) {
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/assignments");
        return;
      }

      const res = await fetch(`/api/admin/assignments/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ auditNote: note }),
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to save note.");
        return;
      }
      await loadAssignments(page);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save note.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAssignment(id: string) {
    if (saving) return;
    if (!window.confirm("Delete this assignment?")) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/assignments");
        return;
      }

      const res = await fetch(`/api/admin/assignments/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as SimpleResponse;
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to delete assignment.");
        return;
      }

      await loadAssignments(page);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete assignment.");
    } finally {
      setSaving(false);
    }
  }

  async function bulkDelete() {
    if (saving) return;
    if (!window.confirm("Delete all assignments matching the current filters?")) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) {
        router.replace("/login?next=/admin/assignments");
        return;
      }

      const res = await fetch("/api/admin/assignments/bulk-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filters: {
            from: new Date(filterFrom).toISOString(),
            to: new Date(filterTo).toISOString(),
            storeId: filterStore === "all" ? undefined : filterStore,
            profileId: filterProfile === "all" ? undefined : filterProfile,
            status: filterStatus,
          },
        }),
      });
      const json = (await res.json()) as { ok: true; deleted: number } | { error: string };
      if (!res.ok || "error" in json) {
        setError("error" in json ? json.error : "Failed to delete assignments.");
        return;
      }
      await loadAssignments(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete assignments.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="app-shell">Loading...</div>;
  if (!isAuthed) return null;

  return (
    <div className="app-shell">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Tasks & Messages</h1>

        {error && <div className="banner banner-error text-sm">{error}</div>}

        <div className="card card-pad space-y-4">
          <div className="text-lg font-medium">Assign for next shift</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm muted">Type</label>
              <select className="select" value={type} onChange={e => setType(e.target.value as "task" | "message")}>
                <option value="task">Task</option>
                <option value="message">Message</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Target</label>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={targetMode === "profile"}
                    onChange={() => setTargetMode("profile")}
                  />
                  Employee
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={targetMode === "store"}
                    onChange={() => setTargetMode("store")}
                  />
                  Store
                </label>
              </div>
            </div>
          </div>

          {targetMode === "profile" ? (
            <div className="space-y-2">
              <label className="text-sm muted">Employee</label>
              <select className="select" value={targetProfileId} onChange={e => setTargetProfileId(e.target.value)}>
                <option value="">Select employee</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.active ? "" : "(inactive)"}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm muted">Store</label>
              <select className="select" value={targetStoreId} onChange={e => setTargetStoreId(e.target.value)}>
                <option value="">Select store</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm muted">Message</label>
            <textarea
              className="textarea"
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>

          <button className="btn-primary px-4 py-2 disabled:opacity-50" disabled={!canCreate || saving} onClick={createAssignment}>
            Assign for next shift
          </button>
        </div>

        <div className="card card-pad space-y-4">
          <div className="text-lg font-medium">Filters</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm muted">Status</label>
              <select className="select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as "all" | "pending" | "completed")}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary px-4 py-2" onClick={() => loadAssignments(1)} disabled={saving}>
              Apply Filters
            </button>
            <button className="btn-secondary px-4 py-2" onClick={bulkDelete} disabled={saving || !assignments.length}>
              Bulk Delete (Filtered)
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {assignments.map(a => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              onSaveNote={saveAuditNote}
              onDelete={deleteAssignment}
              saving={saving}
            />
          ))}
          {!assignments.length && (
            <div className="card card-pad text-center text-sm muted">
              No assignments yet.
            </div>
          )}
        </div>

        {total > pageSize && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={p => loadAssignments(p)}
          />
        )}
      </div>
    </div>
  );
}

function AssignmentCard({
  assignment,
  onSaveNote,
  onDelete,
  saving,
}: {
  assignment: Assignment;
  onSaveNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const [note, setNote] = useState(assignment.audit_note || "");

  useEffect(() => {
    setNote(assignment.audit_note || "");
  }, [assignment.audit_note]);

  const status = assignment.type === "message"
    ? assignment.acknowledged_at ? "Acknowledged" : "Pending"
    : assignment.completed_at ? "Completed" : "Pending";

  return (
    <div className="card card-pad space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm muted">
          {assignment.type.toUpperCase()} - {status}
        </div>
        <div className="text-xs muted">
          Sent {formatWhen(assignment.created_at)}
        </div>
      </div>

      <div className="text-sm">
        {assignment.message}
      </div>

      <div className="text-xs muted">
        Assigned by: {assignment.created_by_name || assignment.created_by || "Unknown"}
      </div>

      <div className="text-xs muted">
        Target: {assignment.target_profile_name || assignment.target_profile_id || assignment.target_store_id || "Unknown"}
      </div>

      <div className="text-xs muted">
        Delivered shift: {assignment.delivered_shift_id ? assignment.delivered_shift_id.slice(0, 8) : "Pending"}
        {assignment.delivered_profile_name ? ` - ${assignment.delivered_profile_name}` : ""}
      </div>

      <div className="text-xs muted">
        {assignment.type === "message"
          ? `Acknowledged at: ${assignment.acknowledged_at ? formatWhen(assignment.acknowledged_at) : "Pending"}`
          : `Completed at: ${assignment.completed_at ? formatWhen(assignment.completed_at) : "Pending"}`
        }
      </div>

      <div className="space-y-2">
        <label className="text-sm muted">Audit note (admin only)</label>
        <textarea
          className="textarea"
          rows={2}
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <button
          className="btn-secondary px-3 py-1.5 disabled:opacity-50"
          onClick={() => onSaveNote(assignment.id, note)}
          disabled={saving}
        >
          Save Note
        </button>
        <button
          className="btn-secondary px-3 py-1.5 disabled:opacity-50"
          onClick={() => onDelete(assignment.id)}
          disabled={saving}
        >
          Delete
        </button>
        {assignment.audit_note_updated_at && (
          <div className="text-xs muted">
            Note updated {formatWhen(assignment.audit_note_updated_at)}
            {assignment.audit_note_by_name ? ` by ${assignment.audit_note_by_name}` : ""}
          </div>
        )}
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
