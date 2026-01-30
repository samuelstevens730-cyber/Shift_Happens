/**
 * GET /api/admin/variances - List Unreviewed Drawer Count Variances
 *
 * Returns drawer counts that are outside the acceptable threshold and have not
 * yet been reviewed by a manager. Used for identifying discrepancies that need
 * investigation.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Query params:
 *   - page: Page number (default 1)
 *   - pageSize: Items per page (default 25, max 100)
 *   - from: Filter counts at or after this ISO date
 *   - to: Filter counts at or before this ISO date
 *   - storeId: Filter by specific store (must be a managed store)
 *   - profileId: Filter by specific employee profile
 *
 * Returns: {
 *   rows: Array of {
 *     id: Drawer count UUID,
 *     shiftId: Associated shift UUID,
 *     storeName: Name of the store,
 *     expectedDrawerCents: Store's expected drawer amount,
 *     employeeName: Name of the employee,
 *     shiftType: Type of shift,
 *     countType: "start", "changeover", or "end",
 *     countedAt: Timestamp of the count,
 *     drawerCents: Actual counted amount in cents,
 *     confirmed: Whether employee confirmed the count,
 *     notifiedManager: Whether manager was notified,
 *     note: Any note attached to the count
 *   },
 *   page: Current page number,
 *   pageSize: Items per page,
 *   total: Total matching records
 * }
 *
 * Business logic:
 *   - Only returns counts where out_of_threshold = true
 *   - Excludes counts marked as count_missing = true
 *   - Only returns counts where reviewed_at IS NULL
 *   - Only returns counts for stores the user manages
 *   - Excludes counts from soft-deleted shifts
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type VarianceJoinRow = {
  id: string;
  shift_id: string;
  count_type: "start" | "changeover" | "end";
  counted_at: string;
  drawer_cents: number;
  confirmed: boolean | null;
  notified_manager: boolean | null;
  note: string | null;
  out_of_threshold: boolean | null;
  count_missing: boolean | null;
  shift: {
    shift_type: string | null;
    store: { id: string; name: string; expected_drawer_cents: number } | null;
    profile: { id: string; name: string | null } | null;
  } | null;
};

type VarianceRow = {
  id: string;
  shiftId: string;
  storeName: string | null;
  expectedDrawerCents: number | null;
  employeeName: string | null;
  shiftType: string | null;
  countType: "start" | "changeover" | "end";
  countedAt: string;
  drawerCents: number;
  confirmed: boolean;
  notifiedManager: boolean;
  note: string | null;
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

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ rows: [], page: 1, pageSize: 25, total: 0 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || "25")));
  const offset = (page - 1) * pageSize;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const storeId = url.searchParams.get("storeId") || "";
  const profileId = url.searchParams.get("profileId") || "";

  if (storeId && !managerStoreIds.includes(storeId)) {
    return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
  }

  let query = supabaseServer
    .from("shift_drawer_counts")
    .select(
      "id, shift_id, count_type, counted_at, drawer_cents, confirmed, notified_manager, note, out_of_threshold, count_missing, shift:shift_id(shift_type, store:store_id(id,name,expected_drawer_cents), profile:profile_id(id,name))",
      { count: "exact" }
    )
    .eq("out_of_threshold", true)
    .eq("count_missing", false)
    .is("reviewed_at", null);

  if (from) query = query.gte("counted_at", from);
  if (to) query = query.lte("counted_at", to);
  query = query.in("shift.store_id", managerStoreIds);
  if (storeId) query = query.eq("shift.store_id", storeId);
  if (profileId) query = query.eq("shift.profile_id", profileId);
  query = query.neq("shift.last_action", "removed");

  const { data, error, count } = await query
    .order("counted_at", { ascending: false })
    .range(offset, offset + pageSize - 1)
    .returns<VarianceJoinRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: VarianceRow[] = (data ?? []).map(r => ({
    id: r.id,
    shiftId: r.shift_id,
    storeName: r.shift?.store?.name ?? null,
    expectedDrawerCents: r.shift?.store?.expected_drawer_cents ?? null,
    employeeName: r.shift?.profile?.name ?? null,
    shiftType: r.shift?.shift_type ?? null,
    countType: r.count_type,
    countedAt: r.counted_at,
    drawerCents: r.drawer_cents,
    confirmed: Boolean(r.confirmed),
    notifiedManager: Boolean(r.notified_manager),
    note: r.note ?? null,
  }));

  return NextResponse.json({ rows, page, pageSize, total: count ?? 0 });
}
