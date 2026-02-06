import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { submitTimeOffRequestSchema } from "@/schemas/requests";

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

type SubmitBody = {
  storeId?: string;
  startDate?: string;
  endDate?: string;
  reason?: string | null;
};

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;

  let query = supabaseServer
    .from("time_off_requests")
    .select(
      "id, store_id, profile_id, start_date, end_date, reason, status, reviewed_by, reviewed_at, denial_reason, created_at, updated_at"
    );

  if (auth.authType === "manager") {
    if (auth.storeIds.length === 0) return NextResponse.json({ rows: [] });
    query = query.in("store_id", auth.storeIds);
  } else {
    query = query.eq("profile_id", auth.profileId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .returns<TimeOffRequestRow[]>();

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
  const parsed = submitTimeOffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const payload = parsed.data;

  const { data, error } = await supabaseServer.rpc("submit_time_off_request", {
    p_actor_profile_id: auth.profileId,
    p_store_id: payload.storeId,
    p_start_date: payload.startDate,
    p_end_date: payload.endDate,
    p_reason: payload.reason ?? null,
  });

  if (error) {
    const msg = error.message || "Time off request failed";
    if (msg.toLowerCase().includes("conflict")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ requestId: data });
}
