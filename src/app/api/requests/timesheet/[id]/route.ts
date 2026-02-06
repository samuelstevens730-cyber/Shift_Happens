import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type TimesheetRequestRow = {
  id: string;
  shift_id: string;
  store_id: string;
  requester_profile_id: string;
  requested_started_at: string | null;
  requested_ended_at: string | null;
  original_started_at: string;
  original_ended_at: string | null;
  reason: string;
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
    .from("timesheet_change_requests")
    .select(
      "id, shift_id, store_id, requester_profile_id, requested_started_at, requested_ended_at, original_started_at, original_ended_at, reason, status, reviewed_by, reviewed_at, denial_reason, created_at, updated_at"
    )
    .eq("id", id);

  if (auth.authType === "manager") {
    if (auth.storeIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    query = query.in("store_id", auth.storeIds);
  } else {
    query = query.eq("requester_profile_id", auth.profileId);
  }

  const { data, error } = await query
    .maybeSingle()
    .returns<TimesheetRequestRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    request: data,
    original: { startedAt: data.original_started_at, endedAt: data.original_ended_at },
    requested: { startedAt: data.requested_started_at, endedAt: data.requested_ended_at },
  });
}
