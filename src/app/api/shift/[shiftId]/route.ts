/**
 * GET /api/shift/[shiftId] - Get Shift Details
 *
 * OPTIMIZED & SAFE:
 * 1) Validates shift + auth + store/token first (no mutation side effects on failed access).
 * 2) Uses Promise.all for heavy independent reads + assignment claim/fetch.
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ShiftType } from "@/lib/kioskRules";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { getManagerStoreIds } from "@/lib/adminAuth";

type ChecklistItemRow = {
  id: string;
  template_id: string;
  label: string;
  sort_order: number;
  required: boolean;
};

type TemplateRow = {
  id: string;
  store_id: string | null;
  shift_type: string;
  name: string;
};

function templatesForShiftType(st: ShiftType) {
  if (st === "open") return ["open"];
  if (st === "close") return ["close"];
  if (st === "double") return ["open", "close"];
  return [];
}

function normLabel(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

async function fetchTemplatesForStore(storeId: string, shiftTypes: string[]) {
  const { data: storeTemplates, error: storeErr } = await supabaseServer
    .from("checklist_templates")
    .select("id, store_id, shift_type, name")
    .eq("store_id", storeId)
    .in("shift_type", shiftTypes)
    .returns<TemplateRow[]>();

  if (storeErr) throw new Error(storeErr.message);
  if (storeTemplates && storeTemplates.length > 0) return storeTemplates;

  const { data: legacyTemplates, error: legacyErr } = await supabaseServer
    .from("checklist_templates")
    .select("id, store_id, shift_type, name")
    .is("store_id", null)
    .in("shift_type", shiftTypes)
    .returns<TemplateRow[]>();
  if (legacyErr) throw new Error(legacyErr.message);
  return legacyTemplates ?? [];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  // 1) Authenticate request
  const authResult = await authenticateShiftRequest(_req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const auth = authResult.auth;
  const { shiftId } = await params;
  const url = new URL(_req.url);
  const qrToken = url.searchParams.get("t") || "";

  // 2) Fetch shift root record
  const { data: shift, error: shiftErr } = await supabaseServer
    .from("shifts")
    .select("id, store_id, profile_id, shift_type, planned_start_at, started_at, ended_at, last_action")
    .eq("id", shiftId)
    .maybeSingle();

  if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
  if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
  if (shift.last_action === "removed") {
    return NextResponse.json({ error: "Shift was removed." }, { status: 404 });
  }

  // 3) Authorization checks
  if (auth.authType === "employee") {
    if (shift.profile_id !== auth.profileId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  } else {
    const managerUserId = auth.authUserId ?? auth.profileId;
    const managerStoreIds = await getManagerStoreIds(managerUserId);
    if (!managerStoreIds.includes(shift.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  // 4) Validate store/token BEFORE any assignment mutation
  let store: { id: string; name: string; expected_drawer_cents: number };
  if (qrToken) {
    const { data, error } = await supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents, qr_token")
      .eq("qr_token", qrToken)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });
    if (shift.store_id !== data.id) {
      return NextResponse.json({ error: "Shift does not belong to this store." }, { status: 403 });
    }
    store = data;
  } else {
    const { data, error } = await supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents")
      .eq("id", shift.store_id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Store not found." }, { status: 404 });
    store = data;
  }

  // 5) Parallel reads/mutations (now safe)
  try {
    const [profileResult, countsResult, checklistResult, assignmentsResult] = await Promise.all([
      // A) Employee profile
      (async () => {
        const { data, error } = await supabaseServer
          .from("profiles")
          .select("id, name")
          .eq("id", shift.profile_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data;
      })(),

      // B) Drawer counts
      (async () => {
        const { data, error } = await supabaseServer
          .from("shift_drawer_counts")
          .select("count_type, drawer_cents, confirmed, notified_manager, note, counted_at")
          .eq("shift_id", shiftId);
        if (error) throw new Error(error.message);
        return data ?? [];
      })(),

      // C) Checklist items/checks
      (async () => {
        const neededTemplateTypes = templatesForShiftType(shift.shift_type as ShiftType);
        let items: ChecklistItemRow[] = [];
        let checks: string[] = [];

        if (neededTemplateTypes.length) {
          const templates = await fetchTemplatesForStore(shift.store_id, neededTemplateTypes);
          const templateIds = templates.map(t => t.id);

          if (templateIds.length) {
            const { data: rawItems, error: itemsErr } = await supabaseServer
              .from("checklist_items")
              .select("id, template_id, label, sort_order, required")
              .in("template_id", templateIds)
              .order("sort_order");
            if (itemsErr) throw new Error(itemsErr.message);
            items = (rawItems ?? []) as ChecklistItemRow[];
          }

          const { data: doneRows, error: doneErr } = await supabaseServer
            .from("shift_checklist_checks")
            .select("item_id")
            .eq("shift_id", shiftId);
          if (doneErr) throw new Error(doneErr.message);
          checks = (doneRows ?? []).map(c => c.item_id);
        }

        return { items, checks };
      })(),

      // D) Claim pending assignments + fetch delivered assignments
      (async () => {
        if (!shift.ended_at) {
          const { data: pending, error: pendingErr } = await supabaseServer
            .from("shift_assignments")
            .select("id")
            .is("delivered_at", null)
            .is("deleted_at", null)
            .or(`target_profile_id.eq.${shift.profile_id},target_store_id.eq.${shift.store_id}`);

          if (pendingErr) throw new Error(pendingErr.message);

          const pendingIds = (pending ?? []).map(a => a.id);
          if (pendingIds.length) {
            const { error: claimErr } = await supabaseServer
              .from("shift_assignments")
              .update({
                delivered_at: new Date().toISOString(),
                delivered_shift_id: shift.id,
                delivered_profile_id: shift.profile_id,
                delivered_store_id: shift.store_id,
              })
              .in("id", pendingIds)
              .is("delivered_at", null);
            if (claimErr) throw new Error(claimErr.message);
          }
        }

        const { data: assignments, error: assignErr } = await supabaseServer
          .from("shift_assignments")
          .select("id,type,message,created_at,created_by,delivered_at,acknowledged_at,completed_at")
          .eq("delivered_shift_id", shift.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .returns<{
            id: string;
            type: "task" | "message";
            message: string;
            created_at: string;
            created_by: string | null;
            delivered_at: string | null;
            acknowledged_at: string | null;
            completed_at: string | null;
          }[]>();

        if (assignErr) throw new Error(assignErr.message);
        return assignments ?? [];
      })(),
    ]);

    // 6) Build grouped checklist payload
    const checkedSet = new Set(checklistResult.checks);
    const groupMap = new Map<
      string,
      { label: string; norm: string; required: boolean; sort_order: number; itemIds: string[] }
    >();

    for (const it of checklistResult.items) {
      const k = normLabel(it.label);
      const existing = groupMap.get(k);
      if (!existing) {
        groupMap.set(k, {
          label: it.label.trim(),
          norm: k,
          required: Boolean(it.required),
          sort_order: Number.isFinite(it.sort_order) ? it.sort_order : 9999,
          itemIds: [it.id],
        });
      } else {
        existing.required = existing.required || Boolean(it.required);
        existing.sort_order = Math.min(existing.sort_order, Number.isFinite(it.sort_order) ? it.sort_order : 9999);
        existing.itemIds.push(it.id);
      }
    }

    const checklistGroups = Array.from(groupMap.values()).sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.label.localeCompare(b.label);
    });

    const checkedGroupLabels = checklistGroups
      .filter(g => g.itemIds.every(id => checkedSet.has(id)))
      .map(g => g.label);

    return NextResponse.json({
      store,
      shift,
      employee: profileResult?.name ?? null,
      counts: countsResult,
      checklistItems: checklistResult.items,
      checkedItemIds: checklistResult.checks,
      checklistGroups,
      checkedGroupLabels,
      assignments: assignmentsResult,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

