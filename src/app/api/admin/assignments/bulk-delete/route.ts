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

async function getManagedProfileIds(managerStoreIds: string[], storeId?: string) {
  let membershipsQuery = supabaseServer
    .from("store_memberships")
    .select("profile_id, store_id");

  if (storeId) {
    membershipsQuery = membershipsQuery.eq("store_id", storeId);
  } else {
    membershipsQuery = membershipsQuery.in("store_id", managerStoreIds);
  }

  const { data, error } = await membershipsQuery.returns<Array<{ profile_id: string; store_id: string }>>();
  if (error) return { error: error.message, status: 500 as const };

  return {
    memberships: data ?? [],
    profileIds: Array.from(new Set((data ?? []).map(membership => membership.profile_id))),
    error: null as null,
    status: 200 as const,
  };
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    const filters = body.filters ?? {};

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    let targetIds: string[] = [];
    let notificationTargetIds: string[] = [];

    if (ids.length) {
      const { data: assignments, error: assignmentErr } = await supabaseServer
        .from("shift_assignments")
        .select("id, target_store_id, target_profile_id")
        .in("id", ids)
        .is("deleted_at", null)
        .returns<Array<{ id: string; target_store_id: string | null; target_profile_id: string | null }>>();
      if (assignmentErr) return NextResponse.json({ error: assignmentErr.message }, { status: 500 });

      for (const assignment of assignments ?? []) {
        if (assignment.target_store_id) {
          if (!managerStoreIds.includes(assignment.target_store_id)) {
            return NextResponse.json({ error: "Forbidden." }, { status: 403 });
          }
        } else if (assignment.target_profile_id) {
          const { memberships = [], error, status } = await getManagedProfileIds(managerStoreIds);
          if (error) return NextResponse.json({ error }, { status });
          if (!memberships.some(membership => membership.profile_id === assignment.target_profile_id)) {
            return NextResponse.json({ error: "Forbidden." }, { status: 403 });
          }
        }
      }
      targetIds = (assignments ?? []).map(assignment => assignment.id);

      const { data: notifications, error: notificationErr } = await supabaseServer
        .from("notifications")
        .select("id, recipient_profile_id, source_store_id")
        .in("id", ids)
        .eq("notification_type", "manager_message")
        .is("deleted_at", null)
        .returns<Array<{ id: string; recipient_profile_id: string; source_store_id: string | null }>>();
      if (notificationErr) return NextResponse.json({ error: notificationErr.message }, { status: 500 });

      if ((notifications ?? []).length) {
        const { profileIds = [], error, status } = await getManagedProfileIds(managerStoreIds);
        if (error) return NextResponse.json({ error }, { status });
        for (const notification of notifications ?? []) {
          if (notification.source_store_id) {
            if (!managerStoreIds.includes(notification.source_store_id)) {
              return NextResponse.json({ error: "Forbidden." }, { status: 403 });
            }
            continue;
          }

          if (!profileIds.includes(notification.recipient_profile_id)) {
            return NextResponse.json({ error: "Forbidden." }, { status: 403 });
          }
        }
      }

      notificationTargetIds = (notifications ?? []).map(notification => notification.id);
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

      const { profileIds = [], error: managedProfileErr, status: managedProfileStatus } = await getManagedProfileIds(
        managerStoreIds,
        storeId || undefined
      );
      if (managedProfileErr) {
        return NextResponse.json({ error: managedProfileErr }, { status: managedProfileStatus });
      }

      let orParts: string[] = [];
      if (storeId) {
        orParts.push(`target_store_id.eq.${storeId}`);
        if (profileIds.length) {
          orParts.push(`target_profile_id.in.(${profileIds.join(",")})`);
        }
      } else {
        orParts = [
          `target_store_id.in.(${managerStoreIds.join(",")})`,
        ];
        if (profileIds.length) {
          orParts.push(`target_profile_id.in.(${profileIds.join(",")})`);
        }
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

      const notificationScopeParts = storeId
        ? [
            `source_store_id.eq.${storeId}`,
            ...(profileIds.length
              ? [`and(source_store_id.is.null,recipient_profile_id.in.(${profileIds.join(",")}))`]
              : []),
          ]
        : [
            `source_store_id.in.(${managerStoreIds.join(",")})`,
            ...(profileIds.length
              ? [`and(source_store_id.is.null,recipient_profile_id.in.(${profileIds.join(",")}))`]
              : []),
          ];

      let notificationQuery = notificationScopeParts.length
        ? supabaseServer
            .from("notifications")
            .select("id, recipient_profile_id, source_store_id")
            .eq("notification_type", "manager_message")
            .or(notificationScopeParts.join(","))
            .is("deleted_at", null)
        : null;

      if (notificationQuery && from) notificationQuery = notificationQuery.gte("created_at", from);
      if (notificationQuery && to) notificationQuery = notificationQuery.lte("created_at", to);
      if (notificationQuery && profileId) notificationQuery = notificationQuery.eq("recipient_profile_id", profileId);
      if (notificationQuery && status === "pending") notificationQuery = notificationQuery.is("read_at", null);
      if (notificationQuery && status === "completed") {
        notificationQuery = notificationQuery.not("read_at", "is", null);
      }

      const { data: notificationData, error: notificationQueryErr } = notificationQuery
        ? await notificationQuery.returns<Array<{
            id: string;
            recipient_profile_id: string;
            source_store_id: string | null;
          }>>()
        : { data: [], error: null };
      if (notificationQueryErr) {
        return NextResponse.json({ error: notificationQueryErr.message }, { status: 500 });
      }

      notificationTargetIds = (notificationData ?? [])
        .filter(row => {
          if (storeId) {
            if (row.source_store_id) return row.source_store_id === storeId;
            return profileIds.includes(row.recipient_profile_id);
          }

          if (row.source_store_id) return managerStoreIds.includes(row.source_store_id);
          return profileIds.includes(row.recipient_profile_id);
        })
        .map(row => row.id);
    }

    if (targetIds.length === 0 && notificationTargetIds.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    const deletedAt = new Date().toISOString();

    if (targetIds.length) {
      const { error: updateErr } = await supabaseServer
        .from("shift_assignments")
        .update({ deleted_at: deletedAt, deleted_by: user.id })
        .in("id", targetIds)
        .is("deleted_at", null);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    if (notificationTargetIds.length) {
      const { error: notificationUpdateErr } = await supabaseServer
        .from("notifications")
        .update({ deleted_at: deletedAt, deleted_by: user.id })
        .in("id", notificationTargetIds)
        .is("deleted_at", null);
      if (notificationUpdateErr) {
        return NextResponse.json({ error: notificationUpdateErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, deleted: new Set([...targetIds, ...notificationTargetIds]).size });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete assignments." }, { status: 500 });
  }
}
