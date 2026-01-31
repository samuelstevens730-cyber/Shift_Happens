/**
 * PATCH/DELETE /api/admin/shifts/[shiftId] - Update or Soft-Delete a Specific Shift
 *
 * PATCH: Update shift details (times, type).
 *   Allows modifying shift_type, planned_start_at, started_at, and ended_at.
 *   At least one field must be provided. Updates are tracked via last_action.
 *
 * DELETE: Soft-delete a shift.
 *   Sets last_action to "removed" instead of hard-deleting the record.
 *   Idempotent - returns success if shift already removed.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * URL params:
 *   - shiftId: UUID of the shift to update/delete
 *
 * Request body (PATCH):
 *   - shiftType: New shift type (optional)
 *   - plannedStartAt: New planned start time ISO string (optional)
 *   - startedAt: New actual start time ISO string (optional)
 *   - endedAt: New end time ISO string or null (optional)
 *
 * Returns: { ok: true } on success
 *
 * Error responses:
 *   - 400: Missing shiftId, no fields to update, or shift already removed
 *   - 401: Unauthorized (invalid/missing token)
 *   - 403: User is not a manager of the shift's store
 *   - 404: Shift not found
 *   - 500: Database error
 *
 * Business logic:
 *   - Only managers of the shift's store can update/delete
 *   - Cannot update shifts that have been soft-deleted (last_action = "removed")
 *   - Updates set last_action = "edited" with last_action_by = user ID
 *   - Deletes set last_action = "removed" with last_action_by = user ID
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ShiftType } from "@/lib/kioskRules";

type ShiftRow = {
  id: string;
  store_id: string;
  profile_id: string;
  shift_type: ShiftType;
  last_action: string | null;
  manual_closed: boolean | null;
  manual_closed_reviewed_at: string | null;
};

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
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { shiftId } = await params;
    if (!shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, shift_type, last_action, manual_closed, manual_closed_reviewed_at")
      .eq("id", shiftId)
      .maybeSingle()
      .returns<ShiftRow>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.last_action === "removed") return NextResponse.json({ error: "Shift removed." }, { status: 400 });
    if (!managerStoreIds.includes(shift.store_id)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const body = (await req.json()) as {
      shiftType?: ShiftType;
      plannedStartAt?: string;
      startedAt?: string;
      endedAt?: string | null;
      manualCloseReview?: "approved" | "edited";
    };

    const update: Record<string, string | null> = {};
    if (body.shiftType) update.shift_type = body.shiftType;
    if (body.plannedStartAt) update.planned_start_at = body.plannedStartAt;
    if (body.startedAt) update.started_at = body.startedAt;
    if (body.endedAt !== undefined) update.ended_at = body.endedAt;

    // If admin is ending a shift, auto-create any missing required drawer counts
    if (body.endedAt) {
      const effectiveType = body.shiftType ?? shift.shift_type;
      if (effectiveType !== "other") {
        const { data: storeRow, error: storeErr } = await supabaseServer
          .from("stores")
          .select("expected_drawer_cents")
          .eq("id", shift.store_id)
          .maybeSingle()
          .returns<{ expected_drawer_cents: number }>();
        if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
        const expected = storeRow?.expected_drawer_cents ?? 20000;

        const requiredTypes: Array<"start" | "end" | "changeover"> = ["start", "end"];
        if (effectiveType === "double") requiredTypes.push("changeover");

        const { data: existingCounts, error: countErr } = await supabaseServer
          .from("shift_drawer_counts")
          .select("count_type")
          .eq("shift_id", shiftId)
          .in("count_type", requiredTypes);
        if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

        const existingSet = new Set((existingCounts ?? []).map(r => r.count_type));
        const missing = requiredTypes.filter(t => !existingSet.has(t));
        if (missing.length) {
          const nowIso = new Date().toISOString();
          const rows = missing.map(t => ({
            shift_id: shiftId,
            count_type: t,
            drawer_cents: expected,
            change_count: null,
            confirmed: false,
            notified_manager: false,
            note: "Admin edit (missing count).",
            counted_at: nowIso,
            out_of_threshold: false,
            count_missing: true,
          }));
          const { error: insertErr } = await supabaseServer
            .from("shift_drawer_counts")
            .insert(rows);
          if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
        }
      }
    }

    if (Object.keys(update).length === 0 && !body.manualCloseReview) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    update.last_action = "edited";
    update.last_action_by = user.id;

    if (body.manualCloseReview) {
      update.manual_closed_review_status = body.manualCloseReview;
      update.manual_closed_reviewed_at = new Date().toISOString();
      update.manual_closed_reviewed_by = user.id;
    } else if (shift.manual_closed && !shift.manual_closed_reviewed_at) {
      update.manual_closed_review_status = "edited";
      update.manual_closed_reviewed_at = new Date().toISOString();
      update.manual_closed_reviewed_by = user.id;
    }

    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update(update)
      .eq("id", shiftId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update shift." }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { shiftId } = await params;
    if (!shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, last_action, manual_closed")
      .eq("id", shiftId)
      .maybeSingle()
      .returns<{ id: string; store_id: string; last_action: string | null; manual_closed: boolean | null }>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.last_action === "removed") return NextResponse.json({ ok: true });
    if (!managerStoreIds.includes(shift.store_id)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        last_action: "removed",
        last_action_by: user.id,
        manual_closed_review_status: shift.manual_closed ? "removed" : null,
        manual_closed_reviewed_at: shift.manual_closed ? new Date().toISOString() : null,
        manual_closed_reviewed_by: shift.manual_closed ? user.id : null,
      })
      .eq("id", shiftId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to remove shift." }, { status: 500 });
  }
}
