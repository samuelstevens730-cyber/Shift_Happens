/**
 * GET /api/admin/open-shifts - List Open (Unended) Shifts
 *
 * Returns all shifts that have not yet ended (ended_at is null) and are not
 * soft-deleted. Includes store and employee details for each shift.
 *
 * Auth: Bearer token required (admin access)
 *
 * Query params: None
 *
 * Returns: {
 *   rows: Array of {
 *     id: Shift UUID,
 *     storeName: Name of the store,
 *     expectedDrawerCents: Store's expected drawer amount in cents,
 *     employeeName: Name of the employee working the shift,
 *     shiftType: Type of shift (open, close, other),
 *     plannedStartAt: Planned start time ISO string,
 *     startedAt: Actual start time ISO string,
 *     createdAt: Shift creation timestamp
 *   }
 * }
 *
 * Business logic:
 *   - Returns shifts where ended_at IS NULL
 *   - Excludes soft-deleted shifts (last_action != "removed")
 *   - Ordered by started_at descending (most recent first)
 *   - Includes expected_drawer_cents from store for drawer count reference
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ShiftJoinRow = {
  id: string;
  shift_type: string | null;
  planned_start_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string | null;
  store: { id: string; name: string; expected_drawer_cents: number } | null;
  profile: { id: string; name: string | null } | null;
};

type OpenShiftRow = {
  id: string;
  storeName: string | null;
  expectedDrawerCents: number | null;
  employeeName: string | null;
  shiftType: string | null;
  plannedStartAt: string | null;
  startedAt: string | null;
  createdAt: string | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7);
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data, error } = await supabaseServer
    .from("shifts")
    .select(
      "id, shift_type, planned_start_at, started_at, ended_at, created_at, store:store_id(id,name,expected_drawer_cents), profile:profile_id(id,name)"
    )
    .is("ended_at", null)
    .neq("last_action", "removed")
    .order("started_at", { ascending: false })
    .returns<ShiftJoinRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: OpenShiftRow[] = (data ?? []).map(r => ({
    id: r.id,
    storeName: r.store?.name ?? null,
    expectedDrawerCents: r.store?.expected_drawer_cents ?? null,
    employeeName: r.profile?.name ?? null,
    shiftType: r.shift_type ?? null,
    plannedStartAt: r.planned_start_at ?? null,
    startedAt: r.started_at ?? null,
    createdAt: r.created_at ?? null,
  }));

  return NextResponse.json({ rows });
}
