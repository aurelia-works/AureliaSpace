import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrInfo } from "./ipc";
import { chainText, matchesFilter, prAttention, snoozeChoices } from "./threads.ts";

const pr = (over: Partial<PrInfo> = {}): PrInfo => ({
  number: 7, url: "u", title: "t", state: "OPEN", draft: false, review: "", conflicts: false, checks: "pass", failing: [], feedback: 0, ...over,
});

test("snooze menu offers this evening only before 5 pm, and mornings at 9", () => {
  const afternoon = new Date(2026, 9, 26, 14, 30); // Monday
  const labels = snoozeChoices(afternoon).map((c) => c.label);
  assert.deepEqual(labels, ["1 hour", "3 hours", "This evening", "Tomorrow morning", "Next week"]);
  const byLabel = Object.fromEntries(snoozeChoices(afternoon).map((c) => [c.label, new Date(c.until)]));
  assert.equal(byLabel["This evening"].getHours(), 18);
  assert.equal(byLabel["Tomorrow morning"].getDate(), 27);
  assert.equal(byLabel["Tomorrow morning"].getHours(), 9);
  // Today is Monday, so next week is the following Monday.
  assert.equal(byLabel["Next week"].getDay(), 1);
  assert.equal(byLabel["Next week"].getDate(), 2);

  const night = snoozeChoices(new Date(2026, 9, 31, 22, 0)); // Saturday
  assert.ok(!night.some((c) => c.label === "This evening"));
  assert.equal(new Date(night.at(-1)!.until).getDate(), 2); // Monday Nov 2
});

test("a PR needs you on failed checks, conflicts, requested changes or unseen comments", () => {
  assert.equal(prAttention(null), null);
  assert.equal(prAttention(pr()), null);
  assert.equal(prAttention(pr({ checks: "fail", failing: ["test"] })), "checks failed: test");
  assert.equal(prAttention(pr({ conflicts: true })), "conflicts with its base");
  assert.equal(prAttention(pr({ review: "CHANGES_REQUESTED" })), "changes requested");
  assert.equal(prAttention(pr({ feedback: 3 }), 1), "2 new review comments");
  assert.equal(prAttention(pr({ feedback: 3 }), 3), null);
  assert.equal(prAttention(pr({ state: "MERGED", checks: "fail" })), null);
});

test("filter matches every word across fields", () => {
  assert.ok(matchesFilter("", ["x"]));
  assert.ok(matchesFilter("web a11y", ["Fix tabbing", "web", "feat/settings-a11y"]));
  assert.ok(!matchesFilter("web payments", ["Fix tabbing", "web"]));
});

test("chain message names the finished thread and caps its reply", () => {
  assert.equal(chainText("api", undefined, "Now write the docs."), 'Thread "api" finished.\n\nNow write the docs.');
  const long = chainText("api", "x".repeat(2000), "");
  assert.ok(long.endsWith("…"));
  assert.ok(long.length < 1600);
});
