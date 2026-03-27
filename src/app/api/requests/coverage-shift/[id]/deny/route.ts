// src/app/api/requests/coverage-shift/[id]/deny/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { createNotification } from "@/lib/notifications";

type CoverageRequestRow = {
  id: string;
  status: string;
  coverage_store_id: string;
  profile_id: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: request, error: fetchErr } = await supabaseServer
    .from("coverage_shift_requests")
    .select("id, status, coverage_store_id, profile_id")
    .eq("id", id)
    .maybeSingle<CoverageRequestRow>();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Enforce store isolation: manager must manage the coverage store
  if (!managerStoreIds.includes(request.coverage_store_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
  }

  let denialReason: string | null = null;
  const rawBody = await req.text();
  if (rawBody.trim()) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    denialReason = typeof body.denialReason === "string"
      ? body.denialReason.trim() || null
      : null;
  }

  const { error: updateErr } = await supabaseServer
    .from("coverage_shift_requests")
    .update({
      status:        "denied",
      reviewed_by:   user.id,
      reviewed_at:   new Date().toISOString(),
      denial_reason: denialReason,
      updated_at:    new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) {
    console.error("Coverage shift deny error:", updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const created = await createNotification({
    recipientProfileId: request.profile_id,
    sourceStoreId: request.coverage_store_id,
    notificationType: "coverage_denied",
    priority: "high",
    title: "Coverage request denied",
    body: denialReason
      ? `Your coverage request was denied: ${denialReason}`
      : "Your coverage request was denied.",
    entityType: "coverage_shift_request",
    entityId: request.id,
    createdBy: user.id,
  });

  if (!created) {
    console.error("Failed to create coverage denial notification.", { requestId: request.id });
  }

  return NextResponse.json({ ok: true });
}
