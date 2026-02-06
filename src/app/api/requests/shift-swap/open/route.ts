import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;

  let query = supabaseServer
    .from("shift_swap_requests")
    .select(
      "id, schedule_shift_id, store_id, requester_profile_id, requester:requester_profile_id(id,name), schedule_shift:schedule_shift_id(id,shift_date,scheduled_start,scheduled_end,shift_type,store_id,stores(name)), reason, status, expires_at, created_at"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (auth.authType === "manager") {
    if (auth.storeIds.length === 0) return NextResponse.json({ rows: [] });
    query = query.in("store_id", auth.storeIds);
  } else {
    query = query.neq("requester_profile_id", auth.profileId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}
