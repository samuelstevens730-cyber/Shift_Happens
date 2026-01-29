// src/app/api/end-shift/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isOutOfThreshold, roundTo30Minutes, ShiftType } from "@/lib/kioskRules";

type Body = {
  qrToken?: string;
  shiftId: string;
  endAt: string; // ISO
  endDrawerCents?: number | null; // optional for "other" if you want
  confirmed?: boolean;
  notifiedManager?: boolean;
  note?: string | null;
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
    if (!body.endAt) return NextResponse.json({ error: "Missing endAt." }, { status: 400 });

    const { data: shift, error: shiftErr } = await supabaseServer
      .from("shifts")
      .select("id, store_id, shift_type, ended_at")
      .eq("id", body.shiftId)
      .maybeSingle();

    if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
    if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    if (shift.ended_at) return NextResponse.json({ error: "Shift already ended." }, { status: 400 });

    let store: { id: string; expected_drawer_cents: number } | null = null;

    if (body.qrToken) {
      const { data: storeByToken } = await supabaseServer
        .from("stores")
        .select("id, expected_drawer_cents")
        .eq("qr_token", body.qrToken)
        .maybeSingle();
      if (!storeByToken) return NextResponse.json({ error: "Invalid QR token." }, { status: 401 });
      if (shift.store_id !== storeByToken.id) return NextResponse.json({ error: "Wrong store." }, { status: 403 });
      store = storeByToken;
    } else {
      const { data: storeById } = await supabaseServer
        .from("stores")
        .select("id, expected_drawer_cents")
        .eq("id", shift.store_id)
        .maybeSingle();
      if (!storeById) return NextResponse.json({ error: "Store not found." }, { status: 404 });
      store = storeById;
    }

    const { data: pendingAssignments, error: assignErr } = await supabaseServer
      .from("shift_assignments")
      .select("id,type,acknowledged_at,completed_at")
      .eq("delivered_shift_id", body.shiftId)
      .returns<{ id: string; type: "task" | "message"; acknowledged_at: string | null; completed_at: string | null }[]>();
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

    const hasPending = (pendingAssignments ?? []).some(a =>
      (a.type === "message" && !a.acknowledged_at) ||
      (a.type === "task" && !a.completed_at)
    );
    if (hasPending) {
      return NextResponse.json(
        { error: "Pending messages or tasks must be completed before clock out." },
        { status: 400 }
      );
    }

    const shiftType = shift.shift_type as ShiftType;

    // 1) Enforce checklist required items (per your v1 rule: cannot clock out until required items are checked)
    const neededTemplateTypes = templatesForShiftType(shiftType);

    if (neededTemplateTypes.length) {
      let templates: TemplateRow[] = [];
      try {
        templates = await fetchTemplatesForStore(shift.store_id, neededTemplateTypes);
      } catch (e: unknown) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load templates." }, { status: 500 });
      }

      const templateIds = (templates ?? []).map(t => t.id);
      if (templateIds.length) {
        const { data: requiredItems, error: itemsErr } = await supabaseServer
          .from("checklist_items")
          .select("id")
          .in("template_id", templateIds)
          .eq("required", true);
        if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

        const requiredIds = new Set((requiredItems ?? []).map(i => i.id));

        const { data: doneRows, error: doneErr } = await supabaseServer
          .from("shift_checklist_checks")
          .select("item_id")
          .eq("shift_id", body.shiftId);
        if (doneErr) return NextResponse.json({ error: doneErr.message }, { status: 500 });

        const doneSet = new Set((doneRows ?? []).map(r => r.item_id));
        const missing = Array.from(requiredIds).filter(id => !doneSet.has(id));

        if (missing.length) {
          return NextResponse.json(
            { error: "Missing required checklist items.", missingItemCount: missing.length, missing },
            { status: 400 }
          );
        }
      }
    }

    // 2) Insert END drawer count if required
    const endCents = body.endDrawerCents ?? null;

    if (shiftType !== "other") {
      if (endCents === null || endCents === undefined) {
        return NextResponse.json({ error: "Missing end drawer count." }, { status: 400 });
      }
      const out = isOutOfThreshold(endCents, store.expected_drawer_cents);
      if (out && !body.confirmed) {
        return NextResponse.json({ error: "End drawer outside threshold. Must confirm.", requiresConfirm: true }, { status: 400 });
      }

      const { error: endCountErr } = await supabaseServer
        .from("shift_drawer_counts")
        .upsert(
          {
            shift_id: body.shiftId,
            count_type: "end",
            drawer_cents: endCents,
            confirmed: Boolean(body.confirmed),
            notified_manager: Boolean(body.notifiedManager),
            note: body.note ?? null,
          },
          { onConflict: "shift_id,count_type" }
        );

      if (endCountErr) return NextResponse.json({ error: endCountErr.message }, { status: 500 });
    } else if (endCents !== null && endCents !== undefined) {
      // optional for other
      const { error: endCountErr } = await supabaseServer
        .from("shift_drawer_counts")
        .upsert(
          {
            shift_id: body.shiftId,
            count_type: "end",
            drawer_cents: endCents,
            confirmed: Boolean(body.confirmed),
            notified_manager: Boolean(body.notifiedManager),
            note: body.note ?? null,
          },
          { onConflict: "shift_id,count_type" }
        );
      if (endCountErr) return NextResponse.json({ error: endCountErr.message }, { status: 500 });
    }

    // 3) Round end time, set ended_at
    const endAt = new Date(body.endAt);
    if (Number.isNaN(endAt.getTime())) return NextResponse.json({ error: "Invalid endAt." }, { status: 400 });
    const endRounded = roundTo30Minutes(endAt);

    const { error: endShiftErr } = await supabaseServer
      .from("shifts")
      .update({ ended_at: endRounded.toISOString() })
      .eq("id", body.shiftId);

    // NOTE: DB trigger enforces drawer counts for open/close/double at this point.
    if (endShiftErr) return NextResponse.json({ error: endShiftErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "End shift failed." }, { status: 500 });
  }
}
