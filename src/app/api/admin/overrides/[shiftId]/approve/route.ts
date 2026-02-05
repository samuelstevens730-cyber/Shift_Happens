/**
 * POST /api/admin/overrides/[shiftId]/approve - Approve a Long Shift Override
 *
 * Approves a shift that was flagged as requiring manager override (typically
 * because it exceeded the 13-hour maximum duration). Requires an approval note
 * explaining why the long shift is being accepted.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * URL params:
 *   - shiftId: UUID of the shift to approve
 *
 * Request body:
 *   - note: Approval note explaining the override (required, non-empty string)
 *
 * Returns: { ok: true } on success
 *
 * Error responses:
 *   - 400: Missing shiftId, missing/empty note, override not required, or already approved
 *   - 401: Unauthorized (invalid/missing token)
 *   - 403: User is not a manager of the shift's store
 *   - 404: Shift not found
 *   - 500: Database error
 *
 * Business logic:
 *   - Only managers of the shift's store can approve
 *   - Shift must have requires_override = true
 *   - Shift must not already be approved (override_at must be null)
 *   - Sets override_at to current timestamp
 *   - Sets override_by to the authenticated user's ID
 *   - Stores the approval note in override_note
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type Body = { note?: string };

type ShiftRow = {
  id: string;
  store_id: string;
  requires_override: boolean | null;
  override_at: string | null;
};

export async function POST(
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

    const body = (await req.json()) as Body;
    const note = (body.note || "").trim();
    if (!note) return NextResponse.json({ error: "Approval note is required." }, { status: 400 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, requires_override, override_at")
      .eq("id", shiftId)
      .maybeSingle()
      .returns<ShiftRow>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (!shift.requires_override) return NextResponse.json({ error: "Override not required." }, { status: 400 });
    if (shift.override_at) return NextResponse.json({ error: "Already approved." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.includes(shift.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        override_at: new Date().toISOString(),
        override_by: user.id,
        override_note: note,
      })
      .eq("id", shiftId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to approve override." }, { status: 500 });
  }
}
