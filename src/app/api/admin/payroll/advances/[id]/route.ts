import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

async function requireManager(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  const storeIds = await getManagerStoreIds(user.id);
  if (!storeIds.length) {
    return { ok: false as const, response: NextResponse.json({ error: "No managed stores." }, { status: 403 }) };
  }
  return { ok: true as const, user, storeIds };
}

async function validateAccess(advanceId: string, storeIds: string[]) {
  const { data, error } = await supabaseServer
    .from("payroll_advances")
    .select("id, store_id")
    .eq("id", advanceId)
    .maybeSingle();
  if (error) return { ok: false as const, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return { ok: false as const, response: NextResponse.json({ error: "Advance not found." }, { status: 404 }) };
  if (!data.store_id || !storeIds.includes(data.store_id)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const manager = await requireManager(req);
    if (!manager.ok) return manager.response;
    const { id } = await params;

    const access = await validateAccess(id, manager.storeIds);
    if (!access.ok) return access.response;

    const body = await req.json();
    const patch: Record<string, unknown> = {};

    if (body.advanceDate) patch.advance_date = String(body.advanceDate);
    if (body.advanceHours != null) {
      const hours = Number(body.advanceHours);
      if (!Number.isFinite(hours) || hours <= 0) return NextResponse.json({ error: "advanceHours must be > 0." }, { status: 400 });
      patch.advance_hours = hours;
    }
    if (body.cashAmountDollars !== undefined) {
      if (body.cashAmountDollars === "" || body.cashAmountDollars == null) {
        patch.cash_amount_cents = null;
      } else {
        const dollars = Number(body.cashAmountDollars);
        if (!Number.isFinite(dollars) || dollars < 0) return NextResponse.json({ error: "cashAmountDollars must be >= 0." }, { status: 400 });
        patch.cash_amount_cents = Math.round(dollars * 100);
      }
    }
    if (body.note !== undefined) patch.note = body.note ? String(body.note) : null;
    if (body.status) {
      const status = String(body.status);
      if (!["pending_verification", "verified", "voided"].includes(status)) {
        return NextResponse.json({ error: "Invalid status." }, { status: 400 });
      }
      patch.status = status;
      patch.verified_by_auth_user_id = status === "verified" ? manager.user.id : null;
    }
    patch.updated_at = new Date().toISOString();

    const { error } = await supabaseServer.from("payroll_advances").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update advance." }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const manager = await requireManager(req);
    if (!manager.ok) return manager.response;
    const { id } = await params;

    const access = await validateAccess(id, manager.storeIds);
    if (!access.ok) return access.response;

    const { error } = await supabaseServer.from("payroll_advances").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete advance." }, { status: 500 });
  }
}
