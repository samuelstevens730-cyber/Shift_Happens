// src/app/api/requests/coverage-shift/[id]/deny/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

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
    .select("id, status, coverage_store_id")
    .eq("id", id)
    .maybeSingle();

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

  // Parse denial reason — explicit 400 on malformed JSON
  let denialReason: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    denialReason = typeof (body as Record<string, unknown>).denialReason === "string"
      ? ((body as Record<string, unknown>).denialReason as string).trim() || null
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

  return NextResponse.json({ ok: true });
}
