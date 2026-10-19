import assert from "node:assert/strict";
import { test } from "node:test";
import { pickSound } from "./soundPick.ts";

const cfg = {
  events: { finished: "marimba", needsHelp: "glass" },
  projects: {
    "/dev/mod": { finished: "lantern" },
    "/dev/mod/deep": { finished: "off" },
  },
};

test("falls back to the default without a config", () => {
  assert.equal(pickSound(undefined, "finished", "pebble", "/dev/mod"), "pebble");
});

test("a project's own choice beats the global one", () => {
  assert.equal(pickSound(cfg, "finished", "x", "/dev/mod/src"), "lantern");
});

test("the deepest matching folder wins, and off is a real choice", () => {
  assert.equal(pickSound(cfg, "finished", "x", "/dev/mod/deep/a"), "off");
});

test("events a project doesn't set use the global sound", () => {
  assert.equal(pickSound(cfg, "needsHelp", "x", "/dev/mod"), "glass");
});

test("a sibling folder with a shared prefix doesn't match", () => {
  assert.equal(pickSound(cfg, "finished", "x", "/dev/module"), "marimba");
});
