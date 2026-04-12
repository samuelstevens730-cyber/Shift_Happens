import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest, validateProfileAccess, validateStoreAccess } from "@/lib/shiftAuth";
import { createStoreNotification } from "@/lib/notifications";
import { submitEarlyClockInRequestSchema } from "@/schemas/requests";
import type { ShiftType } from "@/lib/kioskRules";

type ScheduleShiftRow = {
  id: string;
  profile_id: string;
  shift_date: string;
  shift_type: ShiftType;
  shift_mode: string | null;
  scheduled_start: string;
  schedules: { status: string; store_id: string } | { status: string; store_id: string }[] | null;
};

function resolveScheduledShiftType(shiftType: ShiftType, shiftMode: string | null | undefined): ShiftType {
  if (shiftMode === "double" || shiftType === "double") return "double";
  return shiftType;
}

function chicagoToUtcIso(date: string, time: string): string {
  const candidate = new Date(`${date}T${time}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(candidate);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const chicagoAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  const offsetMs = candidate.getTime() - chicagoAsUtc;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wallMs = Date.UTC(y, (mo ?? 1) - 1, d ?? 1, h, mi, 0);
  return new Date(wallMs + offsetMs).toISOString();
}

export async function POST(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = submitEarlyClockInRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const auth = authResult.auth;
  const {
    storeId,
    profileId,
    scheduleShiftId,
    shiftDate,
    requestedPlannedStartAt,
    scheduledStartAt,
  } = parsed.data;

  const profileCheck = validateProfileAccess(auth, profileId);
  if (!profileCheck.ok) {
    return NextResponse.json({ error: profileCheck.error }, { status: 403 });
  }
  if (!validateStoreAccess(auth, storeId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data: scheduleShift, error: scheduleErr } = await supabaseServer
    .from("schedule_shifts")
    .select("id, profile_id, shift_date, shift_type, shift_mode, scheduled_start, schedules!inner(status, store_id)")
    .eq("id", scheduleShiftId)
    .eq("profile_id", profileId)
    .eq("shift_date", shiftDate)
    .eq("schedules.store_id", storeId)
    .eq("schedules.status", "published")
    .maybeSingle<ScheduleShiftRow>();

  if (scheduleErr) {
    return NextResponse.json({ error: scheduleErr.message }, { status: 500 });
  }
  if (!scheduleShift) {
    return NextResponse.json({ error: "Scheduled shift not found." }, { status: 404 });
  }

  const scheduledStartIso = chicagoToUtcIso(scheduleShift.shift_date, scheduleShift.scheduled_start);
  if (scheduledStartIso !== scheduledStartAt) {
    return NextResponse.json({ error: "Scheduled start no longer matches the published schedule." }, { status: 409 });
  }
  if (new Date(requestedPlannedStartAt).getTime() >= new Date(scheduledStartIso).getTime()) {
    return NextResponse.json({ error: "Early approval requests must be earlier than the scheduled start." }, { status: 400 });
  }

  const { data: existingPending, error: existingErr } = await supabaseServer
    .from("early_clock_in_requests")
    .select("id")
    .eq("profile_id", profileId)
    .eq("schedule_shift_id", scheduleShiftId)
    .eq("status", "pending")
    .maybeSingle<{ id: string }>();

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }

  if (existingPending) {
    return NextResponse.json({ requestId: existingPending.id, deduped: true });
  }

  const { data: activeShift } = await supabaseServer
    .from("shifts")
    .select("id")
    .eq("profile_id", profileId)
    .is("ended_at", null)
    .maybeSingle<{ id: string }>();

  if (activeShift) {
    return NextResponse.json({ error: "Employee already has an active shift." }, { status: 409 });
  }

  const requestedShiftType = resolveScheduledShiftType(scheduleShift.shift_type, scheduleShift.shift_mode);
  const { data: inserted, error: insertErr } = await supabaseServer
    .from("early_clock_in_requests")
    .insert({
      store_id: storeId,
      profile_id: profileId,
      schedule_shift_id: scheduleShiftId,
      shift_date: shiftDate,
      requested_planned_start_at: requestedPlannedStartAt,
      scheduled_start_at: scheduledStartIso,
      requested_shift_type: requestedShiftType,
      status: "pending",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") {
      const { data: duplicatePending } = await supabaseServer
        .from("early_clock_in_requests")
        .select("id")
        .eq("profile_id", profileId)
        .eq("schedule_shift_id", scheduleShiftId)
        .eq("status", "pending")
        .maybeSingle<{ id: string }>();
      if (duplicatePending) {
        return NextResponse.json({ requestId: duplicatePending.id, deduped: true });
      }
    }
    console.error("Early clock-in request insert error:", insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const { data: profile } = await supabaseServer
    .from("profiles")
    .select("name")
    .eq("id", profileId)
    .maybeSingle<{ name: string | null }>();

  const created = await createStoreNotification({
    storeId,
    notificationType: "early_clock_in_pending_approval",
    priority: "high",
    title: "Early clock-in request needs approval",
    body: `${profile?.name?.trim() || "An employee"} is requesting to clock in early for their shift.`,
    entityType: "early_clock_in_request",
    entityId: inserted.id,
    createdBy: auth.authType === "manager" ? auth.authUserId : undefined,
  });

  if (!created) {
    console.error("Failed to create early clock-in approval notifications.", { requestId: inserted.id });
  }

  return NextResponse.json({ requestId: inserted.id }, { status: 201 });
}
