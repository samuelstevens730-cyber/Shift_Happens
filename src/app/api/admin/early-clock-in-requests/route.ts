import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const {
    data: { user },
    error: authErr,
  } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data, error } = await supabaseServer
    .from("early_clock_in_requests")
    .select(`
      id,
      store_id,
      profile_id,
      schedule_shift_id,
      shift_date,
      requested_planned_start_at,
      scheduled_start_at,
      requested_shift_type,
      status,
      manager_planned_start_at,
      manager_started_at,
      denial_reason,
      reviewed_at,
      created_at,
      stores!store_id ( name ),
      profiles!profile_id ( name )
    `)
    .in("store_id", managerStoreIds)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
