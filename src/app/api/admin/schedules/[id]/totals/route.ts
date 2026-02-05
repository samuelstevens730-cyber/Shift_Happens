/**
 * GET /api/admin/schedules/[id]/totals
 * Returns hours totals for a schedule.
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken } from "@/lib/adminAuth";

type ShiftRow = {
  profile_id: string;
  store_id: string;
  scheduled_start: string;
  scheduled_end: string;
};

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(n => Number(n));
  return h * 60 + (m || 0);
}

function calcHours(start: string, end: string) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  if (e < s) e += 24 * 60;
  return (e - s) / 60;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: rows, error: rowErr } = await supabaseServer
    .from("schedule_shifts")
    .select("profile_id, store_id, scheduled_start, scheduled_end")
    .eq("schedule_id", schedule.id)
    .returns<ShiftRow[]>();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });

  const byEmployee: Record<string, number> = {};
  const byStore: Record<string, number> = {};
  let grandTotal = 0;

  (rows ?? []).forEach(r => {
    const hours = calcHours(r.scheduled_start, r.scheduled_end);
    byEmployee[r.profile_id] = (byEmployee[r.profile_id] ?? 0) + hours;
    byStore[r.store_id] = (byStore[r.store_id] ?? 0) + hours;
    grandTotal += hours;
  });

  return NextResponse.json({ byEmployee, byStore, grandTotal });
}
