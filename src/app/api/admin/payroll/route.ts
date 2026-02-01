/**
 * GET /api/admin/payroll - Get Payroll Data for Completed Shifts
 *
 * Returns shift data formatted for payroll processing, including calculated
 * duration in both exact minutes and rounded hours. Only includes completed
 * shifts (those with an end time).
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Query params:
 *   - page: Page number (default 1)
 *   - pageSize: Items per page (default 25, max 100)
 *   - from: Filter shifts starting at or after this ISO date
 *   - to: Filter shifts ending at or before this ISO date
 *   - storeId: Filter by specific store (must be a managed store)
 *   - profileId: Filter by specific employee profile
 *
 * Returns: {
 *   rows: Array of {
 *     id: Shift UUID,
 *     user_id: Employee profile UUID,
 *     full_name: Employee name,
 *     store_id: Store UUID,
 *     store_name: Store name,
 *     start_at: Shift start time ISO string,
 *     end_at: Shift end time ISO string,
 *     minutes: Exact duration in minutes,
 *     rounded_hours: Duration rounded to nearest half-hour for payroll
 *   },
 *   page: Current page number,
 *   pageSize: Items per page,
 *   total: Total matching shifts
 * }
 *
 * Business logic:
 *   - Only returns completed shifts (ended_at IS NOT NULL)
 *   - Excludes soft-deleted shifts (last_action != "removed")
 *   - Only returns shifts for stores the user manages
 *   - Hours are rounded using 20/40 rule:
 *     - < 20 min remainder: round down
 *     - > 40 min remainder: round up
 *     - 20-40 min remainder: round to half hour
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ShiftRow = {
  id: string;
  store_id: string;
  profile_id: string;
  planned_start_at: string;
  started_at: string;
  ended_at: string;
  store: { id: string; name: string } | null;
  profile: { id: string; name: string | null } | null;
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

function calcMinutes(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000));
}

function roundMinutes(mins: number) {
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem < 20) return hours;
  if (rem > 40) return hours + 1;
  return hours + 0.5;
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || "25")));
    const offset = (page - 1) * pageSize;
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const storeId = url.searchParams.get("storeId") || "";
    const profileId = url.searchParams.get("profileId") || "";

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ rows: [], page, pageSize, total: 0 });

    if (storeId && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
    }

    const isDateOnly = (value: string | null) =>
      Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

    let query = supabaseServer
      .from("shifts")
      .select("id, store_id, profile_id, planned_start_at, started_at, ended_at, store:store_id(id,name), profile:profile_id(id,name)", { count: "exact" })
      .in("store_id", managerStoreIds)
      .not("ended_at", "is", null)
      .neq("last_action", "removed");

    if (from) {
      query = query.gte("planned_start_at", isDateOnly(from) ? `${from}T00:00:00.000Z` : from);
    }
    if (to) {
      if (isDateOnly(to)) {
        const d = new Date(`${to}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        query = query.lt("ended_at", d.toISOString());
      } else {
        query = query.lte("ended_at", to);
      }
    }
    if (storeId) query = query.eq("store_id", storeId);
    if (profileId) query = query.eq("profile_id", profileId);

    const { data, error, count } = await query
      .order("planned_start_at", { ascending: false })
      .range(offset, offset + pageSize - 1)
      .returns<ShiftRow[]>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map(r => {
      const mins = calcMinutes(r.planned_start_at, r.ended_at);
      return {
        id: r.id,
        user_id: r.profile_id,
        full_name: r.profile?.name ?? null,
        store_id: r.store_id,
        store_name: r.store?.name ?? null,
        start_at: r.planned_start_at,
        end_at: r.ended_at,
        minutes: mins,
        rounded_hours: roundMinutes(mins),
      };
    });

    return NextResponse.json({ rows, page, pageSize, total: count ?? 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load payroll." }, { status: 500 });
  }
}
