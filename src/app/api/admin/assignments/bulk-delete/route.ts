/**
 * POST /api/admin/assignments/bulk-delete - Delete Multiple Assignments
 *
 * Soft-deletes multiple assignments at once, either by specific IDs or by
 * applying the same filters used in the list view.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Request body:
 *   - ids: Array of assignment UUIDs to delete (optional)
 *   - filters: Filter object to match assignments (optional, used if ids empty)
 *     - from: Filter by created_at >= this ISO date
 *     - to: Filter by created_at <= this ISO date
 *     - storeId: Filter by target store
 *     - profileId: Filter by target profile
 *     - status: "all", "pending", or "completed"
 *
 * Returns: { ok: true, deleted: number } with count of deleted assignments
 *
 * Error responses:
 *   - 401: Unauthorized (invalid/missing token)
 *   - 403: User doesn't manage any stores, or invalid store/profile selection
 *   - 500: Database error
 *
 * Business logic:
 *   - If ids array provided, deletes those specific assignments
 *   - If ids empty/missing, builds a query from filters to find matching assignments
 *   - Only deletes assignments where deleted_at IS NULL
 *   - Sets deleted_at and deleted_by on matched records
 *   - Filter logic matches GET /api/admin/assignments for consistency
 *   - "pending" = messages not acknowledged OR tasks not completed
 *   - "completed" = messages acknowledged OR tasks completed
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type Body = {
  ids?: string[];
  filters?: {
    from?: string;
    to?: string;
    storeId?: string;
    profileId?: string;
    status?: "all" | "pending" | "completed";
  };
};

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as Body;
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    const filters = body.filters ?? {};

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    let targetIds: string[] = [];

    if (ids.length) {
      targetIds = ids;
    } else {
      const storeId = filters.storeId || "";
      const profileId = filters.profileId || "";
      const from = filters.from;
      const to = filters.to;
      const status = (filters.status || "all").toLowerCase();

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

      let storeProfileIds: string[] = [];
      if (storeId) {
        const { data: storeProfiles, error: spErr } = await supabaseServer
          .from("store_memberships")
          .select("profile_id")
          .eq("store_id", storeId)
          .returns<{ profile_id: string }[]>();
        if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });
        storeProfileIds = Array.from(new Set((storeProfiles ?? []).map(p => p.profile_id)));
      }

      let orParts: string[] = [];
      if (storeId) {
        orParts.push(`target_store_id.eq.${storeId}`);
        if (storeProfileIds.length) {
          orParts.push(`target_profile_id.in.(${storeProfileIds.join(",")})`);
        }
      } else {
        orParts = [
          `target_store_id.in.(${managerStoreIds.join(",")})`,
        ];
      }

      let query = supabaseServer
        .from("shift_assignments")
        .select("id")
        .or(orParts.join(","))
        .is("deleted_at", null);

      if (from) query = query.gte("created_at", from);
      if (to) query = query.lte("created_at", to);
      if (profileId) query = query.eq("target_profile_id", profileId);

      if (status === "pending") {
        query = query.or(
          "and(type.eq.message,acknowledged_at.is.null),and(type.eq.task,completed_at.is.null)"
        );
      } else if (status === "completed") {
        query = query.or(
          "and(type.eq.message,acknowledged_at.not.is.null),and(type.eq.task,completed_at.not.is.null)"
        );
      }

      const { data, error } = await query.returns<{ id: string }[]>();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      targetIds = (data ?? []).map(r => r.id);
    }

    if (targetIds.length === 0) return NextResponse.json({ ok: true, deleted: 0 });

    const { error: updateErr } = await supabaseServer
      .from("shift_assignments")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .in("id", targetIds)
      .is("deleted_at", null);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, deleted: targetIds.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete assignments." }, { status: 500 });
  }
}
