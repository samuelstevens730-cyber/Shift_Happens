/**
 * GET/POST /api/admin/assignments - Task and Message Assignments
 *
 * GET: List assignments (tasks and messages) with pagination and filtering.
 *   Returns assignments targeted at stores or employees the manager has access to,
 *   along with stores and users lists for filter dropdowns.
 *
 * POST: Create a new assignment (task or message).
 *   Assigns a task or message to either a specific employee or an entire store.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Query params (GET):
 *   - page: Page number (default 1)
 *   - pageSize: Items per page (default 25, max 100)
 *   - from: Filter assignments created at or after this ISO date
 *   - to: Filter assignments created at or before this ISO date
 *   - storeId: Filter by specific store (must be a managed store)
 *   - profileId: Filter by specific employee profile
 *   - status: Filter by status - "all", "pending", or "completed"
 *
 * Request body (POST):
 *   - type: "task" or "message" (required)
 *   - message: The assignment content/text (required, non-empty)
 *   - targetProfileId: Employee profile UUID (mutually exclusive with targetStoreId)
 *   - targetStoreId: Store UUID (mutually exclusive with targetProfileId)
 *
 * Returns (GET): {
 *   stores: Array of { id, name } for managed stores,
 *   users: Array of { id, name, active } for employees in managed stores,
 *   assignments: Array of assignment objects with creator/target names resolved,
 *   page: Current page number,
 *   pageSize: Items per page,
 *   total: Total matching assignments
 * }
 *
 * Returns (POST): { ok: true } on success
 *
 * Business logic:
 *   - Assignments can target either a store OR an employee, not both
 *   - "task" type is completed when completed_at is set
 *   - "message" type is completed when acknowledged_at is set
 *   - Soft-deleted assignments (deleted_at not null) are excluded
 *   - Creator names come from app_users table
 *   - Target/delivered profile names come from profiles table
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { createNotification } from "@/lib/notifications";

type StoreRow = { id: string; name: string };
type UserRow = { id: string; name: string; active: boolean };
type AssignmentRow = {
  id: string;
  type: "task" | "message";
  source_kind?: "assignment";
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
  deleted_at: string | null;
  deleted_by: string | null;
};

type NotificationAssignmentRow = {
  id: string;
  type: "message";
  source_kind: "notification";
  message: string;
  target_profile_id: string | null;
  target_store_id: string | null;
  created_at: string;
  created_by: string | null;
  delivered_at: string | null;
  delivered_shift_id: string | null;
  delivered_profile_id: string | null;
  acknowledged_at: string | null;
  acknowledged_shift_id: string | null;
  completed_at: string | null;
  completed_shift_id: string | null;
  audit_note: null;
  audit_note_updated_at: null;
  audit_note_by: null;
  deleted_at: string | null;
  deleted_by: string | null;
};

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

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || "25")));
  const offset = (page - 1) * pageSize;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const storeId = url.searchParams.get("storeId") || "";
  const profileId = url.searchParams.get("profileId") || "";
  const status = (url.searchParams.get("status") || "all").toLowerCase();

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

  let filteredOrParts: string[] = [];
  if (storeId) {
    let storeProfileIds: string[] = [];
    const { data: storeProfiles, error: spErr } = await supabaseServer
      .from("store_memberships")
      .select("profile_id")
      .eq("store_id", storeId)
      .returns<{ profile_id: string }[]>();
    if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });
    storeProfileIds = Array.from(new Set((storeProfiles ?? []).map(p => p.profile_id)));

    filteredOrParts.push(`target_store_id.eq.${storeId}`);
    if (storeProfileIds.length) {
      filteredOrParts.push(`target_profile_id.in.(${storeProfileIds.join(",")})`);
    }
  } else {
    filteredOrParts = [
      `target_store_id.in.(${managerStoreIds.join(",")})`,
    ];
    if (profileIds.length) {
      filteredOrParts.push(`target_profile_id.in.(${profileIds.join(",")})`);
    }
  }

  let assignmentQuery = supabaseServer
    .from("shift_assignments")
    .select("*")
    .or(filteredOrParts.join(","))
    .is("deleted_at", null);

  if (from) assignmentQuery = assignmentQuery.gte("created_at", from);
  if (to) assignmentQuery = assignmentQuery.lte("created_at", to);
  if (profileId) assignmentQuery = assignmentQuery.eq("target_profile_id", profileId);

  if (status === "pending") {
    assignmentQuery = assignmentQuery.or(
      "and(type.eq.message,acknowledged_at.is.null),and(type.eq.task,completed_at.is.null)"
    );
  } else if (status === "completed") {
    assignmentQuery = assignmentQuery.or(
      "and(type.eq.message,acknowledged_at.not.is.null),and(type.eq.task,completed_at.not.is.null)"
    );
  }

  const { data: assignments, error: assignErr } = await assignmentQuery
    .order("created_at", { ascending: false })
    .returns<AssignmentRow[]>();
  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

  const storeMembershipMap = new Map<string, string[]>();
  for (const membership of memberships ?? []) {
    const current = storeMembershipMap.get(membership.profile_id) ?? [];
    if (!current.includes(membership.store_id)) current.push(membership.store_id);
    storeMembershipMap.set(membership.profile_id, current);
  }

  const notificationProfileIds = profileId
    ? [profileId]
    : storeId
      ? Array.from(new Set((memberships ?? []).filter(m => m.store_id === storeId).map(m => m.profile_id)))
      : profileIds;

  const notificationScopeParts = storeId
    ? [
        `source_store_id.eq.${storeId}`,
        ...(notificationProfileIds.length
          ? [`and(source_store_id.is.null,recipient_profile_id.in.(${notificationProfileIds.join(",")}))`]
          : []),
      ]
    : [
        `source_store_id.in.(${managerStoreIds.join(",")})`,
        ...(notificationProfileIds.length
          ? [`and(source_store_id.is.null,recipient_profile_id.in.(${notificationProfileIds.join(",")}))`]
          : []),
      ];

  let notificationQuery = notificationScopeParts.length
    ? supabaseServer
        .from("notifications")
        .select("id, recipient_profile_id, source_store_id, body, created_at, created_by, read_at, deleted_at, deleted_by")
        .eq("notification_type", "manager_message")
        .or(notificationScopeParts.join(","))
        .is("deleted_at", null)
    : null;

  if (notificationQuery && from) notificationQuery = notificationQuery.gte("created_at", from);
  if (notificationQuery && to) notificationQuery = notificationQuery.lte("created_at", to);
  if (notificationQuery && status === "pending") notificationQuery = notificationQuery.is("read_at", null);
  if (notificationQuery && status === "completed") notificationQuery = notificationQuery.not("read_at", "is", null);

  const { data: notificationRows, error: notificationErr } = notificationQuery
    ? await notificationQuery.returns<Array<{
        id: string;
        recipient_profile_id: string;
        source_store_id: string | null;
        body: string;
        created_at: string;
        created_by: string | null;
        read_at: string | null;
        deleted_at: string | null;
        deleted_by: string | null;
      }>>()
    : { data: [], error: null };
  if (notificationErr) return NextResponse.json({ error: notificationErr.message }, { status: 500 });

  const scopedNotificationRows = (notificationRows ?? []).filter(notification => {
    if (storeId) {
      if (notification.source_store_id) return notification.source_store_id === storeId;
      return Boolean(storeMembershipMap.get(notification.recipient_profile_id)?.includes(storeId));
    }

    if (notification.source_store_id) {
      return managerStoreIds.includes(notification.source_store_id);
    }

    return Boolean(
      storeMembershipMap.get(notification.recipient_profile_id)?.some(id => managerStoreIds.includes(id))
    );
  });

  const notificationAssignments: NotificationAssignmentRow[] = scopedNotificationRows.map(notification => ({
    id: notification.id,
    type: "message" as const,
    source_kind: "notification" as const,
    message: notification.body,
    target_profile_id: notification.recipient_profile_id,
    target_store_id:
      notification.source_store_id ??
      storeMembershipMap.get(notification.recipient_profile_id)?.find(id => managerStoreIds.includes(id)) ??
      null,
    created_at: notification.created_at,
    created_by: notification.created_by,
    delivered_at: notification.created_at,
    delivered_shift_id: null,
    delivered_profile_id: notification.recipient_profile_id,
    acknowledged_at: notification.read_at,
    acknowledged_shift_id: null,
    completed_at: null,
    completed_shift_id: null,
    audit_note: null,
    audit_note_updated_at: null,
    audit_note_by: null,
    deleted_at: notification.deleted_at,
    deleted_by: notification.deleted_by,
  }));

  const notificationIds = new Set(notificationAssignments.map(notification => notification.id));
  const visibleAssignments = (assignments ?? []).filter(
    assignment => !(assignment.type === "message" && assignment.target_profile_id && notificationIds.has(assignment.id))
  );

  const allAssignments = [
    ...(visibleAssignments.map(assignment => ({ ...assignment, source_kind: "assignment" as const }))),
    ...notificationAssignments,
  ].sort((a, b) => {
    const left = new Date(a.created_at).getTime();
    const right = new Date(b.created_at).getTime();
    return right - left;
  });

  const createdByIds = Array.from(new Set(allAssignments.map(a => a.created_by).filter(Boolean))) as string[];
  const auditByIds = Array.from(
    new Set(
      allAssignments
        .map(a => ("audit_note_by" in a ? a.audit_note_by : null))
        .filter(Boolean)
    )
  ) as string[];
  const profileRefIds = Array.from(
    new Set(
      allAssignments
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

  const assignmentsWithNames = allAssignments.slice(offset, offset + pageSize).map(a => ({
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
    page,
    pageSize,
    total: allAssignments.length,
  });
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    let body: {
      type?: "task" | "message";
      message?: string;
      targetProfileId?: string;
      targetStoreId?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

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

    let targetProfileStoreId: string | null = null;
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
      targetProfileStoreId = mem.store_id;
    }

    if (type === "message" && targetProfileId) {
      const created = await createNotification({
        recipientProfileId: targetProfileId,
        sourceStoreId: targetProfileStoreId ?? undefined,
        notificationType: "manager_message",
        priority: "high",
        title: "Message from manager",
        body: message,
        createdBy: user.id,
      });

      if (!created) {
        return NextResponse.json({ error: "Failed to create assignment." }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
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
