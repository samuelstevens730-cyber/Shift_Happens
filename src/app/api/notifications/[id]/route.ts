import { NextResponse } from "next/server";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type PatchBody = {
  dismiss?: boolean;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = await params;
  const now = new Date().toISOString();
  const patch: { read_at: string; dismissed_at?: string } = {
    read_at: now,
  };

  if (body.dismiss === true) {
    patch.dismissed_at = now;
  }

  // Service-role update is explicitly scoped to the authenticated recipient profile.
  const { data, error } = await supabaseServer
    .from("notifications")
    .update(patch)
    .eq("id", id)
    .eq("recipient_profile_id", authResult.auth.profileId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[PATCH /api/notifications/[id]]", error.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
