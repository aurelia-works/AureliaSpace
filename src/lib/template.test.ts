import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, templateFields } from "./template.ts";

test("finds each field once, in order", () => {
  assert.deepEqual(templateFields("deploy {{ env }} then tag {{version}} on {{env}}"), ["env", "version"]);
  assert.deepEqual(templateFields("no fields here {not one}"), []);
});

test("fills fields, leaving unknown ones", () => {
  assert.equal(fillTemplate("git checkout -b {{branch}} && echo {{ branch }} {{other}}", { branch: "fix/x" }), "git checkout -b fix/x && echo fix/x {{other}}");
});
