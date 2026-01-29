import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type StoreRow = { id: string; name: string };
type UserRow = { id: string; name: string; active: boolean };
type AssignmentRow = {
  id: string;
  type: "task" | "message";
  message: string;
  target_profile_id: string | null;
  target_store_id: string | null;
  created_at: string;
  created_by: string | null;
  delivered_at: string | null;
  delivered_shift_id: string | null;
  delivered_profile_id: string | null;
  delivered_store_id: string | null;
  acknowledged_at: string | null;
  acknowledged_shift_id: string | null;
  completed_at: string | null;
  completed_shift_id: string | null;
  audit_note: string | null;
  audit_note_updated_at: string | null;
  audit_note_by: string | null;
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
    return NextResponse.json({ stores: [], users: [], assignments: [] });
  }

  const { data: stores, error: storeErr } = await supabaseServer
    .from("stores")
    .select("id, name")
    .in("id", managerStoreIds)
    .order("name", { ascending: true })
    .returns<StoreRow[]>();
  if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });

  const { data: memberships, error: memErr } = await supabaseServer
    .from("store_memberships")
    .select("profile_id, store_id")
    .in("store_id", managerStoreIds)
    .returns<{ profile_id: string; store_id: string }[]>();
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const profileIds = Array.from(new Set((memberships ?? []).map(m => m.profile_id)));

  const { data: users, error: userErr } = profileIds.length
    ? await supabaseServer
        .from("profiles")
        .select("id, name, active")
        .in("id", profileIds)
        .order("name", { ascending: true })
        .returns<UserRow[]>()
    : { data: [], error: null };
  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });

  const orParts = [
    `target_store_id.in.(${managerStoreIds.join(",")})`,
  ];
  if (profileIds.length) {
    orParts.push(`target_profile_id.in.(${profileIds.join(",")})`);
  }

  const { data: assignments, error: assignErr } = await supabaseServer
    .from("shift_assignments")
    .select("*")
    .or(orParts.join(","))
    .order("created_at", { ascending: false })
    .returns<AssignmentRow[]>();
  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

  const createdByIds = Array.from(new Set((assignments ?? []).map(a => a.created_by).filter(Boolean))) as string[];
  const auditByIds = Array.from(new Set((assignments ?? []).map(a => a.audit_note_by).filter(Boolean))) as string[];
  const profileRefIds = Array.from(
    new Set(
      (assignments ?? [])
        .flatMap(a => [a.target_profile_id, a.delivered_profile_id])
        .filter(Boolean)
    )
  ) as string[];

  const { data: appUsers } = createdByIds.length || auditByIds.length
    ? await supabaseServer
        .from("app_users")
        .select("id, display_name")
        .in("id", Array.from(new Set([...createdByIds, ...auditByIds])))
        .returns<{ id: string; display_name: string }[]>()
    : { data: [] };

  const { data: profileNames } = profileRefIds.length
    ? await supabaseServer
        .from("profiles")
        .select("id, name")
        .in("id", profileRefIds)
        .returns<{ id: string; name: string }[]>()
    : { data: [] };

  const appUserMap = new Map<string, string>();
  (appUsers ?? []).forEach(u => appUserMap.set(u.id, u.display_name));

  const profileMap = new Map<string, string>();
  (profileNames ?? []).forEach(p => profileMap.set(p.id, p.name));

  const assignmentsWithNames = (assignments ?? []).map(a => ({
    ...a,
    created_by_name: a.created_by ? appUserMap.get(a.created_by) ?? null : null,
    audit_note_by_name: a.audit_note_by ? appUserMap.get(a.audit_note_by) ?? null : null,
    target_profile_name: a.target_profile_id ? profileMap.get(a.target_profile_id) ?? null : null,
    delivered_profile_name: a.delivered_profile_id ? profileMap.get(a.delivered_profile_id) ?? null : null,
  }));

  return NextResponse.json({
    stores: stores ?? [],
    users: users ?? [],
    assignments: assignmentsWithNames,
  });
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as {
      type?: "task" | "message";
      message?: string;
      targetProfileId?: string;
      targetStoreId?: string;
    };

    const type = body.type;
    const message = (body.message || "").trim();
    if (type !== "task" && type !== "message") {
      return NextResponse.json({ error: "Invalid type." }, { status: 400 });
    }
    if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });

    const targetProfileId = body.targetProfileId || null;
    const targetStoreId = body.targetStoreId || null;
    if ((targetProfileId && targetStoreId) || (!targetProfileId && !targetStoreId)) {
      return NextResponse.json({ error: "Select exactly one target." }, { status: 400 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    if (targetStoreId && !managerStoreIds.includes(targetStoreId)) {
      return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
    }

    if (targetProfileId) {
      const { data: mem, error: memErr } = await supabaseServer
        .from("store_memberships")
        .select("store_id")
        .eq("profile_id", targetProfileId)
        .in("store_id", managerStoreIds)
        .limit(1)
        .maybeSingle()
        .returns<{ store_id: string }>();
      if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
      if (!mem) return NextResponse.json({ error: "Invalid profile selection." }, { status: 403 });
    }

    const { error: insertErr } = await supabaseServer
      .from("shift_assignments")
      .insert({
        type,
        message,
        target_profile_id: targetProfileId,
        target_store_id: targetStoreId,
        created_by: user.id,
      });
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create assignment." }, { status: 500 });
  }
}
