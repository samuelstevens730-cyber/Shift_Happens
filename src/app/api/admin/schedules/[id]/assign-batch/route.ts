/**
 * POST /api/admin/schedules/[id]/assign-batch
 * Batch assign shifts for a schedule (supports standard/double/other).
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ScheduleRow = { id: string; store_id: string };
type TemplateRow = { day_of_week: number; shift_type: string; start_time: string; end_time: string };
type Assignment = {
  date: string;
  shiftType: "open" | "close";
  profileId: string | null;
  shiftMode: "standard" | "double" | "other";
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

function getDow(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getDay();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { assignments?: Assignment[] };
  const assignments = body.assignments ?? [];
  if (!assignments.length) return NextResponse.json({ error: "No assignments provided." }, { status: 400 });

  const { data: schedule, error: schedErr } = await supabaseServer
    .from("schedules")
    .select("id, store_id")
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

  const { data: templates } = await supabaseServer
    .from("shift_templates")
    .select("day_of_week, shift_type, start_time, end_time")
    .eq("store_id", schedule.store_id)
    .returns<TemplateRow[]>();

  const templateMap = new Map<string, TemplateRow>();
  (templates ?? []).forEach(t => {
    templateMap.set(`${t.day_of_week}:${t.shift_type}`, t);
  });

  const toUpsert: Array<{
    schedule_id: string;
    store_id: string;
    profile_id: string;
    shift_date: string;
    shift_type: string;
    shift_mode: string;
    scheduled_start: string;
    scheduled_end: string;
  }> = [];

  const toDelete: Array<{ schedule_id: string; store_id: string; shift_date: string; shift_type: string }> = [];

  const profileIds = Array.from(new Set(assignments.map(a => a.profileId).filter(Boolean))) as string[];
  if (profileIds.length) {
    const { data: membershipRows, error: memErr } = await supabaseServer
      .from("store_memberships")
      .select("profile_id")
      .eq("store_id", schedule.store_id)
      .in("profile_id", profileIds)
      .returns<{ profile_id: string }[]>();
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    const allowed = new Set((membershipRows ?? []).map(m => m.profile_id));
    const invalid = profileIds.find(id => !allowed.has(id));
    if (invalid) {
      return NextResponse.json({ error: "Employee not assigned to this store." }, { status: 400 });
    }
  }

  for (const a of assignments) {
    if (!a.date || !a.shiftType) continue;

    if (!a.profileId) {
      toDelete.push({
        schedule_id: schedule.id,
        store_id: schedule.store_id,
        shift_date: a.date,
        shift_type: a.shiftType,
      });
      continue;
    }

    const dow = getDow(a.date);
    const tpl = templateMap.get(`${dow}:${a.shiftType}`);
    const start = a.scheduledStart ?? tpl?.start_time;
    const end = a.scheduledEnd ?? tpl?.end_time;
    if (!start || !end) {
      return NextResponse.json({ error: "Missing template times." }, { status: 400 });
    }

    toUpsert.push({
      schedule_id: schedule.id,
      store_id: schedule.store_id,
      profile_id: a.profileId,
      shift_date: a.date,
      shift_type: a.shiftType,
      shift_mode: a.shiftMode,
      scheduled_start: start,
      scheduled_end: end,
    });

    if (a.shiftMode === "double") {
      const otherType = a.shiftType === "open" ? "close" : "open";
      const otherTpl = templateMap.get(`${dow}:${otherType}`);
      const otherStart = a.scheduledStart ?? otherTpl?.start_time;
      const otherEnd = a.scheduledEnd ?? otherTpl?.end_time;
      if (!otherStart || !otherEnd) {
        return NextResponse.json({ error: "Missing template times for double." }, { status: 400 });
      }
      toUpsert.push({
        schedule_id: schedule.id,
        store_id: schedule.store_id,
        profile_id: a.profileId,
        shift_date: a.date,
        shift_type: otherType,
        shift_mode: a.shiftMode,
        scheduled_start: otherStart,
        scheduled_end: otherEnd,
      });
    }
  }

  if (toDelete.length) {
    for (const del of toDelete) {
      const { error: delErr } = await supabaseServer
        .from("schedule_shifts")
        .delete()
        .eq("schedule_id", del.schedule_id)
        .eq("store_id", del.store_id)
        .eq("shift_date", del.shift_date)
        .eq("shift_type", del.shift_type);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  if (toUpsert.length) {
    const { error: upErr } = await supabaseServer
      .from("schedule_shifts")
      .upsert(toUpsert, { onConflict: "schedule_id,store_id,shift_date,shift_type" });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
