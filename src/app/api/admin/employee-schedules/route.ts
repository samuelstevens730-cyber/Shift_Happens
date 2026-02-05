/**
 * GET /api/admin/employee-schedules
 *
 * Returns published schedule shifts for managed stores with optional filters.
 *
 * Query params:
 * - storeId?: string
 * - profileId?: string
 *
 * Response:
 * - { stores: Store[], employees: Employee[], shifts: ScheduleShiftRow[] }
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken } from "@/lib/adminAuth";

type StoreRow = { id: string; name: string };
type EmployeeRow = { id: string; name: string | null; active: boolean | null; store_ids: string[] };
type ScheduleShiftRow = {
  id: string;
  store_id: string;
  profile_id: string;
  shift_date: string;
  shift_type: string;
  shift_mode: string;
  scheduled_start: string;
  scheduled_end: string;
  schedules?: { period_start: string; period_end: string; status: string } | null;
  stores?: { name: string } | null;
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

  const managedStoreIds = (managed ?? []).map(m => m.store_id);
  if (!managedStoreIds.length) {
    return NextResponse.json({ error: "No managed stores." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId") || "";
  const profileId = searchParams.get("profileId") || "";

  if (storeId && !managedStoreIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const storeScope = storeId ? [storeId] : managedStoreIds;

  const { data: stores } = await supabaseServer
    .from("stores")
    .select("id, name")
    .in("id", storeScope)
    .order("name", { ascending: true })
    .returns<StoreRow[]>();

  const { data: memberships } = await supabaseServer
    .from("store_memberships")
    .select("store_id, profile:profile_id(id, name, active)")
    .in("store_id", storeScope)
    .returns<Array<{ store_id: string; profile: { id: string; name: string | null; active: boolean | null } | null }>>();

  const employeeMap = new Map<string, EmployeeRow>();
  (memberships ?? []).forEach(m => {
    if (!m.profile) return;
    const existing = employeeMap.get(m.profile.id);
    if (existing) {
      if (!existing.store_ids.includes(m.store_id)) {
        existing.store_ids.push(m.store_id);
      }
      return;
    }
    employeeMap.set(m.profile.id, {
      id: m.profile.id,
      name: m.profile.name,
      active: m.profile.active,
      store_ids: [m.store_id],
    });
  });
  const employees = Array.from(employeeMap.values());

  if (profileId) {
    const hasAccess = employees.some(e => e.id === profileId);
    if (!hasAccess) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let shiftsQuery = supabaseServer
    .from("schedule_shifts")
    .select(
      "id, store_id, profile_id, shift_date, shift_type, shift_mode, scheduled_start, scheduled_end, schedules!inner(period_start, period_end, status), stores(name)"
    )
    .in("store_id", storeScope)
    .eq("schedules.status", "published")
    .order("shift_date", { ascending: true })
    .order("scheduled_start", { ascending: true });

  if (profileId) {
    shiftsQuery = shiftsQuery.eq("profile_id", profileId);
  }

  const { data: shifts, error: shiftsErr } = await shiftsQuery.returns<ScheduleShiftRow[]>();
  if (shiftsErr) return NextResponse.json({ error: shiftsErr.message }, { status: 500 });

  return NextResponse.json({
    stores: stores ?? [],
    employees,
    shifts: shifts ?? [],
  });
}
