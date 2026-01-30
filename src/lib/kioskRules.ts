/**
 * Kiosk Rules - Drawer Variance Thresholds & Time Rounding
 *
 * Core business logic for drawer count validation and payroll time calculations.
 * Used by clock-in/out flows to detect when drawer amounts are outside acceptable range,
 * and by payroll export to round shift times to 30-minute increments.
 */

// src/lib/kioskRules.ts

export type ShiftType = "open" | "close" | "double" | "other";

// Default expected drawer amount - can be overridden per store in settings
export const DEFAULT_EXPECTED_DRAWER_CENTS = 20000;

// Variance thresholds - asymmetric because being over is less concerning than being under
// Under by >$5 triggers alert (possible theft/error)
// Over by >$15 triggers alert (possible unreported deposit)
export const UNDER_THRESHOLD_CENTS = 500;   // $5
export const OVER_THRESHOLD_CENTS = 1500;   // $15

/**
 * Checks if drawer count is outside acceptable variance range.
 * Returns true if count requires manager review/notification.
 */
export function isOutOfThreshold(actualCents: number, expectedCents: number) {
  return actualCents < expectedCents - UNDER_THRESHOLD_CENTS || actualCents > expectedCents + OVER_THRESHOLD_CENTS;
}

/**
 * Generates user-facing message when drawer is out of threshold.
 * Returns null if count is within acceptable range.
 */
export function thresholdMessage(actualCents: number, expectedCents: number) {
  const under = expectedCents - UNDER_THRESHOLD_CENTS;
  const over = expectedCents + OVER_THRESHOLD_CENTS;

  if (actualCents < under) return "Drawer is UNDER by more than $5. Confirm count + notify manager.";
  if (actualCents > over) return "Drawer is OVER by more than $15. Confirm count + notify manager.";
  return null;
}

/**
 * Rounds time to nearest 30-minute increment for payroll calculations.
 * Standard rounding: <15 min → :00, 15-44 min → :30, ≥45 min → next hour :00
 */
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
