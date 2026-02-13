/**
 * GET /api/admin/settings - Get Store Settings and Checklist Templates
 *
 * Returns store information and checklist templates for the selected store.
 * Automatically creates default checklist templates if none exist for the store.
 *
 * Auth: Bearer token required (manager access via store_managers table)
 *
 * Query params:
 *   - storeId: Store UUID to get settings for (optional, defaults to first managed store)
 *
 * Returns: {
 *   stores: Array of { id, name, expected_drawer_cents } for managed stores,
 *   storeId: The selected/default store UUID (or null if no stores),
 *   templates: Array of {
 *     id: Template UUID,
 *     name: Template name,
 *     shift_type: "open" or "close",
 *     items: Array of {
 *       id: Item UUID,
 *       label: Checklist item text,
 *       sort_order: Display order,
 *       required: Whether item is required
 *     }
 *   }
 * }
 *
 * Business logic:
 *   - Only returns stores the user manages
 *   - If storeId param is invalid or not managed, uses first managed store
 *   - Auto-creates "open" and "close" templates if missing for selected store
 *   - Template creation copies from legacy store_id=NULL templates if they exist
 *   - Falls back to hardcoded DEFAULT_CHECKLISTS if no legacy templates
 *   - Default open checklist: Count Drawer, Case Lights, Clean Glass, Cleaning List Tasks, Changeover
 *   - Default close checklist: Changeover/Count Drawer, Cleaning List Tasks, Clean Glass,
 *     Sweep/Mop/Vacuum, Check Bathroom & Other Supplies, Close Drawer/Fill out Report
 */
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

type StoreRow = {
  id: string;
  name: string;
  expected_drawer_cents: number;
  payroll_variance_warn_hours: number;
  payroll_shift_drift_warn_hours: number;
  sales_rollover_enabled: boolean;
};
type StoreBaseRow = { id: string; name: string; expected_drawer_cents: number };
type StoreSettingsRow = {
  store_id: string;
  payroll_variance_warn_hours: number | null;
  payroll_shift_drift_warn_hours: number | null;
  sales_rollover_enabled: boolean | null;
};
type TemplateRow = { id: string; store_id: string | null; shift_type: string; name: string };
type ItemRow = { id: string; template_id: string; label: string; sort_order: number; required: boolean };

type ChecklistTemplateResponse = {
  id: string;
  name: string;
  shift_type: "open" | "close";
  items: { id: string; label: string; sort_order: number; required: boolean }[];
};

const DEFAULT_CHECKLISTS: Record<
  "open" | "close",
  { name: string; items: { label: string; sort_order: number; required: boolean }[] }
> = {
  open: {
    name: "Open Checklist",
    items: [
      { label: "Count Drawer", sort_order: 1, required: true },
      { label: "Case Lights", sort_order: 2, required: true },
      { label: "Clean Glass", sort_order: 3, required: true },
      { label: "Cleaning List Tasks", sort_order: 4, required: true },
      { label: "Changeover", sort_order: 5, required: true },
    ],
  },
  close: {
    name: "Close Checklist",
    items: [
      { label: "Changeover / Count Drawer", sort_order: 1, required: true },
      { label: "Cleaning List Tasks", sort_order: 2, required: true },
      { label: "Clean Glass", sort_order: 3, required: true },
      { label: "Sweep / Mop / Vacuum", sort_order: 4, required: true },
      { label: "Check Bathroom & Other Supplies", sort_order: 5, required: true },
      { label: "Close Drawer / Fill out Report", sort_order: 6, required: true },
    ],
  },
};

