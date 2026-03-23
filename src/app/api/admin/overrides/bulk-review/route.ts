import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";

type BulkBody = {
  shiftIds?: string[];
  action?: "approve" | "clear";
  reason?: string;
  note?: string;
};

type ShiftRow = {
  id: string;
  store_id: string;
  requires_override: boolean;
  override_at: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const {
    data: { user },
    error: authErr,
  } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let body: BulkBody;
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shiftIds = Array.from(new Set((body.shiftIds ?? []).filter(isUuid)));
  if (!shiftIds.length) {
    return NextResponse.json({ error: "Select at least one shift." }, { status: 400 });
  }

  const action = body.action;
  if (action !== "approve" && action !== "clear") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const reason = (body.reason ?? "").trim();
  if (!reason) {
    return NextResponse.json({ error: "Review reason is required." }, { status: 400 });
  }

  const note = (body.note ?? "").trim();
  if (action === "approve" && !note) {
    return NextResponse.json({ error: "Approval note is required." }, { status: 400 });
  }

  const { data: shifts, error: shiftErr } = await supabaseServer
    .from("shifts")
    .select("id,store_id,requires_override,override_at")
    .in("id", shiftIds)
    .in("store_id", managerStoreIds)
    .returns<ShiftRow[]>();
  if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });

  const matchingShifts = (shifts ?? []).filter(shift => shift.requires_override && !shift.override_at);
  if (!matchingShifts.length) {
    return NextResponse.json({ error: "No matching scheduled shift variations found." }, { status: 400 });
  }

  const matchedIds = matchingShifts.map(shift => shift.id);
  const now = new Date().toISOString();

  if (action === "approve") {
    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        override_at: now,
        override_by: user.id,
        override_note: note,
      })
      .in("id", matchedIds);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  } else {
    const { error: updateErr } = await supabaseServer
      .from("shifts")
      .update({
        requires_override: false,
        override_at: null,
        override_by: null,
        override_note: null,
      })
      .in("id", matchedIds);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { error: auditErr } = await supabaseServer
    .from("shift_change_audit_logs")
    .insert(
      matchingShifts.map(shift => ({
        shift_id: shift.id,
        store_id: shift.store_id,
        actor_user_id: user.id,
        action: "edit",
        reason,
        metadata: {
          hasOverride: true,
          overrideAction: action,
          bulkReview: true,
          approvalNote: action === "approve" ? note : null,
        },
      }))
    );
  if (auditErr) return NextResponse.json({ error: auditErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, reviewedCount: matchedIds.length, shiftIds: matchedIds });
}
