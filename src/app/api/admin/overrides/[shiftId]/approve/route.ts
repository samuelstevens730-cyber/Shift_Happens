import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = { note?: string };

type ShiftRow = {
  id: string;
  store_id: string;
  requires_override: boolean | null;
  override_at: string | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

async function getManagerStoreIds(userId: string) {
  const { data, error } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", userId)
    .returns<{ store_id: string }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.store_id);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { shiftId } = await params;
    if (!shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const body = (await req.json()) as Body;
    const note = (body.note || "").trim();
    if (!note) return NextResponse.json({ error: "Approval note is required." }, { status: 400 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, requires_override, override_at")
      .eq("id", shiftId)
      .maybeSingle()
      .returns<ShiftRow>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (!shift.requires_override) return NextResponse.json({ error: "Override not required." }, { status: 400 });
    if (shift.override_at) return NextResponse.json({ error: "Already approved." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.includes(shift.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        override_at: new Date().toISOString(),
        override_by: user.id,
        override_note: note,
      })
      .eq("id", shiftId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to approve override." }, { status: 500 });
  }
}
