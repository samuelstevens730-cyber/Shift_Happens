import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { submitTimesheetChangeSchema } from "@/schemas/requests";

type TimesheetRequestRow = {
  id: string;
  shift_id: string;
  store_id: string;
  store: { id: string; name: string | null } | null;
  requester_profile_id: string;
  requester: { id: string; name: string | null } | null;
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

type SubmitBody = {
  shiftId?: string;
  requestedStartedAt?: string | null;
  requestedEndedAt?: string | null;
  reason?: string;
};

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;

  let query = supabaseServer
    .from("timesheet_change_requests")
    .select(
      "id, shift_id, store_id, store:store_id(id,name), requester_profile_id, requester:requester_profile_id(id,name), requested_started_at, requested_ended_at, original_started_at, original_ended_at, reason, status, reviewed_by, reviewed_at, denial_reason, created_at, updated_at"
    );

  if (auth.authType === "manager") {
    if (auth.storeIds.length === 0) return NextResponse.json({ rows: [] });
    query = query.in("store_id", auth.storeIds);
  } else {
    query = query.eq("requester_profile_id", auth.profileId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .returns<TimesheetRequestRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;
  const body = (await req.json().catch(() => null)) as SubmitBody | null;
  const parsed = submitTimesheetChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const payload = parsed.data;

  const { data, error } = await supabaseServer.rpc("submit_timesheet_change_request", {
    p_actor_profile_id: auth.profileId,
    p_shift_id: payload.shiftId,
    p_requested_started_at: payload.requestedStartedAt ?? null,
    p_requested_ended_at: payload.requestedEndedAt ?? null,
    p_reason: payload.reason,
  });

  if (error) {
    const msg = error.message || "Timesheet request failed";
    if (msg.toLowerCase().includes("locked")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ requestId: data });
}
