import { format, parseISO } from "date-fns";
import { classToPdfColors } from "./PdfColorAdapter";
import type { Assignment, MembershipRow, Store, TemplateRow } from "@/app/admin/scheduler/useSchedulerState";

export type ShiftTypeKey = "open" | "close";

export const SHIFT_ROWS: Array<{ key: ShiftTypeKey; label: string }> = [
  { key: "open", label: "AM" },
  { key: "close", label: "PM" },
];

export type ProfileInfo = {
  id: string;
  name: string;
  firstName: string;
};

export type GridCell = {
  key: string;
  profileId: string | null;
  name: string;
  firstName: string;
  start?: string;
  end?: string;
  timeLabel?: string;
  hours: number;
  colorBackground?: string;
  colorText?: string;
  colorBorder?: string;
};

export type GridRow = {
  rowKey: string;
  storeName: string;
  shiftLabel: string;
  cells: GridCell[];
};

export type EmployeeDayRow = {
  date: string;
  label: string;
  store: string;
  timeIn: string;
  timeOut: string;
  totalHours: number;
};

export type EmployeeSection = {
  profileId: string;
  name: string;
  firstName: string;
  rows: EmployeeDayRow[];
  totalHours: number;
};

function toMinutes(timeValue: string) {
  const [h, m] = timeValue.split(":").map(n => Number(n));
  return h * 60 + (m || 0);
}

export function calcHours(start: string, end: string) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  if (e < s) e += 24 * 60;
  return (e - s) / 60;
}

