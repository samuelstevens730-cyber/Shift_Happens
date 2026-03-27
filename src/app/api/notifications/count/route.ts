import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { count, error } = await supabaseServer
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_profile_id", authResult.auth.profileId)
    .is("read_at", null)
    .is("dismissed_at", null)
    .is("deleted_at", null);

  if (error) {
    console.error("[GET /api/notifications/count]", error.message);
    return NextResponse.json({ error: "Failed to fetch notification count" }, { status: 500 });
  }

  return NextResponse.json({ unread_count: count ?? 0 });
}
