import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type TimeOffBlockRow = {
  id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
  request_id: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;

  let query = supabaseServer
    .from("time_off_blocks")
    .select(
      "id, profile_id, start_date, end_date, request_id, created_by, created_at, deleted_at, deleted_by"
    )
    .is("deleted_at", null);

  if (auth.authType === "manager") {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ rows: [] });

    const { data: memberships, error: memErr } = await supabaseServer
      .from("store_memberships")
      .select("profile_id")
      .in("store_id", managerStoreIds);

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    const profileIds = Array.from(new Set((memberships ?? []).map(m => m.profile_id)));
    if (profileIds.length === 0) return NextResponse.json({ rows: [] });

    query = query.in("profile_id", profileIds);
  } else {
    query = query.eq("profile_id", auth.profileId);
  }

  const { data, error } = await query
    .order("start_date", { ascending: true })
    .returns<TimeOffBlockRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}
