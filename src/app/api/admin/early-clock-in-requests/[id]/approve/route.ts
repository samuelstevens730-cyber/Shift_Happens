import { NextResponse } from "next/server";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
import { supabaseServer } from "@/lib/supabaseServer";
import { createNotification } from "@/lib/notifications";
import { reviewEarlyClockInRequestSchema } from "@/schemas/requests";
import type { ShiftType } from "@/lib/kioskRules";

type EarlyClockInRequestRow = {
  id: string;
  store_id: string;
  profile_id: string;
  schedule_shift_id: string;
  requested_shift_type: ShiftType;
  status: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const {
    data: { user },
    error: authErr,
  } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (!managerStoreIds.length) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = reviewEarlyClockInRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const { data: requestRow, error: fetchErr } = await supabaseServer
    .from("early_clock_in_requests")
    .select("id, store_id, profile_id, schedule_shift_id, requested_shift_type, status")
    .eq("id", id)
    .maybeSingle<EarlyClockInRequestRow>();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!requestRow) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!managerStoreIds.includes(requestRow.store_id)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (requestRow.status !== "pending") {
    return NextResponse.json({ error: "Request already resolved." }, { status: 409 });
  }

  const { managerPlannedStartAt, managerStartedAt } = parsed.data;
  if (new Date(managerStartedAt).getTime() < new Date(managerPlannedStartAt).getTime()) {
    return NextResponse.json({ error: "Actual start cannot be earlier than planned start." }, { status: 400 });
  }

  const { data: activeShift } = await supabaseServer
    .from("shifts")
    .select("id")
    .eq("profile_id", requestRow.profile_id)
    .is("ended_at", null)
    .maybeSingle<{ id: string }>();

  if (activeShift) {
    return NextResponse.json({ error: "Employee already has an active shift." }, { status: 409 });
  }

  const { data: insertedShift, error: shiftErr } = await supabaseServer
    .from("shifts")
    .insert({
      store_id: requestRow.store_id,
      profile_id: requestRow.profile_id,
      shift_type: requestRow.requested_shift_type,
      schedule_shift_id: requestRow.schedule_shift_id,
      shift_source: "scheduled",
      requires_override: false,
      override_note: null,
      planned_start_at: managerPlannedStartAt,
      started_at: managerStartedAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (shiftErr) {
    return NextResponse.json({ error: shiftErr.message }, { status: 500 });
  }

  const { error: updateErr } = await supabaseServer
    .from("early_clock_in_requests")
    .update({
      status: "approved",
      manager_planned_start_at: managerPlannedStartAt,
      manager_started_at: managerStartedAt,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) {
    await supabaseServer.from("shifts").delete().eq("id", insertedShift.id);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const created = await createNotification({
    recipientProfileId: requestRow.profile_id,
    sourceStoreId: requestRow.store_id,
    notificationType: "early_clock_in_approved",
    priority: "high",
    title: "Early clock-in request approved",
    body: "Your early clock-in request has been approved. Your shift is now active and ready on the home screen.",
    entityType: "early_clock_in_request",
    entityId: requestRow.id,
    createdBy: user.id,
  });

  if (!created) {
    console.error("Failed to create early clock-in approval notification.", { requestId: requestRow.id });
  }

  return NextResponse.json({ ok: true, shiftId: insertedShift.id });
}
