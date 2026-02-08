import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type Body = {
  shiftId?: string;
  scheduleId?: string;
  reason?: string;
};

export async function POST(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = (await req.json()) as Body;
    const reason = (body.reason ?? "").trim();
    if (!body.shiftId || !body.scheduleId) {
      return NextResponse.json({ error: "Missing shiftId or scheduleId." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "Skip reason is required." }, { status: 400 });
    }

    const { data, error } = await supabaseServer.rpc("skip_cleaning_task", {
      p_actor_profile_id: authResult.auth.profileId,
      p_shift_id: body.shiftId,
      p_schedule_id: body.scheduleId,
      p_reason: reason,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: Boolean(data) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to skip cleaning task." }, { status: 500 });
  }
}
