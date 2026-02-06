import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type SelectBody = {
  offerId?: string;
};

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

  const body = (await req.json().catch(() => null)) as SelectBody | null;
  if (!body?.offerId) return NextResponse.json({ error: "Missing offerId." }, { status: 400 });

  const { error } = await supabaseServer.rpc("select_shift_swap_offer", {
    p_actor_profile_id: auth.profileId,
    p_request_id: requestId,
    p_offer_id: body.offerId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
