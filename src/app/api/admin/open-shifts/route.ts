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
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

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

type CountRow = {
  shift_id: string;
  count_type: "start" | "end";
  drawer_cents: number;
  note: string | null;
};

type CountSummary = { start: number | null; end: number | null; endNote: string | null };

type OpenShiftRow = {
  id: string;
  storeName: string | null;
  expectedDrawerCents: number | null;
  employeeName: string | null;
  shiftType: string | null;
  plannedStartAt: string | null;
  startedAt: string | null;
  createdAt: string | null;
  startDrawerCents: number | null;
  endDrawerCents: number | null;
  endNote: string | null;
};

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const { data, error } = await supabaseServer
      .from("shifts")
      .select(
        "id, shift_type, planned_start_at, started_at, ended_at, created_at, store:store_id(id,name,expected_drawer_cents), profile:profile_id(id,name)"
      )
      .in("store_id", managerStoreIds)
      .is("ended_at", null)
      .neq("last_action", "removed")
      .order("started_at", { ascending: false })
      .returns<ShiftJoinRow[]>();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const shiftIds = (data ?? []).map(r => r.id);
    let countsByShift = new Map<string, CountSummary>();
    if (shiftIds.length) {
      const { data: countRows, error: countErr } = await supabaseServer
        .from("shift_drawer_counts")
        .select("shift_id, count_type, drawer_cents, note")
        .in("shift_id", shiftIds)
        .in("count_type", ["start", "end"])
        .returns<CountRow[]>();
      if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

      countsByShift = new Map(shiftIds.map(id => [id, { start: null, end: null, endNote: null }]));
      (countRows ?? []).forEach(r => {
        const entry: CountSummary = countsByShift.get(r.shift_id) ?? { start: null, end: null, endNote: null };
        if (r.count_type === "start") entry.start = r.drawer_cents;
        if (r.count_type === "end") {
          entry.end = r.drawer_cents;
          entry.endNote = r.note ?? null;
        }
        countsByShift.set(r.shift_id, entry);
      });
    }

    const rows: OpenShiftRow[] = (data ?? []).map(r => ({
      id: r.id,
      storeName: r.store?.name ?? null,
      expectedDrawerCents: r.store?.expected_drawer_cents ?? null,
      employeeName: r.profile?.name ?? null,
      shiftType: r.shift_type ?? null,
      plannedStartAt: r.planned_start_at ?? null,
      startedAt: r.started_at ?? null,
      createdAt: r.created_at ?? null,
      startDrawerCents: countsByShift.get(r.id)?.start ?? null,
      endDrawerCents: countsByShift.get(r.id)?.end ?? null,
      endNote: countsByShift.get(r.id)?.endNote ?? null,
    }));

    return NextResponse.json({ rows });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load open shifts." },
      { status: 500 }
    );
  }
}
