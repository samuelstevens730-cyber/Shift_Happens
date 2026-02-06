import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type DenyBody = {
  reason?: string | null;
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

  const body = (await req.json().catch(() => null)) as DenyBody | null;

  const { error } = await supabaseServer.rpc("deny_request", {
    p_actor_auth_user_id: user.id,
    p_request_type: "timesheet",
    p_request_id: requestId,
    p_denial_reason: body?.reason ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
