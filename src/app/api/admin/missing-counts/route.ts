import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type MissingCountJoinRow = {
  id: string;
  shift_id: string;
  count_type: "start" | "changeover" | "end";
  counted_at: string;
  drawer_cents: number;
  note: string | null;
  count_missing: boolean | null;
  shift: {
    shift_type: string | null;
    store: { id: string; name: string; expected_drawer_cents: number } | null;
    profile: { id: string; name: string | null } | null;
  } | null;
};

type MissingCountRow = {
  id: string;
  shiftId: string;
  storeName: string | null;
  employeeName: string | null;
  shiftType: string | null;
  countType: "start" | "changeover" | "end";
  countedAt: string;
  drawerCents: number;
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
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

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
      "id, shift_id, count_type, counted_at, drawer_cents, note, count_missing, shift:shift_id(shift_type, store:store_id(id,name,expected_drawer_cents), profile:profile_id(id,name))",
      { count: "exact" }
    )
    .eq("count_missing", true);

  if (from) query = query.gte("counted_at", from);
  if (to) query = query.lte("counted_at", to);
  query = query.in("shift.store_id", managerStoreIds);
  if (storeId) query = query.eq("shift.store_id", storeId);
  if (profileId) query = query.eq("shift.profile_id", profileId);

  const { data, error, count } = await query
    .order("counted_at", { ascending: false })
    .range(offset, offset + pageSize - 1)
    .returns<MissingCountJoinRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: MissingCountRow[] = (data ?? []).map(r => ({
    id: r.id,
    shiftId: r.shift_id,
    storeName: r.shift?.store?.name ?? null,
    employeeName: r.shift?.profile?.name ?? null,
    shiftType: r.shift?.shift_type ?? null,
    countType: r.count_type,
    countedAt: r.counted_at,
    drawerCents: r.drawer_cents,
    note: r.note ?? null,
  }));

  return NextResponse.json({ rows, page, pageSize, total: count ?? 0 });
}
