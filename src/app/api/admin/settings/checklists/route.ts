import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = {
  templateId?: string;
  items?: { id?: string; label?: string; sort_order?: number; required?: boolean }[];
};

type TemplateRow = { id: string; store_id: string | null };

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

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as Body;
    const templateId = body.templateId || "";
    if (!templateId) return NextResponse.json({ error: "Missing templateId." }, { status: 400 });

    const { data: templates, error: tplErr } = await supabaseServer
      .from("checklist_templates")
      .select("id, store_id")
      .eq("id", templateId)
      .limit(1)
      .returns<TemplateRow[]>();
    if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 500 });

    const template = (templates ?? [])[0];
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    if (!template.store_id) return NextResponse.json({ error: "Template is not store-specific." }, { status: 400 });

    const managerStoreIds = await getManagerStoreIds(user.id);
    if (!managerStoreIds.includes(template.store_id)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const cleanedItems = rawItems
      .map(item => ({
        id: item.id,
        label: (item.label || "").trim(),
        sort_order: Number.isFinite(item.sort_order) ? Number(item.sort_order) : 0,
        required: Boolean(item.required),
      }))
      .filter(item => item.label.length > 0);

    const keepIds = cleanedItems.filter(i => i.id).map(i => i.id) as string[];

    if (keepIds.length > 0) {
      const quotedIds = keepIds.map(id => `"${id}"`).join(",");
      const { error: deleteErr } = await supabaseServer
        .from("checklist_items")
        .delete()
        .eq("template_id", templateId)
        .not("id", "in", `(${quotedIds})`);
      if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    } else {
      const { error: deleteErr } = await supabaseServer
        .from("checklist_items")
        .delete()
        .eq("template_id", templateId);
      if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    const existingRows = cleanedItems.filter(i => i.id).map(i => ({
      id: i.id,
      template_id: templateId,
      label: i.label,
      sort_order: i.sort_order,
      required: i.required,
    }));

    if (existingRows.length) {
      const { error: upErr } = await supabaseServer
        .from("checklist_items")
        .upsert(existingRows, { onConflict: "id" });
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    const newRows = cleanedItems.filter(i => !i.id).map(i => ({
      template_id: templateId,
      label: i.label,
      sort_order: i.sort_order,
      required: i.required,
    }));

    if (newRows.length) {
      const { error: insertErr } = await supabaseServer
        .from("checklist_items")
        .insert(newRows);
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update checklist." }, { status: 500 });
  }
}
