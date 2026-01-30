/**
 * GET/POST /api/admin/users - Employee Management
 *
 * GET: List employees (profiles) for stores the manager has access to.
 *   Returns stores and aggregated user list with their store assignments.
 *
 * POST: Create a new employee profile.
 *   Creates a profile record and assigns them to specified stores.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Query params (GET): None
 *
 * Request body (POST):
 *   - name: Employee name (required, non-empty string)
 *   - active: Whether employee is active (optional, defaults to true)
 *   - storeIds: Array of store UUIDs to assign employee to (required, at least one)
 *
 * Returns (GET): {
 *   stores: Array of { id, name } for managed stores,
 *   users: Array of {
 *     id: Profile UUID,
 *     name: Employee name,
 *     active: Whether employee is active,
 *     storeIds: Array of store UUIDs they belong to
 *   }
 * }
 *
 * Returns (POST): { ok: true, id: newProfileUUID } on success
 *
 * Business logic:
 *   - GET aggregates employees across all managed stores
 *   - Employees can belong to multiple stores (storeIds array)
 *   - POST validates all storeIds are stores the manager manages
 *   - Creates profile first, then store_memberships records
 *   - Employees sorted alphabetically by name
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type StoreRow = { id: string; name: string };
type MembershipRow = {
  store_id: string;
  profile: { id: string; name: string; active: boolean };
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
    return NextResponse.json({ stores: [], users: [] });
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
    .select("store_id, profile:profile_id(id, name, active)")
    .in("store_id", managerStoreIds)
    .returns<MembershipRow[]>();
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const userMap = new Map<string, { id: string; name: string; active: boolean; storeIds: string[] }>();
  (memberships ?? []).forEach(m => {
    const prof = m.profile;
    if (!prof) return;
    const existing = userMap.get(prof.id);
    if (existing) {
      if (!existing.storeIds.includes(m.store_id)) existing.storeIds.push(m.store_id);
    } else {
      userMap.set(prof.id, {
        id: prof.id,
        name: prof.name,
        active: Boolean(prof.active),
        storeIds: [m.store_id],
      });
    }
  });

  const users = Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ stores: stores ?? [], users });
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as {
      name?: string;
      active?: boolean;
      storeIds?: string[];
    };

    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
    const storeIds = Array.isArray(body.storeIds) ? body.storeIds.filter(Boolean) : [];
    if (storeIds.length === 0) {
      return NextResponse.json({ error: "Select at least one store." }, { status: 400 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    const invalidStore = storeIds.find(id => !managerStoreIds.includes(id));
    if (invalidStore) return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });

    const { data: profile, error: profErr } = await supabaseServer
      .from("profiles")
      .insert({ name, active: body.active !== false })
      .select("id")
      .maybeSingle()
      .returns<{ id: string }>();
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!profile) return NextResponse.json({ error: "Failed to create profile." }, { status: 500 });

    const rows = storeIds.map(storeId => ({ store_id: storeId, profile_id: profile.id }));
    const { error: memErr } = await supabaseServer
      .from("store_memberships")
      .insert(rows);
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, id: profile.id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create user." }, { status: 500 });
  }
}
