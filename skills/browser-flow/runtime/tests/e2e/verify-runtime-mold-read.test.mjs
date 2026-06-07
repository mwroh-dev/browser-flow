import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths, pagePaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Proves the runtime mold-read branch actually fires during a drift-hold, rather
 * than the step-locator fallback.
 *
 * Setup: a `selfclean` workflow whose fill drift-holds (phantom locator), AND a
 * pre-existing `mold.json` for the held page-node containing the FULL live
 * skeleton (item-name / create / delete). At drift-hold the runner reads that
 * mold at runtime for `storedSkeleton`.
 *
 * Distinguishing assertion: `diffSkeletons(storedSkeleton, live)` →
 *   - if storedSkeleton = the FULL mold (matches live) → diff.unchanged is NON-EMPTY.
 *   - if it were the lone-step fallback (the phantom key, absent from live) →
 *     diff.unchanged would be EMPTY and everything live would be "appeared".
 * So a non-empty diff.unchanged proves the runtime mold-read path was taken.
 */
test("verify-runtime-mold-read: drift-hold reads the full mold.json at runtime (not the step fallback)", { timeout: 90000 }, async () => {
  const runId = `runtime-mold-read-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // Pre-seed the held page-node's mold with the FULL live skeleton (real selfclean keys).
  const fullSkeleton = [
    { role: "textbox", name: "Item name", structuralKey: "body>main>form>label|input|name=itemName||Item name" },
    { role: "button", name: "Create", structuralKey: "body>main>form|button|type=submit||Create" },
    { role: "textbox", name: "Delete item", structuralKey: "body>main>form>label|input|name=itemName||Delete item" },
    { role: "button", name: "Delete", structuralKey: "body>main>form|button|type=submit||Delete" }
  ];
  writeJson(pagePaths("selfclean").moldPath, { schemaVersion: SCHEMA_VERSIONS.workflow, pageKey: "selfclean", skeleton: fullSkeleton });

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "selfclean",
    startUrl: "/selfclean",
    finalUrl: "/selfclean?created=1",
    steps: [
      { action: "goto" },
      // Phantom fill → drift-hold. Its locator key is NOT in the live page.
      { action: "fill", selector: "[data-bf=\"phantom\"]", value: "x", locator: { role: "textbox", name: "Phantom", structuralKey: "phantom-key-xyz" } },
      { action: "click", selector: "[data-bf=\"item-create\"]", text: "Create" }
    ],
    segments: [{ range: [0, 2], startPageKey: "selfclean", endPageKey: "selfclean", name: "create" }],
    verification: { expectedNetwork: null, expectedEvidence: null, transitionTimeoutMs: 8000 },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  generateRunner(runId);
  const held = await verifyRun(runId, { headless: true });
  const report = /** @type {any} */ (held.report);
  assert.equal(report.heldAtSegment, 0, `must drift-hold at segment 0 — ${JSON.stringify(report)}`);

  const heal = /** @type {any} */ (readJson(getRunPaths(runId).healRequestPath));
  const unchangedKeys = (heal.diff?.unchanged || []).map((/** @type {any} */ e) => e.structuralKey);

  // Proof: the stored side matched live affordances → it came from the full mold.json,
  // not the lone-step fallback (whose only entry, the phantom key, is absent from live).
  assert.ok(
    unchangedKeys.length > 0,
    `diff.unchanged must be non-empty (full mold read at runtime) — got diff=${JSON.stringify(heal.diff)}`
  );
  assert.ok(
    unchangedKeys.includes("body>main>form>label|input|name=itemName||Item name"),
    `the seeded mold's 'Item name' affordance must appear as unchanged (read from mold.json) — got ${JSON.stringify(unchangedKeys)}`
  );
  // And the phantom held-step key must NOT be the stored skeleton (that would be the fallback).
  assert.ok(!unchangedKeys.includes("phantom-key-xyz"), "stored skeleton must be the mold, not the phantom step locator");
});
