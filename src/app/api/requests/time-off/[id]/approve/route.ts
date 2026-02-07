import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

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
    .from("time_off_requests")
    .select("store_id")
    .eq("id", requestId)
    .maybeSingle<{ store_id: string }>();

  if (reqErr || !request) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (!managerStoreIds.includes(request.store_id)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data, error } = await supabaseServer.rpc("approve_time_off_request", {
    p_actor_auth_user_id: user.id,
    p_request_id: requestId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ blockId: data });
}
