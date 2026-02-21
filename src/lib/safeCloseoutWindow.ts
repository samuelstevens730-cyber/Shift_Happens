import { supabaseServer } from "@/lib/supabaseServer";

type ShiftRow = {
  id: string;
  store_id: string;
  shift_type: "open" | "close" | "double" | "other";
  schedule_shift_id: string | null;
};

type ScheduleShiftRow = {
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
};

export type SafeCloseoutWindowCheck = {
  allowed: boolean;
  reason: string | null;
  allowedFromIso: string | null;
  scheduledEndIso: string | null;
};

function parseTimeToMinutes(value: string): number | null {
  const parts = value.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getCstOffsetMinutes(date: Date): number | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2] || "0");
  return hours * 60 + (hours < 0 ? -mins : mins);
}

function cstLocalDateTimeToUtcMs(dateOnly: string, minutesOfDay: number): number | null {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const approxUtc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), hour, minute, 0));
  const offset = getCstOffsetMinutes(approxUtc);
  if (offset == null) return null;
  return Date.UTC(Number(y), Number(m) - 1, Number(d), hour, minute, 0) - offset * 60000;
}

function addDaysDateOnly(dateOnly: string, days: number): string | null {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatLocalCst(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}

function dayOfWeekFromDateOnly(dateOnly: string): number | null {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0)).getUTCDay();
}

export async function checkSafeCloseoutWindow(shiftId: string): Promise<SafeCloseoutWindowCheck> {
  const { data: shift, error: shiftErr } = await supabaseServer
    .from("shifts")
    .select("id,store_id,shift_type,schedule_shift_id")
    .eq("id", shiftId)
    .maybeSingle<ShiftRow>();
  if (shiftErr) {
    return {
      allowed: false,
      reason: shiftErr.message,
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }
  if (!shift) {
    return {
      allowed: false,
      reason: "Shift not found for safe closeout.",
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }
  if (!(shift.shift_type === "close" || shift.shift_type === "double")) {
    return {
      allowed: false,
      reason: "Safe closeout is only for closing or double shifts at end of day.",
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }
  if (!shift.schedule_shift_id) {
    return {
      allowed: false,
      reason: "Safe closeout requires a scheduled shift end time.",
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }

  const { data: schedule, error: scheduleErr } = await supabaseServer
    .from("schedule_shifts")
    .select("shift_date,scheduled_start,scheduled_end")
    .eq("id", shift.schedule_shift_id)
    .maybeSingle<ScheduleShiftRow>();
  if (scheduleErr) {
    return {
      allowed: false,
      reason: scheduleErr.message,
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }
  if (!schedule) {
    return {
      allowed: false,
      reason: "Scheduled shift data missing.",
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }

  const startMin = parseTimeToMinutes(schedule.scheduled_start);
  const endMin = parseTimeToMinutes(schedule.scheduled_end);
  if (startMin == null || endMin == null) {
    return {
      allowed: false,
      reason: "Scheduled shift time format is invalid.",
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }

  let endDate = schedule.shift_date;
  if (endMin < startMin) {
    const nextDate = addDaysDateOnly(schedule.shift_date, 1);
    if (!nextDate) {
      return {
        allowed: false,
        reason: "Unable to resolve overnight shift end time.",
        allowedFromIso: null,
        scheduledEndIso: null,
      };
    }
    endDate = nextDate;
  }

  let effectiveEndDate = endDate;
  let effectiveEndMin = endMin;

  const shiftDow = dayOfWeekFromDateOnly(schedule.shift_date);
  if (shiftDow != null) {
    const [{ data: rolloverSettings }, { data: rolloverConfig }] = await Promise.all([
      supabaseServer
        .from("store_settings")
        .select("sales_rollover_enabled")
        .eq("store_id", shift.store_id)
        .maybeSingle<{ sales_rollover_enabled: boolean | null }>(),
      supabaseServer
        .from("store_rollover_config")
        .select("has_rollover")
        .eq("store_id", shift.store_id)
        .eq("day_of_week", shiftDow)
        .maybeSingle<{ has_rollover: boolean | null }>(),
    ]);

    const rolloverNight = Boolean(rolloverSettings?.sales_rollover_enabled) && Boolean(rolloverConfig?.has_rollover);
    if (rolloverNight) {
      // On rollover nights, the drawer closeout still happens at 10:00 PM CST.
      // Gate safe closeout 30 minutes before that (9:30 PM CST), regardless of overnight scheduled end.
      effectiveEndDate = schedule.shift_date;
      effectiveEndMin = 22 * 60;
    }
  }

  const scheduledEndMs = cstLocalDateTimeToUtcMs(effectiveEndDate, effectiveEndMin);
  if (scheduledEndMs == null) {
    return {
      allowed: false,
      reason: "Unable to calculate scheduled shift end time.",
      allowedFromIso: null,
      scheduledEndIso: null,
    };
  }

  const allowedFromMs = scheduledEndMs - 30 * 60 * 1000;
  const nowMs = Date.now();
  const allowed = nowMs >= allowedFromMs;
  const scheduledEndIso = new Date(scheduledEndMs).toISOString();
  const allowedFromIso = new Date(allowedFromMs).toISOString();

  if (allowed) {
    return {
      allowed: true,
      reason: null,
      allowedFromIso,
      scheduledEndIso,
    };
  }

  return {
    allowed: false,
    reason: `Safe closeout opens 30 minutes before scheduled end (${formatLocalCst(allowedFromIso)} CST).`,
    allowedFromIso,
    scheduledEndIso,
  };
}
