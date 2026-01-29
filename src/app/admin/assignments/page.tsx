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
  | { stores: Store[]; users: User[]; assignments: Assignment[] }
  | { error: string };

type SimpleResponse = { ok: true } | { error: string };

export default function AssignmentsAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [type, setType] = useState<"task" | "message">("task");
  const [targetMode, setTargetMode] = useState<"profile" | "store">("profile");
  const [targetProfileId, setTargetProfileId] = useState("");
  const [targetStoreId, setTargetStoreId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

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

  const loadAssignments = async () => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    if (!token) {
      router.replace("/login?next=/admin/assignments");
      return;
    }

    const res = await fetch("/api/admin/assignments", {
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
  };

  useEffect(() => {
    if (!isAuthed) return;
    void loadAssignments();
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
      await loadAssignments();
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
      await loadAssignments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save note.");
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

        <div className="space-y-3">
          {assignments.map(a => (
            <AssignmentCard key={a.id} assignment={a} onSaveNote={saveAuditNote} saving={saving} />
          ))}
          {!assignments.length && (
            <div className="card card-pad text-center text-sm muted">
              No assignments yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignmentCard({
  assignment,
  onSaveNote,
  saving,
}: {
  assignment: Assignment;
  onSaveNote: (id: string, note: string) => void;
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
          Sent {new Date(assignment.created_at).toLocaleString()}
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
          ? `Acknowledged at: ${assignment.acknowledged_at ? new Date(assignment.acknowledged_at).toLocaleString() : "Pending"}`
          : `Completed at: ${assignment.completed_at ? new Date(assignment.completed_at).toLocaleString() : "Pending"}`
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
        {assignment.audit_note_updated_at && (
          <div className="text-xs muted">
            Note updated {new Date(assignment.audit_note_updated_at).toLocaleString()}
            {assignment.audit_note_by_name ? ` by ${assignment.audit_note_by_name}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
