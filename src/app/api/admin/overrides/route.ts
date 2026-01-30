/**
 * GET /api/admin/overrides - List Shifts Requiring Override Approval
 *
 * Returns shifts that have been flagged as requiring manager override approval
 * (typically due to exceeding maximum shift duration of 13 hours) and have not
 * yet been approved.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Query params: None
 *
 * Returns: {
 *   rows: Array of {
 *     id: Shift UUID,
 *     storeId: Store UUID,
 *     storeName: Name of the store,
 *     employeeName: Name of the employee,
 *     shiftType: Type of shift (open, close, other),
 *     startedAt: Actual start time ISO string,
 *     endedAt: End time ISO string,
 *     durationHours: Calculated shift duration in hours (rounded to 2 decimals)
 *   }
 * }
 *
 * Business logic:
 *   - Only returns shifts where requires_override = true
 *   - Only returns shifts where override_at IS NULL (not yet approved)
 *   - Only returns shifts for stores the user manages
 *   - Ordered by ended_at descending (most recent first)
 *   - Duration is calculated as (ended_at - started_at) in hours
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ShiftJoinRow = {
  id: string;
  shift_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  requires_override: boolean | null;
  override_at: string | null;
  store: { id: string; name: string } | null;
  profile: { id: string; name: string | null } | null;
};

type OverrideRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  employeeName: string | null;
  shiftType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationHours: number | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

async function getManagerStoreIds(userId: string) {
  const { data, error } = await supabaseServer
    .from("store_managers")
    .select("store_id")
    .eq("user_id", userId)
    .returns<{ store_id: string }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.store_id);
}

function calcDurationHours(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null;
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round(((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 100) / 100;
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) return NextResponse.json({ rows: [] });

  const { data, error } = await supabaseServer
    .from("shifts")
    .select("id, shift_type, started_at, ended_at, requires_override, override_at, store:store_id(id,name), profile:profile_id(id,name)")
    .eq("requires_override", true)
    .is("override_at", null)
    .in("store_id", managerStoreIds)
    .order("ended_at", { ascending: false })
    .returns<ShiftJoinRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: OverrideRow[] = (data ?? []).map(r => ({
    id: r.id,
    storeId: r.store?.id ?? null,
    storeName: r.store?.name ?? null,
    employeeName: r.profile?.name ?? null,
    shiftType: r.shift_type ?? null,
    startedAt: r.started_at ?? null,
    endedAt: r.ended_at ?? null,
    durationHours: calcDurationHours(r.started_at ?? null, r.ended_at ?? null),
  }));

  return NextResponse.json({ rows });
}
