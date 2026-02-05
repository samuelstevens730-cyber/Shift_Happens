/**
 * POST /api/admin/schedules/[id]/publish
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken } from "@/lib/adminAuth";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: schedule, error: schedErr } = await supabaseServer
    .from("schedules")
    .select("id, store_id")
    .eq("id", id)
    .single()
    .returns<{ id: string; store_id: string }>();
  if (schedErr || !schedule) return NextResponse.json({ error: "Schedule not found." }, { status: 404 });

  const { data: managed } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", user.id)
    .eq("store_id", schedule.store_id)
    .returns<{ store_id: string }[]>();
  if (!managed?.length) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { error: updateErr } = await supabaseServer
    .from("schedules")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: user.id,
    })
    .eq("id", schedule.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
