// src/app/api/shift/[shiftId]/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ShiftType } from "@/lib/kioskRules";

function templatesForShiftType(st: ShiftType) {
  if (st === "open") return ["open"];
  if (st === "close") return ["close"];
  if (st === "double") return ["open", "close"];
  return [];
}

function normLabel(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET(_req: Request, { params }: { params: { shiftId: string } }) {
  const shiftId = params.shiftId;

  const url = new URL(_req.url);
  const qrToken = url.searchParams.get("t") || "";

  if (!qrToken) return NextResponse.json({ error: "Missing qr token." }, { status: 401 });

  // resolve store by token
  const { data: store, error: storeErr } = await supabaseServer
    .from("stores")
    .select("id, name, expected_drawer_cents")
    .eq("qr_token", qrToken)
    .maybeSingle();

  if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
  if (!store) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });

  // fetch shift
  const { data: shift, error: shiftErr } = await supabaseServer
    .from("shifts")
    .select("id, store_id, profile_id, shift_type, planned_start_at, started_at, ended_at")
    .eq("id", shiftId)
    .maybeSingle();

  if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
  if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
  if (shift.store_id !== store.id)
    return NextResponse.json({ error: "Shift does not belong to this store." }, { status: 403 });

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

  let checklistItems: { id: string; template_id: string; label: string; sort_order: number; required: boolean }[] = [];
  let checks: { item_id: string }[] = [];

  if (neededTemplateTypes.length) {
    const { data: templates, error: tplErr } = await supabaseServer
      .from("checklist_templates")
      .select("id, shift_type, name")
      .in("shift_type", neededTemplateTypes);

    if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 });

    const templateIds = (templates ?? []).map(t => t.id);

    if (templateIds.length) {
      const { data: items, error: itemsErr } = await supabaseServer
        .from("checklist_items")
        .select("id, template_id, label, sort_order, required")
        .in("template_id", templateIds)
        .order("sort_order");

      if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
      checklistItems = (items ?? []) as any;
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
  });
}
