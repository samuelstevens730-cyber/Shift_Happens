import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type AssignmentRow = {
  id: string;
  type: "task" | "message";
  target_profile_id: string | null;
  acknowledged_at: string | null;
  deleted_at: string | null;
};

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const params = await props.params;
  const assignmentId = params.id;
  const auth = authResult.auth;

  const { data: assignment, error: lookupError } = await supabaseServer
    .from("shift_assignments")
    .select("id, type, target_profile_id, acknowledged_at, deleted_at")
    .eq("id", assignmentId)
    .maybeSingle<AssignmentRow>();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!assignment || assignment.deleted_at) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }
  if (assignment.type !== "message") {
    return NextResponse.json({ error: "Not a message." }, { status: 400 });
  }
  if (assignment.target_profile_id !== auth.profileId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (assignment.acknowledged_at) {
    return NextResponse.json({ ok: true });
  }

  const { error: updateError } = await supabaseServer
    .from("shift_assignments")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .is("deleted_at", null);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

