import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type StoreRow = { id: string; name: string; expected_drawer_cents: number };
type TemplateRow = { id: string; store_id: string | null; shift_type: string; name: string };
type ItemRow = { id: string; template_id: string; label: string; sort_order: number; required: boolean };

type ChecklistTemplateResponse = {
  id: string;
  name: string;
  shift_type: "open" | "close";
  items: { id: string; label: string; sort_order: number; required: boolean }[];
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

    const { data: stores, error: storesErr } = await supabaseServer
      .from("stores")
      .select("id, name, expected_drawer_cents")
      .in("id", managerStoreIds)
      .order("name", { ascending: true })
      .returns<StoreRow[]>();
    if (storesErr) return NextResponse.json({ error: storesErr.message }, { status: 500 });

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
