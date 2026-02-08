import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { shiftId } = await params;
    if (!shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const { data, error } = await supabaseServer.rpc("fetch_cleaning_tasks_for_shift", {
      p_actor_profile_id: authResult.auth.profileId,
      p_shift_id: shiftId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tasks: data ?? [] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load cleaning tasks." }, { status: 500 });
  }
}
