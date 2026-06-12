import assert from "node:assert/strict";
import test from "node:test";

import { getAutoFocusMinutes, type AutoTimingLog } from "../src/features/pomodoro/autoTiming.ts";

const now = new Date(2026, 5, 12, 10);

function focusTimer(hour: number, overrides: Partial<AutoTimingLog> = {}): AutoTimingLog {
  return {
    completedAt: new Date(2026, 5, 12, hour, 15).toISOString(),
    startAt: new Date(2026, 5, 12, hour).toISOString(),
    mode: "focus",
    ...overrides,
  };
}

test("AI timing starts each workday with 15 and then 20 minutes", () => {
  assert.equal(getAutoFocusMinutes([], 35, now), 15);
  assert.equal(getAutoFocusMinutes([focusTimer(8)], 35, now), 20);
});

test("AI timing uses momentum after the first two focus timers", () => {
  const logs = [focusTimer(8), focusTimer(9)];
  assert.equal(getAutoFocusMinutes(logs, 35, now), 35);
});

test("breaks and manual focus entries do not advance the daily ramp", () => {
  const logs = [
    focusTimer(8, { mode: "short" }),
    focusTimer(9, { isManual: true }),
  ];
  assert.equal(getAutoFocusMinutes(logs, 35, now), 15);
});

test("focus timers from a previous workday do not advance today's ramp", () => {
  const previousDay = focusTimer(8, {
    completedAt: new Date(2026, 5, 11, 8, 15).toISOString(),
    startAt: new Date(2026, 5, 11, 8).toISOString(),
  });
  assert.equal(getAutoFocusMinutes([previousDay], 35, now), 15);
});
