import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type TimeOffRequestRow = {
  id: string;
  store_id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  denial_reason: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;
  if (!id) return NextResponse.json({ error: "Missing request id." }, { status: 400 });

  let query = supabaseServer
    .from("time_off_requests")
    .select(
      "id, store_id, profile_id, start_date, end_date, reason, status, reviewed_by, reviewed_at, denial_reason, created_at, updated_at"
    )
    .eq("id", id);

  if (auth.authType === "manager") {
    if (auth.storeIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    query = query.in("store_id", auth.storeIds);
  } else {
    query = query.eq("profile_id", auth.profileId);
  }

  const { data, error } = await query
    .maybeSingle()
    .returns<TimeOffRequestRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ request: data });
}
