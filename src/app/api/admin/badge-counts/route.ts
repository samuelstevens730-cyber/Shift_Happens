import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  // Count pending requests across all three request types
  const [swapsRes, timeOffRes, timesheetRes, variancesRes] = await Promise.all([
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
    // Variances: notified_manager=true AND reviewed_at IS NULL, scoped via shifts join
    supabaseServer
      .from("shift_drawer_counts")
      .select("id, shifts!inner(store_id)", { count: "exact", head: true })
      .eq("notified_manager", true)
      .is("reviewed_at", null)
      .in("shifts.store_id", managerStoreIds),
  ]);

  const pendingRequests =
    (swapsRes.count ?? 0) + (timeOffRes.count ?? 0) + (timesheetRes.count ?? 0);
  const unreviewedVariances = variancesRes.count ?? 0;

  return NextResponse.json({ pendingRequests, unreviewedVariances });
}
