import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";

type Body = {
  shiftId?: string;
  scheduleId?: string;
  cleaningTaskId?: string;
  cleaningShiftType?: "am" | "pm";
};

type ShiftLookupRow = {
  id: string;
  store_id: string;
  started_at: string | null;
};

function getCstDayOfWeek(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).format(dt);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

export async function POST(req: Request) {
  try {
    const authResult = await authenticateShiftRequest(req);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = (await req.json()) as Body;
    if (!body.shiftId) {
      return NextResponse.json({ error: "Missing shiftId." }, { status: 400 });
    }

    let resolvedScheduleId = body.scheduleId ?? null;

    if (body.cleaningTaskId && body.cleaningShiftType) {
      const { data: shift, error: shiftErr } = await supabaseServer
        .from("shifts")
        .select("id, store_id, started_at")
        .eq("id", body.shiftId)
        .maybeSingle<ShiftLookupRow>();
      if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });
      if (!shift?.started_at) {
        return NextResponse.json({ error: "Shift not found or missing start time." }, { status: 400 });
      }

      const dayOfWeek = getCstDayOfWeek(shift.started_at);
      if (dayOfWeek == null || dayOfWeek < 0) {
        return NextResponse.json({ error: "Unable to resolve cleaning schedule day." }, { status: 400 });
      }

      const { data: cleaningSchedule, error: scheduleErr } = await supabaseServer
        .from("store_cleaning_schedules")
        .select("id")
        .eq("store_id", shift.store_id)
        .eq("cleaning_task_id", body.cleaningTaskId)
        .eq("day_of_week", dayOfWeek)
        .eq("shift_type", body.cleaningShiftType)
        .eq("is_required", true)
        .maybeSingle<{ id: string }>();
      if (scheduleErr) return NextResponse.json({ error: scheduleErr.message }, { status: 500 });
      if (!cleaningSchedule) {
        return NextResponse.json({ error: "Cleaning schedule not found." }, { status: 400 });
      }
      resolvedScheduleId = cleaningSchedule.id;
    }

    if (!resolvedScheduleId) {
      return NextResponse.json({ error: "Missing cleaning schedule identifier." }, { status: 400 });
    }

    const { data, error } = await supabaseServer.rpc("complete_cleaning_task", {
      p_actor_profile_id: authResult.auth.profileId,
      p_shift_id: body.shiftId,
      p_schedule_id: resolvedScheduleId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: Boolean(data) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to complete cleaning task." }, { status: 500 });
  }
}
