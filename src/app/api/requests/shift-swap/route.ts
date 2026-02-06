import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { submitSwapRequestSchema } from "@/schemas/requests";

type ShiftSwapRequestRow = {
  id: string;
  schedule_shift_id: string;
  store_id: string;
  requester_profile_id: string;
  requester: { id: string; name: string | null } | null;
  schedule_shift: {
    id: string;
    shift_date: string;
    scheduled_start: string;
    scheduled_end: string;
    shift_type: string;
    store_id: string;
    stores?: { name: string } | null;
  } | null;
  reason: string | null;
  status: string;
  selected_offer_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  denial_reason: string | null;
  expires_at: string;
  nudge_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type SubmitBody = {
  scheduleShiftId?: string;
  reason?: string | null;
  expiresHours?: number | null;
};

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;

  let query = supabaseServer
    .from("shift_swap_requests")
    .select(
      "id, schedule_shift_id, store_id, requester_profile_id, requester:requester_profile_id(id,name), schedule_shift:schedule_shift_id(id,shift_date,scheduled_start,scheduled_end,shift_type,store_id,stores(name)), reason, status, selected_offer_id, approved_by, approved_at, denial_reason, expires_at, nudge_sent_at, created_at, updated_at"
    );

  if (auth.authType === "manager") {
    if (auth.storeIds.length === 0) return NextResponse.json({ rows: [] });
    query = query.in("store_id", auth.storeIds);
  } else {
    query = query.eq("requester_profile_id", auth.profileId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .returns<ShiftSwapRequestRow[]>();
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
  const parsed = submitSwapRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const payload = parsed.data;

  const { data, error } = await supabaseServer.rpc("submit_shift_swap_request", {
    p_actor_profile_id: auth.profileId,
    p_schedule_shift_id: payload.scheduleShiftId,
    p_reason: payload.reason ?? null,
    p_expires_hours: payload.expiresHours ?? undefined,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ requestId: data });
}
