import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { createNotifications } from "@/lib/notifications";

type SwapRequestRow = {
  store_id: string;
  requester_profile_id: string;
  selected_offer_id: string | null;
};

type SelectedOfferRow = {
  request_id: string;
  offerer_profile_id: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const requestId = id;
  if (!requestId) return NextResponse.json({ error: "Missing request id." }, { status: 400 });

  const { data: request, error: reqErr } = await supabaseServer
    .from("shift_swap_requests")
    .select("store_id, requester_profile_id, selected_offer_id")
    .eq("id", requestId)
    .maybeSingle<SwapRequestRow>();

  if (reqErr || !request) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (!managerStoreIds.includes(request.store_id)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let offererProfileId: string | null = null;
  if (request.selected_offer_id) {
    const { data: selectedOffer, error: offerErr } = await supabaseServer
      .from("shift_swap_offers")
      .select("request_id, offerer_profile_id")
      .eq("id", request.selected_offer_id)
      .eq("request_id", requestId)
      .maybeSingle<SelectedOfferRow>();

    if (offerErr || !selectedOffer) {
      return NextResponse.json({ error: "Offer not found." }, { status: 404 });
    }

    offererProfileId = selectedOffer.offerer_profile_id;
  }

  const { error } = await supabaseServer.rpc("approve_shift_swap_or_cover", {
    p_actor_auth_user_id: user.id,
    p_request_id: requestId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const notifications = [
    {
      recipientProfileId: request.requester_profile_id,
      sourceStoreId: request.store_id,
      notificationType: "swap_approved" as const,
      priority: "high" as const,
      title: "Shift swap approved",
      body: "Your shift swap request has been approved by a manager.",
      entityType: "shift_swap_request" as const,
      entityId: requestId,
      createdBy: user.id,
    },
    ...(offererProfileId
      ? [
          {
            recipientProfileId: offererProfileId,
            sourceStoreId: request.store_id,
            notificationType: "swap_approved" as const,
            priority: "high" as const,
            title: "Shift swap approved",
            body: "The swap you offered to cover has been approved. Check your schedule.",
            entityType: "shift_swap_request" as const,
            entityId: requestId,
            createdBy: user.id,
          },
        ]
      : []),
  ];

  const created = await createNotifications(notifications);
  if (!created) {
    console.error("Failed to create swap approval notifications.", { requestId });
  }

  return NextResponse.json({ ok: true });
}
