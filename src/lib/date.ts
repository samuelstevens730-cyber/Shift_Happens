/**
 * Date Utilities
 *
 * Helper functions for date formatting, primarily for HTML datetime-local inputs.
 */

/**
 * Formats a Date for HTML datetime-local input value.
 * Returns format: "YYYY-MM-DDTHH:MM" (no seconds/timezone, local time)
 */
export function toLocalInputValue(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}
