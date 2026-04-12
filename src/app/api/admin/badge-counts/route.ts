import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.length) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    // Count pending requests across all three request types
    const [swapsRes, timeOffRes, timesheetRes, earlyClockInRes, variancesRes] = await Promise.all([
      supabaseServer
        .from("shift_swap_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("store_id", managerStoreIds),
      supabaseServer
        .from("time_off_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("store_id", managerStoreIds),
      supabaseServer
        .from("timesheet_change_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("store_id", managerStoreIds),
      supabaseServer
        .from("early_clock_in_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .in("store_id", managerStoreIds),
      // Variances: out_of_threshold=true, count_missing=false, reviewed_at IS NULL
      // Matches filters used in /api/admin/variances
      supabaseServer
        .from("shift_drawer_counts")
        .select("id, shifts!inner(store_id)", { count: "exact", head: true })
        .eq("out_of_threshold", true)
        .eq("count_missing", false)
        .is("reviewed_at", null)
        .in("shifts.store_id", managerStoreIds),
    ]);

    if (swapsRes.error) console.error("badge-counts swaps error:", swapsRes.error.message);
    if (timeOffRes.error) console.error("badge-counts time_off error:", timeOffRes.error.message);
    if (timesheetRes.error) console.error("badge-counts timesheet error:", timesheetRes.error.message);
    if (earlyClockInRes.error) console.error("badge-counts early_clock_in error:", earlyClockInRes.error.message);
    if (variancesRes.error) console.error("badge-counts variances error:", variancesRes.error.message);

    const pendingRequests =
      (swapsRes.count ?? 0) + (timeOffRes.count ?? 0) + (timesheetRes.count ?? 0) + (earlyClockInRes.count ?? 0);
    const unreviewedVariances = variancesRes.count ?? 0;

    return NextResponse.json({ pendingRequests, unreviewedVariances });
  } catch (err) {
    console.error("badge-counts unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
