import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function DELETE(
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

    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    const reason = (body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "Hard delete reason is required." }, { status: 400 });
    }
    if (reason.length < 8) {
      return NextResponse.json({ error: "Hard delete reason must be at least 8 characters." }, { status: 400 });
    }

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id,store_id,profile_id,shift_type,started_at,ended_at,last_action")
      .eq("id", shiftId)
      .maybeSingle()
      .returns<{
        id: string;
        store_id: string;
        profile_id: string;
        shift_type: string;
        started_at: string;
        ended_at: string | null;
        last_action: string | null;
      }>();
    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (!managerStoreIds.includes(shift.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { error: auditErr } = await supabaseServer
      .from("shift_change_audit_logs")
      .insert({
        shift_id: shift.id,
        store_id: shift.store_id,
        actor_user_id: user.id,
        action: "hard_delete",
        reason,
        metadata: {
          profileId: shift.profile_id,
          shiftType: shift.shift_type,
          startedAt: shift.started_at,
          endedAt: shift.ended_at,
          previousLastAction: shift.last_action,
        },
      });
    if (auditErr) return NextResponse.json({ error: auditErr.message }, { status: 500 });

    const { error: deleteErr } = await supabaseServer.from("shifts").delete().eq("id", shiftId);
    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to hard delete shift." },
      { status: 500 }
    );
  }
}
