import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type ShiftJoinRow = {
  id: string;
  shift_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  requires_override: boolean | null;
  override_at: string | null;
  store: { id: string; name: string } | null;
  profile: { id: string; name: string | null } | null;
};

type OverrideRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  employeeName: string | null;
  shiftType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationHours: number | null;
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

function calcDurationHours(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null;
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round(((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 100) / 100;
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) return NextResponse.json({ rows: [] });

  const { data, error } = await supabaseServer
    .from("shifts")
    .select("id, shift_type, started_at, ended_at, requires_override, override_at, store:store_id(id,name), profile:profile_id(id,name)")
    .eq("requires_override", true)
    .is("override_at", null)
    .in("store_id", managerStoreIds)
    .order("ended_at", { ascending: false })
    .returns<ShiftJoinRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: OverrideRow[] = (data ?? []).map(r => ({
    id: r.id,
    storeId: r.store?.id ?? null,
    storeName: r.store?.name ?? null,
    employeeName: r.profile?.name ?? null,
    shiftType: r.shift_type ?? null,
    startedAt: r.started_at ?? null,
    endedAt: r.ended_at ?? null,
    durationHours: calcDurationHours(r.started_at ?? null, r.ended_at ?? null),
  }));

  return NextResponse.json({ rows });
}
