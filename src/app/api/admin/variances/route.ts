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

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data, error } = await supabaseServer
    .from("shift_drawer_counts")
    .select(
      "id, shift_id, count_type, counted_at, drawer_cents, confirmed, notified_manager, note, out_of_threshold, shift:shift_id(shift_type, store:store_id(id,name,expected_drawer_cents), profile:profile_id(id,name))"
    )
    .eq("out_of_threshold", true)
    .is("reviewed_at", null)
    .order("counted_at", { ascending: false })
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

  return NextResponse.json({ rows });
}
