/**
 * GET/POST /api/admin/shifts - Shift Management
 *
 * GET: List shifts with pagination and filtering.
 *   Returns shifts for stores the authenticated user manages, with store/profile
 *   details joined. Excludes soft-deleted shifts (last_action = "removed").
 *
 * POST: Create a new shift record.
 *   Creates a shift for an employee at a managed store with specified times
 *   and shift type. Validates store management access and employee membership.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Query params (GET):
 *   - page: Page number (default 1)
 *   - pageSize: Items per page (default 25, max 100)
 *   - from: Filter shifts starting at or after this ISO date
 *   - to: Filter shifts starting at or before this ISO date
 *   - storeId: Filter by specific store (must be a managed store)
 *   - profileId: Filter by specific employee profile
 *
 * Request body (POST):
 *   - storeId: Store UUID (required)
 *   - profileId: Employee profile UUID (required)
 *   - shiftType: Shift type enum - "open", "close", or "other" (required)
 *   - plannedStartAt: Planned start time ISO string (required)
 *   - startedAt: Actual start time ISO string (required)
 *   - endedAt: End time ISO string (optional, null for open shifts)
 *
 * Returns (GET): {
 *   stores: Array of { id, name } for managed stores,
 *   profiles: Array of { id, name, active } for employees in managed stores,
 *   rows: Array of shift objects with store/profile names,
 *   page: Current page number,
 *   pageSize: Items per page,
 *   total: Total matching shifts
 * }
 *
 * Returns (POST): { ok: true } on success
 *
 * Business logic:
 *   - Only returns/creates shifts for stores where user is listed in store_managers
 *   - Employee must have store_membership in the target store
 *   - New shifts are marked with last_action = "added"
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ShiftType } from "@/lib/kioskRules";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type StoreRow = { id: string; name: string };
type ProfileRow = { id: string; name: string | null; active: boolean | null };
type ShiftRow = {
  id: string;
  store_id: string;
  profile_id: string;
  shift_type: ShiftType;
  planned_start_at: string;
  started_at: string;
  ended_at: string | null;
  start_drawer_cents: number | null;
  end_drawer_cents: number | null;
  end_note: string | null;
  manual_closed: boolean | null;
  manual_closed_at: string | null;
  manual_closed_review_status: string | null;
  manual_closed_reviewed_at: string | null;
  manual_closed_reviewed_by: string | null;
  last_action: string | null;
  last_action_by: string | null;
  store: { id: string; name: string } | null;
  profile: { id: string; name: string | null } | null;
};

type CountRow = {
  shift_id: string;
  count_type: "start" | "end";
  drawer_cents: number;
  note: string | null;
};

type CountSummary = { start: number | null; end: number | null; endNote: string | null };

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ stores: [], profiles: [], rows: [], page: 1, pageSize: 25, total: 0 });
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || "25")));
    const offset = (page - 1) * pageSize;
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const storeId = url.searchParams.get("storeId") || "";
    const profileId = url.searchParams.get("profileId") || "";
    const manualClosed = url.searchParams.get("manualClosed") || "";
    const manualClosedReviewed = url.searchParams.get("manualClosedReviewed") || "";

    if (storeId && !managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
    }

    if (profileId) {
      const { data: mem, error: memErr } = await supabaseServer
        .from("store_memberships")
        .select("store_id")
        .eq("profile_id", profileId)
        .in("store_id", managerStoreIds)
        .limit(1)
        .maybeSingle()
        .returns<{ store_id: string }>();
      if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
      if (!mem) return NextResponse.json({ error: "Invalid profile selection." }, { status: 403 });
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
      .select("profile_id")
      .in("store_id", managerStoreIds)
      .returns<{ profile_id: string }[]>();
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    const profileIds = Array.from(new Set((memberships ?? []).map(m => m.profile_id)));
    const { data: profiles, error: profErr } = profileIds.length
      ? await supabaseServer
          .from("profiles")
          .select("id, name, active")
          .in("id", profileIds)
          .order("name", { ascending: true })
          .returns<ProfileRow[]>()
      : { data: [], error: null };
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    const isDateOnly = (value: string | null) =>
      Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

    let query = supabaseServer
      .from("shifts")
      .select(
        "id, store_id, profile_id, shift_type, planned_start_at, started_at, ended_at, manual_closed, manual_closed_at, manual_closed_review_status, manual_closed_reviewed_at, manual_closed_reviewed_by, last_action, last_action_by, store:store_id(id,name), profile:profile_id(id,name)",
        { count: "exact" }
      )
      .in("store_id", managerStoreIds)
      .neq("last_action", "removed");

    if (from) {
      query = query.gte("started_at", isDateOnly(from) ? `${from}T00:00:00.000Z` : from);
    }
    if (to) {
      if (isDateOnly(to)) {
        const d = new Date(`${to}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        query = query.lt("started_at", d.toISOString());
      } else {
        query = query.lte("started_at", to);
      }
    }
    if (storeId) query = query.eq("store_id", storeId);
    if (profileId) query = query.eq("profile_id", profileId);
    if (manualClosed === "1") query = query.eq("manual_closed", true);
    if (manualClosed === "0") query = query.eq("manual_closed", false);
    if (manualClosedReviewed === "1") query = query.not("manual_closed_reviewed_at", "is", null);
    if (manualClosedReviewed === "0") query = query.is("manual_closed_reviewed_at", null);

    const { data, error, count } = await query
      .order("started_at", { ascending: false })
      .range(offset, offset + pageSize - 1)
      .returns<ShiftRow[]>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const shiftIds = (data ?? []).map(r => r.id);
    let countsByShift = new Map<string, CountSummary>();
    if (shiftIds.length) {
      const { data: countRows, error: countErr } = await supabaseServer
        .from("shift_drawer_counts")
        .select("shift_id, count_type, drawer_cents, note")
        .in("shift_id", shiftIds)
        .in("count_type", ["start", "end"])
        .returns<CountRow[]>();
      if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

      countsByShift = new Map(shiftIds.map(id => [id, { start: null, end: null, endNote: null }]));
      (countRows ?? []).forEach(r => {
        const entry: CountSummary = countsByShift.get(r.shift_id) ?? { start: null, end: null, endNote: null };
        if (r.count_type === "start") entry.start = r.drawer_cents;
        if (r.count_type === "end") {
          entry.end = r.drawer_cents;
          entry.endNote = r.note ?? null;
        }
        countsByShift.set(r.shift_id, entry);
      });
    }

    const rows = (data ?? []).map(r => ({
      id: r.id,
      storeId: r.store_id,
      storeName: r.store?.name ?? null,
      profileId: r.profile_id,
      profileName: r.profile?.name ?? null,
      shiftType: r.shift_type,
      plannedStartAt: r.planned_start_at,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      startDrawerCents: countsByShift.get(r.id)?.start ?? null,
      endDrawerCents: countsByShift.get(r.id)?.end ?? null,
      endNote: countsByShift.get(r.id)?.endNote ?? null,
      manualClosed: Boolean(r.manual_closed),
      manualClosedAt: r.manual_closed_at,
      manualClosedReviewStatus: r.manual_closed_review_status,
      manualClosedReviewedAt: r.manual_closed_reviewed_at,
      manualClosedReviewedBy: r.manual_closed_reviewed_by,
      lastAction: r.last_action,
      lastActionBy: r.last_action_by,
    }));

    return NextResponse.json({ stores: stores ?? [], profiles: profiles ?? [], rows, page, pageSize, total: count ?? 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load shifts." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as {
      storeId?: string;
      profileId?: string;
      shiftType?: ShiftType;
      plannedStartAt?: string;
      startedAt?: string;
      endedAt?: string | null;
    };

    const storeId = body.storeId || "";
    const profileId = body.profileId || "";
    const shiftType = body.shiftType;
    const plannedStartAt = body.plannedStartAt || "";
    const startedAt = body.startedAt || "";
    const endedAt = body.endedAt ?? null;

    if (!storeId || !profileId || !shiftType || !plannedStartAt || !startedAt) {
      return NextResponse.json({ error: "Missing fields." }, { status: 400 });
    }

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.includes(storeId)) {
      return NextResponse.json({ error: "Invalid store selection." }, { status: 403 });
    }

    const { data: mem, error: memErr } = await supabaseServer
      .from("store_memberships")
      .select("store_id")
      .eq("profile_id", profileId)
      .eq("store_id", storeId)
      .limit(1)
      .maybeSingle()
      .returns<{ store_id: string }>();
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    if (!mem) return NextResponse.json({ error: "Employee not assigned to this store." }, { status: 403 });

    const { error: insertErr } = await supabaseServer
      .from("shifts")
      .insert({
        store_id: storeId,
        profile_id: profileId,
        shift_type: shiftType,
        planned_start_at: plannedStartAt,
        started_at: startedAt,
        ended_at: endedAt,
        last_action: "added",
        last_action_by: user.id,
      });
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to add shift." }, { status: 500 });
  }
}
