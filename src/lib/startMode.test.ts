import assert from "node:assert/strict";
import { test } from "node:test";
import { startPermissionMode } from "./startMode.ts";

test("never chosen starts in Auto-edit", () => {
  assert.equal(startPermissionMode(""), "acceptEdits");
  assert.equal(startPermissionMode(undefined), "acceptEdits");
});

test("an explicit choice is kept, and default passes no flag", () => {
  assert.equal(startPermissionMode("plan"), "plan");
  assert.equal(startPermissionMode("default"), undefined);
});
