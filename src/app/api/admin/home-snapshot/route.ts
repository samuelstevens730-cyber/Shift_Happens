/**
 * GET /api/admin/home-snapshot
 *
 * Single-call snapshot for the admin quick-view card on the employee home page.
 *
 * Auth:    Bearer token (manager-scoped)
 * Returns: {
 *   yesterdaySales:      number | null  (cents, null if no record)
 *   weeklySales:         number | null  (cents, Mon–today, null if no records)
 *   clockedIn:           Array<{ name, storeName, since }>
 *   scheduledToday:      number         (# schedule_shifts for today)
 *   pendingRequests:     number         (swap + time-off + timesheet)
 *   unreviewedVariances: number
 * }
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

// ── Date helpers (CST/CDT via America/Chicago) ─────────────────────────────

function todayCst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Returns the Monday (YYYY-MM-DD) of the ISO week containing dateStr. */
function weekStartMonday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

// ── Types ──────────────────────────────────────────────────────────────────

type SalesRow = {
  store_id: string;
  business_date: string;
  z_report_cents: number | null;
  close_sales_cents: number | null;
};

type OpenShiftRow = {
  id: string;
  started_at: string | null;
  store: { name: string } | null;
  profile: { name: string | null } | null;
};

// ── Route ──────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const storeIds = await getManagerStoreIds(user.id);
    if (!storeIds.length) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const today = todayCst();
    const yesterday = addDays(today, -1);
    const weekStart = weekStartMonday(today);

    // ── Parallel queries ──────────────────────────────────────────────────
    const [
      yesterdaySalesRes,
      weeklySalesRes,
      openShiftsRes,
      scheduledTodayRes,
      swapsRes,
      timeOffRes,
      timesheetRes,
      variancesRes,
    ] = await Promise.all([
      // Yesterday's sales
      supabaseServer
        .from("daily_sales_records")
        .select("store_id, business_date, z_report_cents, close_sales_cents")
        .in("store_id", storeIds)
        .eq("business_date", yesterday)
        .returns<SalesRow[]>(),

      // Weekly sales (Monday → today inclusive)
      supabaseServer
        .from("daily_sales_records")
        .select("store_id, business_date, z_report_cents, close_sales_cents")
        .in("store_id", storeIds)
        .gte("business_date", weekStart)
        .lte("business_date", today)
        .returns<SalesRow[]>(),

      // Currently clocked in
      supabaseServer
        .from("shifts")
        .select("id, started_at, store:store_id(name), profile:profile_id(name)")
        .in("store_id", storeIds)
        .is("ended_at", null)
        .neq("last_action", "removed")
        .order("started_at", { ascending: true })
        .returns<OpenShiftRow[]>(),

      // Scheduled shifts today
      supabaseServer
        .from("schedule_shifts")
        .select("id", { count: "exact", head: true })
        .in("store_id", storeIds)
        .eq("shift_date", today),

      // Pending swap requests
      supabaseServer
        .from("shift_swap_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("store_id", storeIds),

      // Pending time-off requests
      supabaseServer
        .from("time_off_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("store_id", storeIds),

      // Pending timesheet corrections
      supabaseServer
        .from("timesheet_change_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("store_id", storeIds),

      // Unreviewed cash variances
      supabaseServer
        .from("shift_drawer_counts")
        .select("id, shifts!inner(store_id)", { count: "exact", head: true })
        .eq("out_of_threshold", true)
        .eq("count_missing", false)
        .is("reviewed_at", null)
        .in("shifts.store_id", storeIds),
    ]);

    // ── Aggregate sales ───────────────────────────────────────────────────
    function sumSales(rows: SalesRow[] | null): number | null {
      if (!rows || rows.length === 0) return null;
      const total = rows.reduce((acc, r) => {
        const v = r.z_report_cents ?? r.close_sales_cents ?? 0;
        return acc + v;
      }, 0);
      return total;
    }

    const clockedIn = (openShiftsRes.data ?? []).map((r) => ({
      name: r.profile?.name ?? "Unknown",
      storeName: r.store?.name ?? "",
      since: r.started_at ?? "",
    }));

    return NextResponse.json({
      yesterdaySales: sumSales(yesterdaySalesRes.data ?? null),
      weeklySales: sumSales(weeklySalesRes.data ?? null),
      clockedIn,
      scheduledToday: scheduledTodayRes.count ?? 0,
      pendingRequests:
        (swapsRes.count ?? 0) + (timeOffRes.count ?? 0) + (timesheetRes.count ?? 0),
      unreviewedVariances: variancesRes.count ?? 0,
    });
  } catch (err) {
    console.error("home-snapshot error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
