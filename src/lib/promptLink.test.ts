import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePromptLink } from "./promptLink.ts";

test("reads the prompt, folder and account", () => {
  assert.deepEqual(parsePromptLink("aureliaspace://new?prompt=fix%20the%20build&cwd=%2FUsers%2Fme%2Fapp&account=claude-a"), {
    prompt: "fix the build",
    cwd: "/Users/me/app",
    account: "claude-a",
  });
});

test("accepts both verbs and the short form", () => {
  assert.equal(parsePromptLink("aureliaspace://prompt?prompt=hi")?.prompt, "hi");
  assert.equal(parsePromptLink("aureliaspace:new?prompt=hi")?.prompt, "hi");
  assert.equal(parsePromptLink("aureliaspace://new/?prompt=a+b")?.prompt, "a b");
});

test("keeps newlines in the prompt", () => {
  assert.equal(parsePromptLink("aureliaspace://new?prompt=one%0Atwo")?.prompt, "one\ntwo");
});

test("rejects other schemes, verbs and empty prompts", () => {
  assert.equal(parsePromptLink("https://new?prompt=hi"), null);
  assert.equal(parsePromptLink("aureliaspace://run?prompt=hi"), null);
  assert.equal(parsePromptLink("aureliaspace://new?prompt=%20%20"), null);
  assert.equal(parsePromptLink("not a url"), null);
});

test("drops relative folders", () => {
  assert.equal(parsePromptLink("aureliaspace://new?prompt=hi&cwd=..%2Fx")?.cwd, undefined);
  assert.equal(parsePromptLink("aureliaspace://new?prompt=hi&cwd=~%2Fcode")?.cwd, "~/code");
});
