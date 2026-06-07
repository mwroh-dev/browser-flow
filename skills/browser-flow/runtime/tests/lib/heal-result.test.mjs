import test from "node:test";
import assert from "node:assert/strict";
import { parseHealResult } from "../../scripts/lib/schemas.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

test("parseHealResult accepts a healed result", () => {
  const r = parseHealResult(
    {
      schemaVersion: SCHEMA_VERSIONS.healResult,
      runId: "r1",
      status: "healed",
      healedLocators: [
        {
          match: { structuralKey: "old-key" },
          locator: { role: "button", name: "Save", structuralKey: "new-key" }
        }
      ]
    },
    "<test>"
  );
  assert.equal(r.status, "healed");
  assert.ok(r.healedLocators && r.healedLocators[0].match.structuralKey === "old-key");
});

test("parseHealResult accepts partial-incomplete with a reason", () => {
  const r = parseHealResult(
    {
      schemaVersion: SCHEMA_VERSIONS.healResult,
      runId: "r1",
      status: "partial-incomplete",
      reason: "Save button removed"
    },
    "<test>"
  );
  assert.equal(r.status, "partial-incomplete");
  assert.equal(r.reason, "Save button removed");
});

test("parseHealResult rejects healed with empty healedLocators", () => {
  assert.throws(() =>
    parseHealResult(
      {
        schemaVersion: SCHEMA_VERSIONS.healResult,
        runId: "r1",
        status: "healed",
        healedLocators: []
      },
      "<test>"
    )
  );
});

test("parseHealResult rejects partial-incomplete without a reason", () => {
  assert.throws(() =>
    parseHealResult(
      {
        schemaVersion: SCHEMA_VERSIONS.healResult,
        runId: "r1",
        status: "partial-incomplete"
      },
      "<test>"
    )
  );
});
