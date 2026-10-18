import type { Routine } from "./ipc";

/** A daily routine missed by more than this (the app was closed) waits for tomorrow. */
const LATE = 2 * 3_600_000;

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/**
 * Whether a routine should run now, given when it last ran (or when watching began).
 * Pure, so it can be tested without a clock.
 */
export function isDue(r: Routine, lastRun: number, now: number): boolean {
  if (!r.enabled || !r.prompt.trim()) return false;
  const today = new Date(now);
  if (r.weekdaysOnly && isWeekend(today)) return false;
  if (r.kind === "every") return r.minutes >= 5 && now - lastRun >= r.minutes * 60_000;
  const m = /^(\d{1,2}):(\d{2})$/.exec(r.time.trim());
  if (!m) return false;
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), +m[1], +m[2]).getTime();
  return now >= at && now - at <= LATE && lastRun < at;
}
