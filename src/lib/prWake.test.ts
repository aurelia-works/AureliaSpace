import { test } from "node:test";
import assert from "node:assert/strict";
import { kickoffText, prAction } from "./prWake.ts";
import type { PrInfo } from "./ipc";

const pr = (over: Partial<PrInfo> = {}): PrInfo => ({
  number: 7,
  url: "https://github.com/o/r/pull/7",
  title: "t",
  state: "OPEN",
  draft: false,
  review: "",
  conflicts: false,
  checks: "pending",
  failing: [],
  feedback: 0,
  ...over,
});

test("a check turning red wakes the agent with its name", () => {
  const a = prAction(pr(), pr({ checks: "fail", failing: ["test"] }), true);
  assert.equal(a.kind, "wake");
  assert.match(a.kind === "wake" ? a.text : "", /PR #7 .*checks failed \(test\)/);
});

test("a failure already seen doesn't wake again", () => {
  const red = pr({ checks: "fail", failing: ["test"] });
  assert.deepEqual(prAction(red, red, true), { kind: "none" });
});

test("new comments, requested changes and conflicts each wake", () => {
  assert.match((prAction(pr(), pr({ feedback: 2 }), true) as { text: string }).text, /2 new review comments/);
  assert.match((prAction(pr(), pr({ review: "CHANGES_REQUESTED", feedback: 1 }), true) as { text: string }).text, /requested changes/);
  assert.match((prAction(pr(), pr({ conflicts: true }), true) as { text: string }).text, /conflicts/);
});

test("nothing wakes when babysitting is off, on first sight, or for a closed PR", () => {
  assert.equal(prAction(pr(), pr({ checks: "fail", failing: ["x"] }), false).kind, "none");
  assert.equal(prAction(undefined, pr({ checks: "fail", failing: ["x"] }), true).kind, "none");
  assert.equal(prAction(pr(), pr({ state: "CLOSED", feedback: 3 }), true).kind, "none");
});

test("a merge settles the thread, babysat or not, but only once", () => {
  assert.equal(prAction(pr(), pr({ state: "MERGED" }), false).kind, "settle");
  assert.equal(prAction(pr({ state: "MERGED" }), pr({ state: "MERGED" }), false).kind, "none");
});

test("kickoff opens a PR when there is none and lists current problems otherwise", () => {
  assert.match(kickoffText(null) ?? "", /gh pr create --fill/);
  assert.match(kickoffText(pr({ checks: "fail", failing: ["lint"], conflicts: true })) ?? "", /checks failed \(lint\); the branch conflicts/);
  assert.equal(kickoffText(pr({ checks: "pass" })), null);
});
