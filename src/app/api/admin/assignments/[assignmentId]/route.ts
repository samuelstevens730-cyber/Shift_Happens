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

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

async function getManagerStoreIds(userId: string) {
  const { data, error } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", userId)
    .returns<{ store_id: string }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.store_id);
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
      const { data: mem, error: memErr } = await supabaseServer
        .from("store_memberships")
        .select("store_id")
        .eq("profile_id", assignment.target_profile_id)
        .in("store_id", managerStoreIds)
        .limit(1)
        .maybeSingle()
        .returns<{ store_id: string }>();
      if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
      if (!mem) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await req.json()) as { auditNote?: string };
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
      const { data: mem, error: memErr } = await supabaseServer
        .from("store_memberships")
        .select("store_id")
        .eq("profile_id", assignment.target_profile_id)
        .in("store_id", managerStoreIds)
        .limit(1)
        .maybeSingle()
        .returns<{ store_id: string }>();
      if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
      if (!mem) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
