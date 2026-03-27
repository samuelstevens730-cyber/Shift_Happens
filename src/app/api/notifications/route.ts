import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import type { BellTaskItem } from "@/types/notifications";

type NotificationRecord = {
  id: string;
  notification_type: string;
  priority: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
};

type TaskRecord = {
  id: string;
  message: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const profileId = authResult.auth.profileId;

  const { data: notifications, error: notifError } = await supabaseServer
    .from("notifications")
    .select(
      "id, notification_type, priority, title, body, entity_type, entity_id, read_at, dismissed_at, created_at"
    )
    .eq("recipient_profile_id", profileId)
    .is("dismissed_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<NotificationRecord[]>();

  if (notifError) {
    console.error("[GET /api/notifications]", notifError.message);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }

  // Service-role query is explicitly scoped to the authenticated recipient profile.
  const { data: tasks, error: taskError } = await supabaseServer
    .from("shift_assignments")
    .select("id, message, created_at, completed_at")
    .eq("type", "task")
    .eq("target_profile_id", profileId)
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<TaskRecord[]>();

  if (taskError) {
    console.error("[GET /api/notifications]", taskError.message);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }

  const bellTasks: BellTaskItem[] = (tasks ?? []).map((task) => ({
    id: task.id,
    title: "Shift Task",
    body: task.message ?? "",
    created_at: task.created_at,
    completed_at: task.completed_at,
    is_task: true,
  }));

  return NextResponse.json({
    notifications: notifications ?? [],
    tasks: bellTasks,
  });
}

export async function PATCH(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const now = new Date().toISOString();

  // Service-role update is explicitly scoped to the authenticated recipient profile.
  const { error } = await supabaseServer
    .from("notifications")
    .update({ read_at: now })
    .eq("recipient_profile_id", authResult.auth.profileId)
    .is("read_at", null)
    .is("deleted_at", null);

  if (error) {
    console.error("[PATCH /api/notifications]", error.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
