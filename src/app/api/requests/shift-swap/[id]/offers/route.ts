import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type OfferRow = {
  id: string;
  request_id: string;
  offerer_profile_id: string;
  offer_type: "cover" | "swap";
  swap_schedule_shift_id: string | null;
  is_selected: boolean;
  is_withdrawn: boolean;
  note: string | null;
  created_at: string;
};

type OfferBody = {
  offerType?: "cover" | "swap";
  swapScheduleShiftId?: string | null;
  note?: string | null;
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
  const requestId = id;
  if (!requestId) return NextResponse.json({ error: "Missing request id." }, { status: 400 });

  const { data: requestRow, error: requestErr } = await supabaseServer
    .from("shift_swap_requests")
    .select("id, requester_profile_id, store_id")
    .eq("id", requestId)
    .maybeSingle();

  if (requestErr) return NextResponse.json({ error: requestErr.message }, { status: 500 });
  if (!requestRow) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let query = supabaseServer
    .from("shift_swap_offers")
    .select(
      "id, request_id, offerer_profile_id, offer_type, swap_schedule_shift_id, is_selected, is_withdrawn, note, created_at"
    )
    .eq("request_id", requestId);

  if (auth.authType === "manager") {
    if (!auth.storeIds.includes(requestRow.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  } else if (requestRow.requester_profile_id !== auth.profileId) {
    query = query.eq("offerer_profile_id", auth.profileId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .returns<OfferRow[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const auth = authResult.auth;
  const requestId = id;
  if (!requestId) return NextResponse.json({ error: "Missing request id." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as OfferBody | null;
  if (!body?.offerType) {
    return NextResponse.json({ error: "Missing offerType." }, { status: 400 });
  }
  if (body.offerType !== "cover" && body.offerType !== "swap") {
    return NextResponse.json({ error: "Invalid offerType." }, { status: 400 });
  }
  if (body.offerType === "swap" && !body.swapScheduleShiftId) {
    return NextResponse.json({ error: "swapScheduleShiftId is required for swap offers." }, { status: 400 });
  }

  const { data, error } = await supabaseServer.rpc("submit_shift_swap_offer", {
    p_actor_profile_id: auth.profileId,
    p_request_id: requestId,
    p_offer_type: body.offerType,
    p_swap_schedule_shift_id: body.swapScheduleShiftId ?? null,
    p_note: body.note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ offerId: data });
}