async function ensureTemplatesForStore(storeId: string) {
  const { data: existing, error: existingErr } = await supabaseServer
    .from("checklist_templates")
    .select("id, store_id, shift_type, name")
    .eq("store_id", storeId)
    .in("shift_type", ["open", "close"])
    .returns<TemplateRow[]>();
  if (existingErr) throw new Error(existingErr.message);

  const existingTypes = new Set((existing ?? []).map(t => t.shift_type));
  const missingTypes = (["open", "close"] as const).filter(t => !existingTypes.has(t));

  for (const shiftType of missingTypes) {
    const { data: legacyTemplates, error: legacyErr } = await supabaseServer
      .from("checklist_templates")
      .select("id, name, shift_type")
      .is("store_id", null)
      .eq("shift_type", shiftType)
      .order("created_at", { ascending: true })
      .limit(1)
      .returns<TemplateRow[]>();
    if (legacyErr) throw new Error(legacyErr.message);

    const legacy = (legacyTemplates ?? [])[0] ?? null;
    const fallback = DEFAULT_CHECKLISTS[shiftType];
    const name = legacy?.name ?? fallback.name;

    const { data: created, error: createErr } = await supabaseServer
      .from("checklist_templates")
      .insert({ store_id: storeId, name, shift_type: shiftType })
      .select("id, name, shift_type")
      .returns<TemplateRow[]>();
    if (createErr) throw new Error(createErr.message);
    const createdTemplate = (created ?? [])[0];
    if (!createdTemplate) throw new Error("Failed to create checklist template.");

    let itemsToInsert: { label: string; sort_order: number; required: boolean }[] = [];

    if (legacy) {
      const { data: legacyItems, error: legacyItemsErr } = await supabaseServer
        .from("checklist_items")
        .select("label, sort_order, required")
        .eq("template_id", legacy.id)
        .order("sort_order", { ascending: true })
        .returns<{ label: string; sort_order: number; required: boolean }[]>();
      if (legacyItemsErr) throw new Error(legacyItemsErr.message);
      itemsToInsert = legacyItems ?? [];
    } else {
      itemsToInsert = fallback.items;
    }

    if (itemsToInsert.length) {
      const rows = itemsToInsert.map(it => ({
        template_id: createdTemplate.id,
        label: it.label,
        sort_order: it.sort_order,
        required: it.required,
      }));
      const { error: insertErr } = await supabaseServer
        .from("checklist_items")
        .insert(rows);
      if (insertErr) throw new Error(insertErr.message);
    }
  }
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (managerStoreIds.length === 0) {
      return NextResponse.json({ stores: [], storeId: null, templates: [] });
    }

    const { data: storesBase, error: storesErr } = await supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents")
      .in("id", managerStoreIds)
      .order("name", { ascending: true })
      .returns<StoreBaseRow[]>();
    if (storesErr) return NextResponse.json({ error: storesErr.message }, { status: 500 });

    const { data: settingsRows, error: settingsErr } = await supabaseServer
      .from("store_settings")
      .select("store_id, payroll_variance_warn_hours, payroll_shift_drift_warn_hours, sales_rollover_enabled")
      .in("store_id", managerStoreIds)
      .returns<StoreSettingsRow[]>();
    if (settingsErr) return NextResponse.json({ error: settingsErr.message }, { status: 500 });

    const settingsByStoreId = new Map((settingsRows ?? []).map(r => [r.store_id, r]));
    const stores: StoreRow[] = (storesBase ?? []).map(s => {
      const row = settingsByStoreId.get(s.id);
      return {
        ...s,
        payroll_variance_warn_hours: Number(row?.payroll_variance_warn_hours ?? 2),
        payroll_shift_drift_warn_hours: Number(row?.payroll_shift_drift_warn_hours ?? 2),
        sales_rollover_enabled: row?.sales_rollover_enabled ?? true,
      };
    });

    const url = new URL(req.url);
    const requestedStoreId = url.searchParams.get("storeId");
    const validStoreId = requestedStoreId && managerStoreIds.includes(requestedStoreId)
      ? requestedStoreId
      : (stores ?? [])[0]?.id ?? null;

    if (!validStoreId) {
      return NextResponse.json({ stores: stores ?? [], storeId: null, templates: [] });
    }

    await ensureTemplatesForStore(validStoreId);

    const { data: templates, error: tplErr } = await supabaseServer
      .from("checklist_templates")
      .select("id, store_id, shift_type, name")
      .eq("store_id", validStoreId)
      .in("shift_type", ["open", "close"])
      .returns<TemplateRow[]>();
    if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 });

    const templateIds = (templates ?? []).map(t => t.id);
    let items: ItemRow[] = [];
    if (templateIds.length) {
      const { data: itemRows, error: itemsErr } = await supabaseServer
        .from("checklist_items")
        .select("id, template_id, label, sort_order, required")
        .in("template_id", templateIds)
        .order("sort_order", { ascending: true })
        .returns<ItemRow[]>();
      if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
      items = itemRows ?? [];
    }

    const itemsByTemplate = new Map<string, ChecklistTemplateResponse["items"]>();
    items.forEach(it => {
      const list = itemsByTemplate.get(it.template_id) ?? [];
      list.push({
        id: it.id,
        label: it.label,
        sort_order: it.sort_order,
        required: it.required,
      });
      itemsByTemplate.set(it.template_id, list);
    });

    const templatesResponse: ChecklistTemplateResponse[] = (templates ?? [])
      .filter(t => t.shift_type === "open" || t.shift_type === "close")
      .map(t => ({
        id: t.id,
        name: t.name,
        shift_type: t.shift_type as "open" | "close",
        items: itemsByTemplate.get(t.id) ?? [],
      }))
      .sort((a, b) => a.shift_type.localeCompare(b.shift_type));

    return NextResponse.json({ stores: stores ?? [], storeId: validStoreId, templates: templatesResponse });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load settings." }, { status: 500 });
  }
}
