/**
 * GET/POST /api/admin/schedules
 *
 * GET: Returns stores, employees by store, templates, and schedules for managed stores.
 * POST: Ensures schedules exist for each managed store for a given pay period.
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken } from "@/lib/adminAuth";

type StoreRow = { id: string; name: string };
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
type ScheduleRow = {
  id: string;
  store_id: string;
  period_start: string;
  period_end: string;
  status: string;
};

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: managed, error: managedErr } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", user.id)
    .returns<{ store_id: string }[]>();
  if (managedErr) return NextResponse.json({ error: "Failed to load stores." }, { status: 500 });

  const storeIds = (managed ?? []).map(m => m.store_id);
  if (!storeIds.length) return NextResponse.json({ error: "No managed stores." }, { status: 403 });

  const { data: stores } = await supabaseServer
    .from("stores")
    .select("id, name")
    .in("id", storeIds)
    .order("name", { ascending: true })
    .returns<StoreRow[]>();

  const { data: memberships } = await supabaseServer
    .from("store_memberships")
    .select("store_id, profile:profile_id(id, name, active)")
    .in("store_id", storeIds)
    .returns<MembershipRow[]>();

  const { data: templates } = await supabaseServer
    .from("shift_templates")
    .select("id, store_id, day_of_week, shift_type, start_time, end_time, is_overnight")
    .in("store_id", storeIds)
    .returns<TemplateRow[]>();

  const { data: schedules } = await supabaseServer
    .from("schedules")
    .select("id, store_id, period_start, period_end, status")
    .in("store_id", storeIds)
    .order("period_start", { ascending: false })
    .returns<ScheduleRow[]>();

  return NextResponse.json({
    stores: stores ?? [],
    memberships: memberships ?? [],
    templates: templates ?? [],
    schedules: schedules ?? [],
  });
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { periodStart?: string; periodEnd?: string };
  const periodStart = body.periodStart;
  const periodEnd = body.periodEnd;
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "Missing periodStart or periodEnd." }, { status: 400 });
  }

  const { data: managed, error: managedErr } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", user.id)
    .returns<{ store_id: string }[]>();
  if (managedErr) return NextResponse.json({ error: "Failed to load stores." }, { status: 500 });

  const storeIds = (managed ?? []).map(m => m.store_id);
  if (!storeIds.length) return NextResponse.json({ error: "No managed stores." }, { status: 403 });

  const payload = storeIds.map(storeId => ({
    store_id: storeId,
    period_start: periodStart,
    period_end: periodEnd,
    status: "draft",
    created_by: user.id,
  }));

  const { data: schedules, error: insertErr } = await supabaseServer
    .from("schedules")
    .upsert(payload, { onConflict: "store_id,period_start,period_end" })
    .select("id, store_id, period_start, period_end, status")
    .returns<ScheduleRow[]>();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ schedules: schedules ?? [] });
}
