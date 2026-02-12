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
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

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

type SummaryShiftRow = {
  profile_id: string;
  planned_start_at: string;
  ended_at: string;
  store: { name: string } | null;
  profile: { name: string | null } | null;
};

type EmployeeSummary = {
  user_id: string;
  full_name: string | null;
  lv1_hours: number;
  lv2_hours: number;
  total_hours: number;
};

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

function getCstOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2] || "0");
  return hours * 60 + (hours < 0 ? -mins : mins);
}

function cstDateStartToUtcIso(dateOnly: string) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const utcMidnight = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  const offset = getCstOffsetMinutes(utcMidnight);
  if (offset == null) return null;
  const utcMillis = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0) - offset * 60000;
  return new Date(utcMillis).toISOString();
}

function nextDateOnly(dateOnly: string) {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function detectStoreBucket(storeName: string | null) {
  const name = (storeName || "").toLowerCase();
  if (/\blv\s*1\b/.test(name)) return "lv1";
  if (/\blv\s*2\b/.test(name)) return "lv2";
  return null;
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

    const applyFilters = (query: any) => {
      let next = query;
      if (from) {
        if (isDateOnly(from)) {
          const fromIso = cstDateStartToUtcIso(from);
          if (!fromIso) throw new Error("Invalid from date.");
          next = next.gte("planned_start_at", fromIso);
        } else {
          next = next.gte("planned_start_at", from);
        }
      }
      if (to) {
        if (isDateOnly(to)) {
          const toNext = nextDateOnly(to);
          if (!toNext) throw new Error("Invalid to date.");
          const toExclusiveIso = cstDateStartToUtcIso(toNext);
          if (!toExclusiveIso) throw new Error("Invalid to date.");
          next = next.lt("ended_at", toExclusiveIso);
        } else {
          next = next.lte("ended_at", to);
        }
      }
      if (storeId) next = next.eq("store_id", storeId);
      if (profileId) next = next.eq("profile_id", profileId);
      return next;
    };

    const buildShiftQuery = (selectClause: string, withCount = false) =>
      applyFilters(
        supabaseServer
          .from("shifts")
          .select(selectClause, withCount ? { count: "exact" } : undefined)
          .in("store_id", managerStoreIds)
          .not("ended_at", "is", null)
          .neq("last_action", "removed")
      );

    const query = buildShiftQuery(
      "id, store_id, profile_id, planned_start_at, started_at, ended_at, store:store_id(id,name), profile:profile_id(id,name)",
      true
    );

    const { data, error, count } = await query
      .order("planned_start_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = ((data ?? []) as ShiftRow[]).map(r => {
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

    const byEmployee = new Map<string, EmployeeSummary>();
    let totalLv1Hours = 0;
    let totalLv2Hours = 0;

    const summaryChunkSize = 500;
    const summaryTotal = count ?? 0;
    for (let start = 0; start < summaryTotal; start += summaryChunkSize) {
      const { data: summaryRows, error: summaryErr } = await buildShiftQuery(
        "profile_id, planned_start_at, ended_at, store:store_id(name), profile:profile_id(name)"
      )
        .order("id", { ascending: true })
        .range(start, start + summaryChunkSize - 1);
      if (summaryErr) {
        return NextResponse.json({ error: summaryErr.message }, { status: 500 });
      }

      for (const row of (summaryRows ?? []) as SummaryShiftRow[]) {
        const hours = roundMinutes(calcMinutes(row.planned_start_at, row.ended_at));
        const bucket = detectStoreBucket(row.store?.name ?? null);
        const key = row.profile_id;
        const entry = byEmployee.get(key) ?? {
          user_id: key,
          full_name: row.profile?.name ?? null,
          lv1_hours: 0,
          lv2_hours: 0,
          total_hours: 0,
        };

        if (bucket === "lv1") {
          entry.lv1_hours += hours;
          totalLv1Hours += hours;
        } else if (bucket === "lv2") {
          entry.lv2_hours += hours;
          totalLv2Hours += hours;
        }
        entry.total_hours += hours;
        byEmployee.set(key, entry);
      }
    }

    return NextResponse.json({
      rows,
      page,
      pageSize,
      total: summaryTotal,
      summary: {
        byEmployee: Array.from(byEmployee.values()).sort((a, b) =>
          (a.full_name || "Unknown").localeCompare(b.full_name || "Unknown")
        ),
        totals: {
          lv1_hours: totalLv1Hours,
          lv2_hours: totalLv2Hours,
          total_hours: totalLv1Hours + totalLv2Hours,
        },
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load payroll." }, { status: 500 });
  }
}
