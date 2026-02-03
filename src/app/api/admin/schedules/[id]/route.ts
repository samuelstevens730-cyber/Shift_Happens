/**
 * GET /api/admin/schedules/[id]
 * Returns schedule metadata + schedule_shifts + templates + employees for the schedule's store.
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ScheduleRow = { id: string; store_id: string; period_start: string; period_end: string; status: string };
type ShiftRow = {
  id: string;
  schedule_id: string;
  store_id: string;
  profile_id: string;
  shift_date: string;
  shift_type: string;
  shift_mode: string;
  scheduled_start: string;
  scheduled_end: string;
};
type TemplateRow = {
  id: string;
  store_id: string;
  day_of_week: number;
  shift_type: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean | null;
};
type MembershipRow = {
  store_id: string;
  profile: { id: string; name: string | null; active: boolean | null } | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: schedule, error: schedErr } = await supabaseServer
    .from("schedules")
    .select("id, store_id, period_start, period_end, status")
    .eq("id", id)
    .single()
    .returns<ScheduleRow>();
  if (schedErr || !schedule) return NextResponse.json({ error: "Schedule not found." }, { status: 404 });

  const { data: managed } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", user.id)
    .eq("store_id", schedule.store_id)
    .returns<{ store_id: string }[]>();
  if (!managed?.length) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { data: shifts } = await supabaseServer
    .from("schedule_shifts")
    .select("id, schedule_id, store_id, profile_id, shift_date, shift_type, shift_mode, scheduled_start, scheduled_end")
    .eq("schedule_id", schedule.id)
    .returns<ShiftRow[]>();

  const { data: templates } = await supabaseServer
    .from("shift_templates")
    .select("id, store_id, day_of_week, shift_type, start_time, end_time, is_overnight")
    .eq("store_id", schedule.store_id)
    .returns<TemplateRow[]>();

  const { data: memberships } = await supabaseServer
    .from("store_memberships")
    .select("store_id, profile:profile_id(id, name, active)")
    .eq("store_id", schedule.store_id)
    .returns<MembershipRow[]>();

  return NextResponse.json({
    schedule,
    shifts: shifts ?? [],
    templates: templates ?? [],
    memberships: memberships ?? [],
  });
}
