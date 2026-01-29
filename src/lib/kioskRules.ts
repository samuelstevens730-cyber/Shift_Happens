// src/lib/kioskRules.ts

export type ShiftType = "open" | "close" | "double" | "other";

// You said the drawer should always be around $200
export const DEFAULT_EXPECTED_DRAWER_CENTS = 20000;

// Your rules:
// - Under by > $5  => < 19500
// - Over by > $15  => > 21500
export const UNDER_THRESHOLD_CENTS = 500;   // $5
export const OVER_THRESHOLD_CENTS = 1500;   // $15

export function isOutOfThreshold(actualCents: number, expectedCents: number) {
  return actualCents < expectedCents - UNDER_THRESHOLD_CENTS || actualCents > expectedCents + OVER_THRESHOLD_CENTS;
}

export function thresholdMessage(actualCents: number, expectedCents: number) {
  const under = expectedCents - UNDER_THRESHOLD_CENTS;
  const over = expectedCents + OVER_THRESHOLD_CENTS;

  if (actualCents < under) return "Drawer is UNDER by more than $5. Confirm count + notify manager.";
  if (actualCents > over) return "Drawer is OVER by more than $15. Confirm count + notify manager.";
  return null;
}

// Rounds a Date to 00 or 30 minutes.
// Rules:
// - minutes < 15 => :00
// - minutes < 45 => :30
// - else => next hour :00
export function roundTo30Minutes(d: Date) {
  const nd = new Date(d.getTime());
  const mins = nd.getMinutes();

  if (mins < 15) {
    nd.setMinutes(0, 0, 0);
    return nd;
  }

  if (mins < 45) {
    nd.setMinutes(30, 0, 0);
    return nd;
  }

  nd.setHours(nd.getHours() + 1);
  nd.setMinutes(0, 0, 0);
  return nd;
}
