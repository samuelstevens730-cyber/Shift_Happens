/**
 * POST /api/checklist/check-item - Mark Checklist Items Complete
 *
 * Records one or more checklist items as completed for a given shift.
 *
 * Request body:
 * - shiftId: string - Shift ID to check items for (required)
 * - qrToken?: string - QR token to validate store ownership (optional)
 * - itemId?: string - Single checklist item ID to mark complete
 * - itemIds?: string[] - Array of checklist item IDs to mark complete
 * (At least one of itemId or itemIds is required)
 *
 * Returns:
 * - Success: { ok: true, checked: number }
 * - Error: { error: string, illegalItemIds?: string[] }
 *
 * Business logic:
 * - Validates shift exists and is not already ended
 * - Validates QR token matches shift's store if provided
 * - "other" shift type has no checklist - checking items is blocked
 * - Validates all item IDs exist in the database
 * - Validates items belong to templates allowed for the shift type:
 *   - "open" shifts: only open template items
 *   - "close" shifts: only close template items
 *   - "double" shifts: both open and close template items
 * - Uses store-specific templates if available, falls back to legacy global templates
 * - Uses upsert to handle duplicate submissions gracefully (idempotent)
 * - Deduplicates input item IDs before processing
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { ShiftType } from "@/lib/kioskRules";

type Body = {
  shiftId: string;
  qrToken?: string;
  // Option A: allow dedupe groups
  itemId?: string;
  itemIds?: string[];
};

type TemplateRow = { id: string; store_id: string | null; shift_type: string };

function templatesForShiftType(st: ShiftType) {
  if (st === "open") return ["open"];
  if (st === "close") return ["close"];
  if (st === "double") return ["open", "close"];
  return [];
}

async function fetchTemplatesForStore(storeId: string, shiftTypes: string[]) {
  const { data: storeTemplates, error: storeErr } = await supabaseServer
    .from("checklist_templates")
    .select("id, store_id, shift_type")
    .eq("store_id", storeId)
    .in("shift_type", shiftTypes)
    .returns<TemplateRow[]>();
  if (storeErr) throw new Error(storeErr.message);
  if (storeTemplates && storeTemplates.length > 0) return storeTemplates;

  const { data: legacyTemplates, error: legacyErr } = await supabaseServer
    .from("checklist_templates")
    .select("id, store_id, shift_type")
    .is("store_id", null)
    .in("shift_type", shiftTypes)
    .returns<TemplateRow[]>();
  if (legacyErr) throw new Error(legacyErr.message);
  return legacyTemplates ?? [];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (!body.shiftId) return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });

    const idsRaw = Array.isArray(body.itemIds) && body.itemIds.length
      ? body.itemIds
      : body.itemId
        ? [body.itemId]
        : [];

    const itemIds = Array.from(new Set(idsRaw.filter(Boolean)));
    if (itemIds.length === 0) {
      return NextResponse.json({ error: "Missing itemId (or itemIds[])." }, { status: 400 });
    }

    // 1) Fetch shift and validate not ended
    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, ended_at, shift_type")
      .eq("id", body.shiftId)
      .maybeSingle();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.ended_at) return NextResponse.json({ error: "Shift already ended." }, { status: 400 });

    if (body.qrToken) {
      // Resolve store by token and validate ownership
      const { data: store, error: storeErr } = await supabaseServer
        .from("stores")
        .select("id")
        .eq("qr_token", body.qrToken)
        .maybeSingle();

      if (storeErr) return NextResponse.json({ error: storeErr.message }, { status: 500 });
      if (!store) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });
      if (shift.store_id !== store.id) return NextResponse.json({ error: "Wrong store." }, { status: 403 });
    }

    const shiftType = shift.shift_type as ShiftType;
    const allowedTemplateTypes = templatesForShiftType(shiftType);

    // "other" has no checklist, so checking items should be blocked
    if (allowedTemplateTypes.length === 0) {
      return NextResponse.json({ error: "This shift type has no checklist." }, { status: 400 });
    }

    // 3) Validate the itemIds are real and belong to allowed templates for this shift type
    let templates: TemplateRow[] = [];
    try {
      templates = await fetchTemplatesForStore(shift.store_id, allowedTemplateTypes);
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load templates." }, { status: 500 });
    }

    const allowedTemplateIds = new Set((templates ?? []).map(t => t.id));
    if (allowedTemplateIds.size === 0) {
      return NextResponse.json({ error: "Checklist templates missing for this shift type." }, { status: 500 });
    }

    const { data: items, error: itemsErr } = await supabaseServer
      .from("checklist_items")
      .select("id, template_id")
      .in("id", itemIds);

    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

    const foundIds = new Set((items ?? []).map(i => i.id));
    const missing = itemIds.filter(id => !foundIds.has(id));
    if (missing.length) {
      return NextResponse.json({ error: `Invalid checklist item(s): ${missing.join(", ")}` }, { status: 400 });
    }

    const illegal = (items ?? []).filter(i => !allowedTemplateIds.has(i.template_id)).map(i => i.id);
    if (illegal.length) {
      return NextResponse.json({ error: "Checklist item not allowed for this shift type.", illegalItemIds: illegal }, { status: 403 });
    }

    // 4) Upsert checks (ignore duplicates)
    const rows = itemIds.map(itemId => ({ shift_id: body.shiftId, item_id: itemId }));

    const { error: upErr } = await supabaseServer
      .from("shift_checklist_checks")
      .upsert(rows, { onConflict: "shift_id,item_id", ignoreDuplicates: true });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, checked: itemIds.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Check failed." }, { status: 500 });
  }
}
