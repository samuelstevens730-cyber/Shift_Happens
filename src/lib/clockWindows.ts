/**
 * Clock window rules for LV1/LV2.
 *
 * IMPORTANT:
 * - All comparisons are in America/Chicago.
 * - Use the entered time (rounded) to derive DOW and window eligibility.
 * - LV2 Fri/Sat close window crosses midnight (23:50-00:15) and must allow
 *   early AM minutes as part of the previous day close window.
 */

export type WindowShiftType = "open" | "close";

type WindowRule = {
  storeKey: "LV1" | "LV2";
  shiftType: WindowShiftType;
  dow: number; // 0=Sun..6=Sat (America/Chicago local)
  startMin: number; // minutes from midnight (may be > end for cross-midnight)
  endMin: number; // minutes from midnight
  label: string; // human label for UI
  crossesMidnight?: boolean;
};

const OPEN_9 = { startMin: 8 * 60 + 55, endMin: 9 * 60 + 5 };
const OPEN_12 = { startMin: 11 * 60 + 55, endMin: 12 * 60 + 5 };

const CLOSE_9 = { startMin: 20 * 60 + 50, endMin: 21 * 60 + 15 };
const CLOSE_10 = { startMin: 21 * 60 + 50, endMin: 22 * 60 + 15 };
const CLOSE_12_CROSS = { startMin: 23 * 60 + 50, endMin: 0 * 60 + 15 };

export const CLOCK_WINDOW_RULES: WindowRule[] = [
  // OPEN windows (LV1, LV2)
  // Mon-Sat 9:00 AM open
  ...[1, 2, 3, 4, 5, 6].flatMap(dow => ([
    { storeKey: "LV1", shiftType: "open", dow, ...OPEN_9, label: "Open window 8:55-9:05 AM CST" },
    { storeKey: "LV2", shiftType: "open", dow, ...OPEN_9, label: "Open window 8:55-9:05 AM CST" },
  ] as WindowRule[])),
  // Sunday 12:00 PM open
  { storeKey: "LV1", shiftType: "open", dow: 0, ...OPEN_12, label: "Open window 11:55-12:05 PM CST" },
  { storeKey: "LV2", shiftType: "open", dow: 0, ...OPEN_12, label: "Open window 11:55-12:05 PM CST" },

  // CLOSE windows (LV1)
  { storeKey: "LV1", shiftType: "close", dow: 1, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Mon
  { storeKey: "LV1", shiftType: "close", dow: 2, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Tue
  { storeKey: "LV1", shiftType: "close", dow: 3, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Wed
  { storeKey: "LV1", shiftType: "close", dow: 4, ...CLOSE_10, label: "Close window 9:50-10:15 PM CST" }, // Thu
  { storeKey: "LV1", shiftType: "close", dow: 5, ...CLOSE_10, label: "Close window 9:50-10:15 PM CST" }, // Fri
  { storeKey: "LV1", shiftType: "close", dow: 6, ...CLOSE_10, label: "Close window 9:50-10:15 PM CST" }, // Sat
  { storeKey: "LV1", shiftType: "close", dow: 0, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Sun

  // CLOSE windows (LV2)
  { storeKey: "LV2", shiftType: "close", dow: 1, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Mon
  { storeKey: "LV2", shiftType: "close", dow: 2, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Tue
  { storeKey: "LV2", shiftType: "close", dow: 3, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Wed
  { storeKey: "LV2", shiftType: "close", dow: 4, ...CLOSE_10, label: "Close window 9:50-10:15 PM CST" }, // Thu
  { storeKey: "LV2", shiftType: "close", dow: 5, ...CLOSE_12_CROSS, label: "Close window 11:50 PM-12:15 AM CST", crossesMidnight: true }, // Fri
  { storeKey: "LV2", shiftType: "close", dow: 6, ...CLOSE_12_CROSS, label: "Close window 11:50 PM-12:15 AM CST", crossesMidnight: true }, // Sat
  { storeKey: "LV2", shiftType: "close", dow: 0, ...CLOSE_9, label: "Close window 8:50-9:15 PM CST" }, // Sun
];

const DOW_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function toStoreKey(storeName: string | null | undefined): "LV1" | "LV2" | null {
  if (!storeName) return null;
  const norm = storeName.trim().toUpperCase();
  if (norm.startsWith("LV1")) return "LV1";
  if (norm.startsWith("LV2")) return "LV2";
  return null;
}

export function getCstDowMinutes(dt: Date): { dow: number; minutes: number } | null {
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const weekday = parts.find(p => p.type === "weekday")?.value;
  const hourStr = parts.find(p => p.type === "hour")?.value;
  const minuteStr = parts.find(p => p.type === "minute")?.value;
  if (!weekday || hourStr == null || minuteStr == null) return null;
  const dow = DOW_MAP[weekday];
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || dow == null) return null;
  return { dow, minutes: hour * 60 + minute };
}

export function isTimeWithinWindow(args: {
  storeKey: "LV1" | "LV2";
  shiftType: WindowShiftType;
  localDow: number; // 0=Sun..6=Sat, derived from entered CST time
  minutes: number; // minutes from midnight, CST
}): { ok: boolean; windowLabel: string } {
  const { storeKey, shiftType, localDow, minutes } = args;
  const rules = CLOCK_WINDOW_RULES.filter(r => r.storeKey === storeKey && r.shiftType === shiftType);

  for (const r of rules) {
    // Standard window: start <= minutes <= end
    if (!r.crossesMidnight && r.dow === localDow) {
      if (minutes >= r.startMin && minutes <= r.endMin) {
        return { ok: true, windowLabel: r.label };
      }
    }

    // Cross-midnight window: allow late-night minutes on r.dow
    if (r.crossesMidnight && r.dow === localDow) {
      if (minutes >= r.startMin || minutes <= r.endMin) {
        return { ok: true, windowLabel: r.label };
      }
    }

    // Cross-midnight early AM minutes belong to previous day
    if (r.crossesMidnight) {
      const prevDow = (r.dow + 1) % 7; // if r.dow is Fri(5), early AM is Sat(6)
      if (prevDow === localDow && minutes <= r.endMin) {
        return { ok: true, windowLabel: r.label };
      }
    }
  }

  // Fallback label for UI clarity (prefer label for the local DOW)
  const label =
    rules.find(r => r.dow === localDow)?.label ||
    rules.find(r => r.crossesMidnight && (r.dow + 1) % 7 === localDow)?.label ||
    rules[0]?.label ||
    "Outside allowed clock window";
  return { ok: false, windowLabel: label };
}
