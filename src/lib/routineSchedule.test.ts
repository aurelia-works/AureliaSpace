import { test } from "node:test";
import assert from "node:assert/strict";
import { isDue } from "./routineSchedule.ts";

const base = { id: "r", name: "r", enabled: true, kind: "daily" as const, time: "09:00", minutes: 60, weekdaysOnly: false, account: "", cwd: "", prompt: "go" };
const at = (d: string) => new Date(d).getTime();

test("daily runs once after its time, not before or twice", () => {
  assert.equal(isDue(base, at("2026-10-19T08:00"), at("2026-10-19T08:59")), false);
  assert.equal(isDue(base, at("2026-10-19T08:00"), at("2026-10-19T09:01")), true);
  assert.equal(isDue(base, at("2026-10-19T09:01"), at("2026-10-19T09:30")), false);
});

test("daily missed by hours waits for tomorrow", () => {
  assert.equal(isDue(base, at("2026-10-18T09:00"), at("2026-10-19T13:00")), false);
});

test("weekdays only skips weekends", () => {
  assert.equal(isDue({ ...base, weekdaysOnly: true }, at("2026-10-17T08:00"), at("2026-10-18T09:05")), false); // Sunday
  assert.equal(isDue({ ...base, weekdaysOnly: true }, at("2026-10-18T08:00"), at("2026-10-19T09:05")), true); // Monday
});

test("every N minutes, at least 5", () => {
  const every = { ...base, kind: "every" as const, minutes: 30 };
  assert.equal(isDue(every, 0, 29 * 60_000), false);
  assert.equal(isDue(every, 0, 30 * 60_000), true);
  assert.equal(isDue({ ...every, minutes: 1 }, 0, 60 * 60_000), false);
});

test("disabled or empty never runs", () => {
  assert.equal(isDue({ ...base, enabled: false }, 0, at("2026-10-19T09:01")), false);
  assert.equal(isDue({ ...base, prompt: " " }, 0, at("2026-10-19T09:01")), false);
});
