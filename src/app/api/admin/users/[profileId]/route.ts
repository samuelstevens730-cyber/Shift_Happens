import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type MembershipRow = { store_id: string };

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

async function getProfileStoreIds(profileId: string) {
  const { data, error } = await supabaseServer
    .from("store_memberships")
    .select("store_id")
    .eq("profile_id", profileId)
    .returns<MembershipRow[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.store_id);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { profileId } = await params;
    if (!profileId) return NextResponse.json({ error: "Missing profileId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const profileStoreIds = await getProfileStoreIds(profileId);
    const hasAccess = profileStoreIds.some(id => managerStoreIds.includes(id));
    if (!hasAccess) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const body = (await req.json()) as {
      name?: string;
      active?: boolean;
      storeIds?: string[];
    };

    const updateData: { name?: string; active?: boolean } = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
      updateData.name = name;
    }
    if (typeof body.active === "boolean") {
      updateData.active = body.active;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateErr } = await supabaseServer
        .from("profiles")
        .update(updateData)
        .eq("id", profileId);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    if (Array.isArray(body.storeIds)) {
      const storeIds = body.storeIds.filter(Boolean);
      if (storeIds.length === 0) {
        return NextResponse.json({ error: "Select at least one store." }, { status: 400 });
      }
      const invalidStore = storeIds.find(id => !managerStoreIds.includes(id));
      if (invalidStore) return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });

      // Only replace memberships within the manager's stores
      await supabaseServer
        .from("store_memberships")
        .delete()
        .eq("profile_id", profileId)
        .in("store_id", managerStoreIds);

      const rows = storeIds.map(storeId => ({ store_id: storeId, profile_id: profileId }));
      const { error: memErr } = await supabaseServer
        .from("store_memberships")
        .insert(rows);
      if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update user." }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { profileId } = await params;
    if (!profileId) return NextResponse.json({ error: "Missing profileId." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const profileStoreIds = await getProfileStoreIds(profileId);
    const hasAccess = profileStoreIds.some(id => managerStoreIds.includes(id));
    if (!hasAccess) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { error: updateErr } = await supabaseServer
      .from("profiles")
      .update({ active: false })
      .eq("id", profileId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to deactivate user." }, { status: 500 });
  }
}
