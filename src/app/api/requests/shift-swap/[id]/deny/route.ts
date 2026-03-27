import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { createNotification } from "@/lib/notifications";

type DenyBody = {
  reason?: string | null;
};

type SwapRequestRow = {
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
    .from("shift_swap_requests")
    .select("store_id, requester_profile_id")
    .eq("id", requestId)
    .maybeSingle<SwapRequestRow>();

  if (reqErr || !request) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (!managerStoreIds.includes(request.store_id)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: DenyBody;
  try {
    body = (await req.json()) as DenyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const denialReason = typeof body.reason === "string" ? body.reason.trim() : "";

  const { error } = await supabaseServer.rpc("deny_request", {
    p_actor_auth_user_id: user.id,
    p_request_type: "shift_swap",
    p_request_id: requestId,
    p_denial_reason: denialReason || null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const created = await createNotification({
    recipientProfileId: request.requester_profile_id,
    sourceStoreId: request.store_id,
    notificationType: "swap_denied",
    priority: "high",
    title: "Shift swap denied",
    body: denialReason
      ? `Your shift swap request was denied: ${denialReason}`
      : "Your shift swap request was denied by a manager.",
    entityType: "shift_swap_request",
    entityId: requestId,
    createdBy: user.id,
  });

  if (!created) {
    console.error("Failed to create swap denial notification.", { requestId });
  }

  return NextResponse.json({ ok: true });
}
