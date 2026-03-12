type ScheduledCoverageRow = {
  shift_date: string;
  scheduled_start: string;
  scheduled_end: string;
};

type ScheduledCoverageWindow = {
  shiftDate: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
};

type ActualCoverageWindow = {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
};

function parseTimeToMinutes(timeValue: string): number | null {
  const parts = timeValue.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour * 60) + minute;
}

function getCstDateParts(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!year || !month || !day || !hour || !minute) return null;
  return {
    dateKey: `${year}-${month}-${day}`,
    minutesOfDay: (Number(hour) * 60) + Number(minute),
  };
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

function normalizeEndMinutes(startMinutes: number, endMinutes: number) {
  return endMinutes >= startMinutes ? endMinutes : endMinutes + (24 * 60);
}

function dayOffsetFromShiftDate(shiftDate: string, valueDateKey: string) {
  const shiftUtc = parseDateKey(shiftDate);
  const valueUtc = parseDateKey(valueDateKey);
  if (shiftUtc == null || valueUtc == null) return null;
  return Math.round((valueUtc - shiftUtc) / (24 * 60 * 60 * 1000));
}

export function collapseScheduledCoverage(rows: ScheduledCoverageRow[]): ScheduledCoverageWindow | null {
  if (!rows.length) return null;
  const shiftDate = rows[0]?.shift_date;
  if (!shiftDate) return null;

  let minStart: number | null = null;
  let maxEnd: number | null = null;

  for (const row of rows) {
    const startMinutes = parseTimeToMinutes(row.scheduled_start);
    const endMinutes = parseTimeToMinutes(row.scheduled_end);
    if (startMinutes == null || endMinutes == null) continue;

    const normalizedEnd = normalizeEndMinutes(startMinutes, endMinutes);
    minStart = minStart == null ? startMinutes : Math.min(minStart, startMinutes);
    maxEnd = maxEnd == null ? normalizedEnd : Math.max(maxEnd, normalizedEnd);
  }

  if (minStart == null || maxEnd == null) return null;

  return {
    shiftDate,
    startMinutes: minStart,
    endMinutes: maxEnd,
    durationMinutes: maxEnd - minStart,
  };
}

export function actualCoverageFromTimes(
  shiftDate: string,
  plannedStartAt: string,
  endAt: string
): ActualCoverageWindow | null {
  const startParts = getCstDateParts(plannedStartAt);
  const endParts = getCstDateParts(endAt);
  if (!startParts || !endParts) return null;

  const startDayOffset = dayOffsetFromShiftDate(shiftDate, startParts.dateKey);
  const endDayOffset = dayOffsetFromShiftDate(shiftDate, endParts.dateKey);
  if (startDayOffset == null || endDayOffset == null) return null;

  const startMinutes = startParts.minutesOfDay + (startDayOffset * 24 * 60);
  let endMinutes = endParts.minutesOfDay + (endDayOffset * 24 * 60);
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }

  return {
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes,
  };
}