function formatTimeLabel(value?: string) {
  if (!value) return "";
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  if (Number.isNaN(hour)) return value;
  const minute = (rawMinute ?? "00").slice(0, 2);
  const hour12 = ((hour + 11) % 12) + 1;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour12}:${minute} ${suffix}`;
}

function formatCompactTime(value?: string) {
  if (!value) return "";
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  if (Number.isNaN(hour)) return value;
  const minute = (rawMinute ?? "00").slice(0, 2);
  const hour12 = ((hour + 11) % 12) + 1;
  const suffix = hour >= 12 ? "p" : "a";
  return minute === "00" ? `${hour12}${suffix}` : `${hour12}:${minute}${suffix}`;
}

function sortTimesAsc(values: string[]) {
  return [...values].sort((a, b) => toMinutes(a) - toMinutes(b));
}

function latestEndFromAssignments(
  assignments: Array<{ start?: string; end?: string; hours: number }>
) {
  const candidates = assignments
    .filter(entry => entry.start && entry.end)
    .map(entry => {
      const start = toMinutes(entry.start as string);
      let end = toMinutes(entry.end as string);
      if (end < start) end += 24 * 60;
      return { end, rawEnd: entry.end as string };
    })
    .sort((a, b) => a.end - b.end);

  return candidates.length ? candidates[candidates.length - 1].rawEnd : undefined;
}

function dayOfWeek(dateStr: string) {
  const dt = new Date(`${dateStr}T00:00:00`);
  return dt.getDay();
}

function assignmentKey(storeId: string, dateStr: string, shiftType: ShiftTypeKey) {
  return `${storeId}|${dateStr}|${shiftType}`;
}

function findTemplate(templates: TemplateRow[], storeId: string, dateStr: string, shiftType: ShiftTypeKey) {
  const dow = dayOfWeek(dateStr);
  return templates.find(t => t.store_id === storeId && t.day_of_week === dow && t.shift_type === shiftType);
}

function getShiftTiming(
  assignment: Assignment | undefined,
  template: TemplateRow | undefined
): { start?: string; end?: string } {
  if (!assignment) return {};
  if (assignment.shiftMode === "other") {
    return { start: assignment.scheduledStart, end: assignment.scheduledEnd };
  }
  return { start: template?.start_time, end: template?.end_time };
}

function getCombinedTimingForDouble(args: {
  storeId: string;
  dateStr: string;
  profileId: string;
  assignments: Record<string, Assignment>;
  templates: TemplateRow[];
}) {
  const keys: Array<ShiftTypeKey> = ["open", "close"];
  const timings: Array<{ start?: string; end?: string }> = [];
  for (const shiftKey of keys) {
    const key = assignmentKey(args.storeId, args.dateStr, shiftKey);
    const assignment = args.assignments[key];
    if (!assignment?.profileId || assignment.profileId !== args.profileId) continue;
    const template = findTemplate(args.templates, args.storeId, args.dateStr, shiftKey);
    const timing = getShiftTiming(assignment, template);
    if (timing.start && timing.end) timings.push(timing);
  }
  if (!timings.length) return { start: undefined, end: undefined };
  const starts = timings.map(t => t.start as string).sort((a, b) => toMinutes(a) - toMinutes(b));
  const latestEnd = latestEndFromAssignments(timings.map(t => ({ ...t, hours: 0 })));
  return { start: starts[0], end: latestEnd };
}

function firstName(name: string) {
  const base = (name || "").trim();
  if (!base) return "UNASSIGNED";
  return base.split(/\s+/)[0].toUpperCase();
}

export function buildProfileInfo(memberships: MembershipRow[]): ProfileInfo[] {
  const map = new Map<string, ProfileInfo>();
  memberships.forEach(m => {
    const profile = m.profile;
    if (!profile?.id) return;
    if (!map.has(profile.id)) {
      const name = profile.name ?? profile.id.slice(0, 8);
      map.set(profile.id, {
        id: profile.id,
        name,
        firstName: firstName(name),
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function buildGridRows(args: {
  stores: Store[];
  dates: string[];
  assignments: Record<string, Assignment>;
  templates: TemplateRow[];
  profilesById: Record<string, ProfileInfo>;
  colorClassByProfileId: Record<string, string>;
}): GridRow[] {
  const { stores, dates, assignments, templates, profilesById, colorClassByProfileId } = args;
  const rows: GridRow[] = [];

  stores.forEach(store => {
    SHIFT_ROWS.forEach(shift => {
      const cells: GridCell[] = dates.map(dateStr => {
        const key = assignmentKey(store.id, dateStr, shift.key);
        const assignment = assignments[key];
        const profileId = assignment?.profileId ?? null;
        const profile = profileId ? profilesById[profileId] : null;
        const template = findTemplate(templates, store.id, dateStr, shift.key);
        const timing = getShiftTiming(assignment, template);
        const combinedTiming = profileId && assignment?.shiftMode === "double"
          ? getCombinedTimingForDouble({
              storeId: store.id,
              dateStr,
              profileId,
              assignments,
              templates,
            })
          : timing;
        const hours = timing.start && timing.end ? calcHours(timing.start, timing.end) : 0;
        const colors = classToPdfColors(profileId ? colorClassByProfileId[profileId] : undefined);
        const timeLabel = combinedTiming.start && combinedTiming.end
          ? `${formatCompactTime(combinedTiming.start)}-${formatCompactTime(combinedTiming.end)}`
          : "";

        return {
          key,
          profileId,
          name: profile?.name ?? "Unassigned",
          firstName: profile?.firstName ?? "UNASSIGNED",
          start: timing.start,
          end: timing.end,
          timeLabel,
          hours,
          colorBackground: profileId ? colors.background : undefined,
          colorText: profileId ? colors.text : undefined,
          colorBorder: profileId ? colors.border : undefined,
        };
      });

      rows.push({
        rowKey: `${store.id}-${shift.key}`,
        storeName: store.name,
        shiftLabel: shift.label,
        cells,
      });
    });
  });

  return rows;
}

export function buildStoreDailyTotals(rows: GridRow[], dates: string[]) {
  const totals: Record<string, number[]> = {};
  rows.forEach(row => {
    if (!totals[row.storeName]) {
      totals[row.storeName] = new Array(dates.length).fill(0);
    }
    row.cells.forEach((cell, idx) => {
      totals[row.storeName][idx] += cell.hours;
    });
  });
  return totals;
}

export function buildEmployeeStoreTotals(rows: GridRow[], profilesById: Record<string, ProfileInfo>) {
  const out: Record<string, Record<string, number>> = {};
  rows.forEach(row => {
    row.cells.forEach(cell => {
      if (!cell.profileId) return;
      const profile = profilesById[cell.profileId];
      if (!profile) return;
      if (!out[profile.id]) out[profile.id] = {};
      out[profile.id][row.storeName] = (out[profile.id][row.storeName] ?? 0) + cell.hours;
    });
  });
  return out;
}

export function buildEmployeeSections(args: {
  stores: Store[];
  dates: string[];
  assignments: Record<string, Assignment>;
  templates: TemplateRow[];
  profiles: ProfileInfo[];
}): EmployeeSection[] {
  const { stores, dates, assignments, templates, profiles } = args;

  return profiles.map(profile => {
    const rows: EmployeeDayRow[] = dates.map(dateStr => {
      const dayAssignments: Array<{ start?: string; end?: string; hours: number; storeName: string }> = [];

      stores.forEach(store => {
        SHIFT_ROWS.forEach(shift => {
          const key = assignmentKey(store.id, dateStr, shift.key);
          const assignment = assignments[key];
          if (!assignment?.profileId || assignment.profileId !== profile.id) return;
          const template = findTemplate(templates, store.id, dateStr, shift.key);
          const timing = getShiftTiming(assignment, template);
          const hours = timing.start && timing.end ? calcHours(timing.start, timing.end) : 0;
          dayAssignments.push({ start: timing.start, end: timing.end, hours, storeName: store.name });
        });
      });

      const starts = dayAssignments.map(x => x.start).filter(Boolean) as string[];
      const totalHours = dayAssignments.reduce((sum, entry) => sum + entry.hours, 0);
      const earliestStart = starts.length ? sortTimesAsc(starts)[0] : undefined;
      const latestEnd = latestEndFromAssignments(dayAssignments);
      const storesForDay = Array.from(new Set(dayAssignments.map(x => x.storeName)));

      return {
        date: dateStr,
        label: format(parseISO(dateStr), "EEE, MMM d"),
        store: storesForDay.length ? storesForDay.join(", ") : "-",
        timeIn: earliestStart ? formatTimeLabel(earliestStart) : "-",
        timeOut: latestEnd ? formatTimeLabel(latestEnd) : "-",
        totalHours,
      };
    });

    const totalHours = rows.reduce((sum, row) => sum + row.totalHours, 0);
    return {
      profileId: profile.id,
      name: profile.name,
      firstName: profile.firstName,
      rows,
      totalHours,
    };
  });
}

export function periodLabel(periodStart: string, periodEnd: string) {
  return `${format(parseISO(periodStart), "MMM d, yyyy")} - ${format(parseISO(periodEnd), "MMM d, yyyy")}`;
}

export function monthLabel(periodStart: string) {
  return format(parseISO(periodStart), "MMMM yyyy");
}
