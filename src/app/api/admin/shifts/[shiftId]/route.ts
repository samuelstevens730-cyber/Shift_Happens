import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ShiftType } from "@/lib/kioskRules";

type ShiftRow = {
  id: string;
  store_id: string;
  profile_id: string;
  last_action: string | null;
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

export async function PATCH(
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

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, last_action")
      .eq("id", shiftId)
      .maybeSingle()
      .returns<ShiftRow>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.last_action === "removed") return NextResponse.json({ error: "Shift removed." }, { status: 400 });
    if (!managerStoreIds.includes(shift.store_id)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const body = (await req.json()) as {
      shiftType?: ShiftType;
      plannedStartAt?: string;
      startedAt?: string;
      endedAt?: string | null;
    };

    const update: Record<string, string | null> = {};
    if (body.shiftType) update.shift_type = body.shiftType;
    if (body.plannedStartAt) update.planned_start_at = body.plannedStartAt;
    if (body.startedAt) update.started_at = body.startedAt;
    if (body.endedAt !== undefined) update.ended_at = body.endedAt;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    update.last_action = "edited";
    update.last_action_by = user.id;

    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update(update)
      .eq("id", shiftId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update shift." }, { status: 500 });
  }
}

export async function DELETE(
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

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, last_action")
      .eq("id", shiftId)
      .maybeSingle()
      .returns<{ id: string; store_id: string; last_action: string | null }>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.last_action === "removed") return NextResponse.json({ ok: true });
    if (!managerStoreIds.includes(shift.store_id)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        last_action: "removed",
        last_action_by: user.id,
      })
      .eq("id", shiftId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to remove shift." }, { status: 500 });
  }
}
