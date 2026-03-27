import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { createNotification } from "@/lib/notifications";

type TimesheetRequestRow = {
  id: string;
  store_id: string;
  requester_profile_id: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const requestId = id;
  if (!requestId) return NextResponse.json({ error: "Missing request id." }, { status: 400 });

  const { data: request, error: reqErr } = await supabaseServer
    .from("timesheet_change_requests")
    .select("id, store_id, requester_profile_id")
    .eq("id", requestId)
    .maybeSingle<TimesheetRequestRow>();

  if (reqErr || !request) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (!managerStoreIds.includes(request.store_id)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { error } = await supabaseServer.rpc("approve_timesheet_change_request", {
    p_actor_auth_user_id: user.id,
    p_request_id: requestId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const created = await createNotification({
    recipientProfileId: request.requester_profile_id,
    sourceStoreId: request.store_id,
    notificationType: "timesheet_approved",
    priority: "normal",
    title: "Timesheet correction approved",
    body: "Your timesheet correction request has been approved.",
    entityType: "timesheet_change_request",
    entityId: request.id,
    createdBy: user.id,
  });

  if (!created) {
    console.error("Failed to create timesheet approval notification.", { requestId });
  }

  return NextResponse.json({ ok: true });
}
