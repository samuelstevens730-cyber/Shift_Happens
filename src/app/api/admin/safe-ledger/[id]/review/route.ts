import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import type { SafeCloseoutRow } from "@/types/safeLedger";

type Body = {
  reviewed?: boolean;
  note?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid closeout id." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    if (body.reviewed !== true) {
      return NextResponse.json({ error: "Body must include reviewed=true." }, { status: 400 });
    }
    if (typeof body.note === "string" && body.note.length > 1000) {
      return NextResponse.json({ error: "note must be <= 1000 characters." }, { status: 400 });
    }

    const { data: existing, error: existingErr } = await supabaseServer
      .from("safe_closeouts")
      .select("*")
      .eq("id", id)
      .maybeSingle<SafeCloseoutRow>();

    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "Closeout not found." }, { status: 404 });
    if (!managerStoreIds.includes(existing.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const patch: Partial<SafeCloseoutRow> = {
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      requires_manager_review: false,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateErr } = await supabaseServer
      .from("safe_closeouts")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single<SafeCloseoutRow>();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({
      row: updated,
      review_note_accepted: typeof body.note === "string" ? body.note.trim() : null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to review closeout." },
      { status: 500 }
    );
  }
}
