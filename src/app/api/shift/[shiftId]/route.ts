// src/app/api/shift/[shiftId]/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ShiftType } from "@/lib/kioskRules";

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
  const { shiftId } = await params;

  const url = new URL(_req.url);
  const qrToken = url.searchParams.get("t") || "";

  // fetch shift
  const { data: shift, error: shiftErr } = await supabaseServer
    .from("shifts")
    .select("id, store_id, profile_id, shift_type, planned_start_at, started_at, ended_at")
    .eq("id", shiftId)
    .maybeSingle();

  if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
  if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });

  let store: { id: string; name: string; expected_drawer_cents: number } | null = null;

  if (qrToken) {
    // resolve store by token
    const { data: storeByToken, error: storeErr } = await supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents")
      .eq("qr_token", qrToken)
      .maybeSingle();

    if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
    if (!storeByToken) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });
    if (shift.store_id !== storeByToken.id)
      return NextResponse.json({ error: "Shift does not belong to this store." }, { status: 403 });
    store = storeByToken;
  } else {
    const { data: storeById, error: storeErr } = await supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents")
      .eq("id", shift.store_id)
      .maybeSingle();

    if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
    if (!storeById) return NextResponse.json({ error: "Store not found." }, { status: 404 });
    store = storeById;
  }

  // employee name
  const { data: prof, error: profErr } = await supabaseServer
    .from("profiles")
    .select("id, name")
    .eq("id", shift.profile_id)
    .maybeSingle();
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

  // drawer counts
  const { data: counts, error: countsErr } = await supabaseServer
    .from("shift_drawer_counts")
    .select("count_type, drawer_cents, confirmed, notified_manager, note, counted_at")
    .eq("shift_id", shiftId);

  if (countsErr) return NextResponse.json({ error: countsErr.message }, { status: 500 });

  // checklist items for this shift type
  const neededTemplateTypes = templatesForShiftType(shift.shift_type as ShiftType);

  let checklistItems: ChecklistItemRow[] = [];
  let checks: { item_id: string }[] = [];

  if (neededTemplateTypes.length) {
    let templates: TemplateRow[] = [];
    try {
      templates = await fetchTemplatesForStore(shift.store_id, neededTemplateTypes);
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load templates." }, { status: 500 });
    }

    const templateIds = (templates ?? []).map(t => t.id);

    if (templateIds.length) {
      const { data: items, error: itemsErr } = await supabaseServer
        .from("checklist_items")
        .select("id, template_id, label, sort_order, required")
        .in("template_id", templateIds)
        .order("sort_order");

      if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
      checklistItems = (items ?? []) as ChecklistItemRow[];
    }

    const { data: doneRows, error: doneErr } = await supabaseServer
      .from("shift_checklist_checks")
      .select("item_id")
      .eq("shift_id", shiftId);

    if (doneErr) return NextResponse.json({ error: doneErr.message }, { status: 500 });
    checks = (doneRows ?? []) as { item_id: string }[];
  }

  const checkedItemIds = checks.map(c => c.item_id);
  const checkedSet = new Set(checkedItemIds);

  // Option A: dedupe by label into groups that still remember underlying itemIds[]
  const groupMap = new Map<
    string,
    { label: string; norm: string; required: boolean; sort_order: number; itemIds: string[] }
  >();

  for (const it of checklistItems) {
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

  // A group is "checked" only if ALL underlying items are checked
  const checkedGroupLabels = checklistGroups
    .filter(g => g.itemIds.every(id => checkedSet.has(id)))
    .map(g => g.label);

  // Claim pending assignments for this shift (next-shift semantics)
  if (!shift.ended_at) {
    const { data: pendingAssignments, error: pendingErr } = await supabaseServer
      .from("shift_assignments")
      .select("id")
      .is("delivered_at", null)
      .is("deleted_at", null)
      .or(`target_profile_id.eq.${shift.profile_id},target_store_id.eq.${shift.store_id}`);
    if (pendingErr) return NextResponse.json({ error: pendingErr.message }, { status: 500 });

    const pendingIds = (pendingAssignments ?? []).map(a => a.id);
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
      if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
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
  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

  return NextResponse.json({
    store,
    shift,
    employee: prof?.name ?? null,
    counts: counts ?? [],
    checklistItems,          // raw (old behavior)
    checkedItemIds,          // raw (old behavior)

    // new (Option A support)
    checklistGroups,         // deduped for UI display + has underlying itemIds[]
    checkedGroupLabels,      // convenience for UI

    assignments: assignments ?? [],
  });
}
