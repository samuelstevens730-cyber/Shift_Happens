import test from "node:test";
import assert from "node:assert/strict";
import { getCstDowMinutes, isTimeWithinWindow } from "../src/lib/clockWindows";

function check(storeKey: "LV1" | "LV2", shiftType: "open" | "close", iso: string) {
  const dt = new Date(iso);
  const cst = getCstDowMinutes(dt);
  assert.ok(cst, "CST conversion failed");
  return isTimeWithinWindow({ storeKey, shiftType, localDow: cst.dow, minutes: cst.minutes });
}

test("LV1 Mon open window edges", () => {
  assert.equal(check("LV1", "open", "2026-01-05T14:54:00Z").ok, false);
  assert.equal(check("LV1", "open", "2026-01-05T14:55:00Z").ok, true);
  assert.equal(check("LV1", "open", "2026-01-05T15:05:00Z").ok, true);
  assert.equal(check("LV1", "open", "2026-01-05T15:06:00Z").ok, false);
});

test("LV1 Thu close window", () => {
  assert.equal(check("LV1", "close", "2026-01-09T04:10:00Z").ok, true);
  assert.equal(check("LV1", "close", "2026-01-09T04:30:00Z").ok, false);
});

test("LV2 Fri/Sat close window crosses midnight", () => {
  assert.equal(check("LV2", "close", "2026-01-10T05:55:00Z").ok, true); // Fri 11:55 PM CST
  assert.equal(check("LV2", "close", "2026-01-10T06:10:00Z").ok, true); // Sat 12:10 AM CST
  assert.equal(check("LV2", "close", "2026-01-10T06:16:00Z").ok, false); // Sat 12:16 AM CST
});
