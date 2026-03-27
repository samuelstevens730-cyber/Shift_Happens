import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest, validateStoreAccess } from "@/lib/shiftAuth";
import { createNotification, createStoreNotification } from "@/lib/notifications";
import { submitSwapOfferSchema } from "@/schemas/requests";

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

type SwapRequestRow = {
  id: string;
  requester_profile_id: string;
  store_id: string;
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

  let body: OfferBody;
  try {
    body = (await req.json()) as OfferBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = submitSwapOfferSchema.safeParse({
    requestId,
    offerType: body.offerType,
    swapScheduleShiftId: body.swapScheduleShiftId ?? null,
    note: body.note ?? null,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }
  const payload = parsed.data;

  const { data: requestRow, error: requestErr } = await supabaseServer
    .from("shift_swap_requests")
    .select("id, requester_profile_id, store_id")
    .eq("id", requestId)
    .maybeSingle<SwapRequestRow>();

  if (requestErr) return NextResponse.json({ error: requestErr.message }, { status: 500 });
  if (!requestRow) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!validateStoreAccess(auth, requestRow.store_id)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data, error } = await supabaseServer.rpc("submit_shift_swap_offer", {
    p_actor_profile_id: auth.profileId,
    p_request_id: payload.requestId,
    p_offer_type: payload.offerType,
    p_swap_schedule_shift_id: payload.swapScheduleShiftId ?? null,
    p_note: payload.note ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const requesterCreated = await createNotification({
    recipientProfileId: requestRow.requester_profile_id,
    sourceStoreId: requestRow.store_id,
    notificationType: "swap_offer_received",
    priority: "normal",
    title: "Someone offered to take your shift",
    body: "An employee has offered to take your shift. Check the swap request for details.",
    entityType: "shift_swap_request",
    entityId: requestId,
  });

  const managersCreated = await createStoreNotification({
    storeId: requestRow.store_id,
    notificationType: "swap_pending_approval",
    priority: "high",
    title: "Shift swap needs approval",
    body: "A shift swap request is pending your approval.",
    entityType: "shift_swap_request",
    entityId: requestId,
  });

  if (!requesterCreated || !managersCreated) {
    console.error("Failed to create swap offer notifications.", {
      requestId,
      requesterCreated,
      managersCreated,
    });
  }

  return NextResponse.json({ offerId: data });
}
