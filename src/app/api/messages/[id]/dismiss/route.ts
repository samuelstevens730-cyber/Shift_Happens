import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const params = await props.params;
  const notificationId = params.id;
  const now = new Date().toISOString();

  // Service-role update is explicitly scoped to the authenticated recipient profile.
  const { data: notification, error: updateError } = await supabaseServer
    .from("notifications")
    .update({ read_at: now, dismissed_at: now })
    .eq("id", notificationId)
    .eq("recipient_profile_id", authResult.auth.profileId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("[POST /api/messages/[id]/dismiss]", updateError.message);
    return NextResponse.json({ error: "Dismiss failed" }, { status: 500 });
  }

  if (notification) {
    return NextResponse.json({ success: true });
  }

  // Transition fallback: older callers may still be holding legacy shift_assignment ids
  // until all read paths move fully to notifications.
  const { data: assignment, error: assignmentError } = await supabaseServer
    .from("shift_assignments")
    .update({ acknowledged_at: now })
    .eq("id", notificationId)
    .eq("type", "message")
    .eq("target_profile_id", authResult.auth.profileId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (assignmentError) {
    console.error("[POST /api/messages/[id]/dismiss]", assignmentError.message);
    return NextResponse.json({ error: "Dismiss failed" }, { status: 500 });
  }

  if (!assignment) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

