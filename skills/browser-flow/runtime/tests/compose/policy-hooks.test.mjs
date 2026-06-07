import test from "node:test";
import assert from "node:assert/strict";
import { assertComposeActionAllowed } from "../../scripts/compose/policy-hooks.mjs";

test("public-read mode blocks irreversible actions with policy_blocked", () => {
  assert.throws(
    () => assertComposeActionAllowed({ mode: "public-read", action: { action: "submit", text: "Delete project" } }),
    { message: "policy_blocked" }
  );
});

test("public-read mode allows non-destructive interactive actions", () => {
  assert.doesNotThrow(() => {
    assertComposeActionAllowed({ mode: "public-read", action: { action: "click", text: "Next page" } });
    assertComposeActionAllowed({ mode: "public-read", action: { action: "fill", label: "Search", value: "compose" } });
    assertComposeActionAllowed({ mode: "public-read", action: { action: "submit", text: "Search" } });
  });
});

test("public-read mode blocks actions classified by visible text as irreversible", () => {
  assert.throws(
    () => assertComposeActionAllowed({ mode: "public-read", action: { action: "click", text: "Delete project" } }),
    { message: "policy_blocked" }
  );
});

test("public-read mode blocks clearly irreversible action verbs without visible text", () => {
  assert.throws(
    () => assertComposeActionAllowed({ mode: "public-read", action: { action: "delete" } }),
    { message: "policy_blocked" }
  );
});
