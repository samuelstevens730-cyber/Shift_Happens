import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type ShiftRow = {
  id: string;
  store_id: string;
  schedule_shift_id: string | null;
  started_at: string | null;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { shiftId } = await params;
    if (!shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id,store_id,schedule_shift_id,started_at")
      .eq("id", shiftId)
      .maybeSingle<ShiftRow>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (!managerStoreIds.includes(shift.store_id)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (shift.schedule_shift_id) {
      return NextResponse.json({ error: "Shift is scheduled; unscheduled review not applicable." }, { status: 400 });
    }
    if (!shift.started_at) {
      return NextResponse.json({ error: "Shift has not started; unscheduled review not applicable." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const note = (body.note ?? "").trim();

    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        unscheduled_reviewed_at: new Date().toISOString(),
        unscheduled_reviewed_by: user.id,
        unscheduled_review_note: note || null,
        last_action: "edited",
        last_action_by: user.id,
      })
      .eq("id", shiftId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to review unscheduled shift." },
      { status: 500 }
    );
  }
}
