/**
 * PATCH/DELETE /api/admin/assignments/[assignmentId] - Update or Delete an Assignment
 *
 * PATCH: Update the audit note on an assignment.
 *   Allows managers to add/update notes for tracking or auditing purposes.
 *
 * DELETE: Soft-delete an assignment.
 *   Sets deleted_at timestamp instead of hard-deleting. Idempotent.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * URL params:
 *   - assignmentId: UUID of the assignment to update/delete
 *
 * Request body (PATCH):
 *   - auditNote: Note text to attach (optional, can be empty to clear)
 *
 * Returns: { ok: true } on success
 *
 * Error responses:
 *   - 400: Missing assignmentId, or assignment already deleted (for PATCH)
 *   - 401: Unauthorized (invalid/missing token)
 *   - 403: User doesn't manage the assignment's target store/profile
 *   - 404: Assignment not found
 *   - 500: Database error
 *
 * Business logic:
 *   - For store-targeted assignments: user must manage that store
 *   - For profile-targeted assignments: user must manage at least one store
 *     the employee belongs to
 *   - PATCH updates audit_note, audit_note_updated_at, and audit_note_by
 *   - DELETE sets deleted_at and deleted_by, returns success if already deleted
 *   - Only updates assignments where deleted_at IS NULL
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

async function canAccessProfile(managerStoreIds: string[], profileId: string) {
  const { data: mem, error: memErr } = await supabaseServer
    .from("store_memberships")
    .select("store_id")
    .eq("profile_id", profileId)
    .in("store_id", managerStoreIds)
    .limit(1)
    .maybeSingle()
    .returns<{ store_id: string }>();

  if (memErr) {
    return { ok: false as const, error: memErr.message, status: 500 };
  }

  if (!mem) {
    return { ok: false as const, error: "Forbidden.", status: 403 };
  }

  return { ok: true as const };
}

async function canAccessNotification(
  managerStoreIds: string[],
  recipientProfileId: string,
  sourceStoreId: string | null
) {
  if (sourceStoreId) {
    if (!managerStoreIds.includes(sourceStoreId)) {
      return { ok: false as const, error: "Forbidden.", status: 403 };
    }

    return { ok: true as const };
  }

  return canAccessProfile(managerStoreIds, recipientProfileId);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { assignmentId } = await params;
    if (!assignmentId) return NextResponse.json({ error: "Missing assignmentId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: notification, error: notificationErr } = await supabaseServer
      .from("notifications")
      .select("id, recipient_profile_id, source_store_id, deleted_at")
      .eq("id", assignmentId)
      .eq("notification_type", "manager_message")
      .maybeSingle()
      .returns<{ id: string; recipient_profile_id: string; source_store_id: string | null; deleted_at: string | null }>();
    if (notificationErr) return NextResponse.json({ error: notificationErr.message }, { status: 500 });
    if (notification) {
      if (notification.deleted_at) return NextResponse.json({ error: "Assignment deleted." }, { status: 400 });

      const access = await canAccessNotification(
        managerStoreIds,
        notification.recipient_profile_id,
        notification.source_store_id
      );
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
      return NextResponse.json({ error: "Audit notes are not supported for notifications." }, { status: 400 });
    }

    const { data: assignment, error: assignErr } = await supabaseServer
      .from("shift_assignments")
      .select("id, target_store_id, target_profile_id, deleted_at")
      .eq("id", assignmentId)
      .maybeSingle()
      .returns<{ id: string; target_store_id: string | null; target_profile_id: string | null; deleted_at: string | null }>();
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });
    if (!assignment) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (assignment.deleted_at) return NextResponse.json({ error: "Assignment deleted." }, { status: 400 });

    if (assignment.target_store_id && !managerStoreIds.includes(assignment.target_store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (assignment.target_profile_id) {
      const access = await canAccessProfile(managerStoreIds, assignment.target_profile_id);
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    }

    let body: { auditNote?: string };
    try {
      body = (await req.json()) as { auditNote?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const note = typeof body.auditNote === "string" ? body.auditNote.trim() : "";

    const { error: updateErr } = await supabaseServer
      .from("shift_assignments")
      .update({
        audit_note: note || null,
        audit_note_updated_at: new Date().toISOString(),
        audit_note_by: user.id,
      })
      .eq("id", assignmentId)
      .is("deleted_at", null);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update audit note." }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { assignmentId } = await params;
    if (!assignmentId) return NextResponse.json({ error: "Missing assignmentId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: notification, error: notificationErr } = await supabaseServer
      .from("notifications")
      .select("id, recipient_profile_id, source_store_id, deleted_at")
      .eq("id", assignmentId)
      .eq("notification_type", "manager_message")
      .maybeSingle()
      .returns<{ id: string; recipient_profile_id: string; source_store_id: string | null; deleted_at: string | null }>();
    if (notificationErr) return NextResponse.json({ error: notificationErr.message }, { status: 500 });
    if (notification) {
      const access = await canAccessNotification(
        managerStoreIds,
        notification.recipient_profile_id,
        notification.source_store_id
      );
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

      const deletedAt = new Date().toISOString();

      if (!notification.deleted_at) {
        const { error: notificationDeleteErr } = await supabaseServer
          .from("notifications")
          .update({
            deleted_at: deletedAt,
            deleted_by: user.id,
          })
          .eq("id", assignmentId)
          .is("deleted_at", null);
        if (notificationDeleteErr) {
          return NextResponse.json({ error: notificationDeleteErr.message }, { status: 500 });
        }
      }

      const { error: legacyDeleteErr } = await supabaseServer
        .from("shift_assignments")
        .update({
          deleted_at: deletedAt,
          deleted_by: user.id,
        })
        .eq("id", assignmentId)
        .eq("type", "message")
        .not("target_profile_id", "is", null)
        .is("deleted_at", null);
      if (legacyDeleteErr) {
        return NextResponse.json({ error: legacyDeleteErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    const { data: assignment, error: assignErr } = await supabaseServer
      .from("shift_assignments")
      .select("id, target_store_id, target_profile_id, deleted_at")
      .eq("id", assignmentId)
      .maybeSingle()
      .returns<{ id: string; target_store_id: string | null; target_profile_id: string | null; deleted_at: string | null }>();
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });
    if (!assignment) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (assignment.deleted_at) return NextResponse.json({ ok: true });

    if (assignment.target_store_id && !managerStoreIds.includes(assignment.target_store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (assignment.target_profile_id) {
      const access = await canAccessProfile(managerStoreIds, assignment.target_profile_id);
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { error: delErr } = await supabaseServer
      .from("shift_assignments")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq("id", assignmentId)
      .is("deleted_at", null);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete assignment." }, { status: 500 });
  }
}
