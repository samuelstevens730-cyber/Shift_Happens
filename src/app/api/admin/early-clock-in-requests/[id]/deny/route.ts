import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { createNotification } from "@/lib/notifications";
import { denyEarlyClockInRequestSchema } from "@/schemas/requests";

type EarlyClockInRequestRow = {
  id: string;
  store_id: string;
  profile_id: string;
  status: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const {
    data: { user },
    error: authErr,
  } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = denyEarlyClockInRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const { data: requestRow, error: fetchErr } = await supabaseServer
    .from("early_clock_in_requests")
    .select("id, store_id, profile_id, status")
    .eq("id", id)
    .maybeSingle<EarlyClockInRequestRow>();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!requestRow) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!managerStoreIds.includes(requestRow.store_id)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (requestRow.status !== "pending") {
    return NextResponse.json({ error: "Request already resolved." }, { status: 409 });
  }

  const denialReason = parsed.data.denialReason?.trim() || null;
  const { error: updateErr } = await supabaseServer
    .from("early_clock_in_requests")
    .update({
      status: "denied",
      denial_reason: denialReason,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const created = await createNotification({
    recipientProfileId: requestRow.profile_id,
    sourceStoreId: requestRow.store_id,
    notificationType: "early_clock_in_denied",
    priority: "high",
    title: "Early clock-in request denied",
    body: denialReason
      ? `Your early clock-in request was denied: ${denialReason}`
      : "Your early clock-in request was denied.",
    entityType: "early_clock_in_request",
    entityId: requestRow.id,
    createdBy: user.id,
  });

  if (!created) {
    console.error("Failed to create early clock-in denial notification.", { requestId: requestRow.id });
  }

  return NextResponse.json({ ok: true });
}
