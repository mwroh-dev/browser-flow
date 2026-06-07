import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { ensureRunDirs, getRunPaths, pagePaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { readFileSync } from "node:fs";
import { runTeardownCommand, teardownCommand } from "../../scripts/commands/teardown.mjs";
import { parseWorkflowArtifact } from "../../scripts/lib/schemas.mjs";

/** Minimal valid WorkflowV1 for use as the main run's workflow.json
 * @param {string} id
 */
function makeBaseWorkflow(id) {
  return {
    schemaVersion: 1,
    id,
    fixture: "synthetic",
    startUrl: "https://example.com/",
    finalUrl: "https://example.com/result",
    steps: [
      { action: "goto", url: "https://example.com/", pageKey: "example/root" },
      { action: "click", selector: "[data-bf=\"submit\"]", pageKey: "example/root" }
    ],
    verification: {
      expectedFinalUrl: "https://example.com/result",
      expectedNetwork: { url: "/api/submit", method: "POST", status: 200 },
      expectedEvidence: { selector: "[data-bf-evidence=\"result\"]", textIncludes: "OK" }
    },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  };
}

/** Minimal valid WorkflowV1 for the cleanup run (its steps become teardown)
 * @param {string} id
 */
function makeCleanupWorkflow(id) {
  return {
    schemaVersion: 1,
    id,
    fixture: "synthetic",
    startUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    steps: [
      { action: "goto", url: "https://example.com/", pageKey: "example/root" },
      { action: "click", selector: "button[aria-label='삭제']", pageKey: "example/root" }
    ],
    verification: {
      expectedFinalUrl: "https://example.com/",
      expectedNetwork: null,
      expectedEvidence: null
    },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  };
}

test("bf teardown --record links cleanup run's steps into main workflow.teardown", () => {
  const mainId = `teardown-main-${Date.now()}`;
  const cleanupId = `teardown-cleanup-${Date.now()}`;

  // Set up main run dir + workflow.json
  const mainPaths = ensureRunDirs(mainId);
  writeJson(mainPaths.workflowJsonPath, makeBaseWorkflow(mainId));

  // Set up cleanup run dir + workflow.json
  const cleanupPaths = ensureRunDirs(cleanupId);
  const cleanupWorkflow = makeCleanupWorkflow(cleanupId);
  writeJson(cleanupPaths.workflowJsonPath, cleanupWorkflow);

  // Execute the command
  const result = runTeardownCommand({ runId: mainId, recordFrom: cleanupId });

  // Return value assertions
  assert.equal(result.runId, mainId);
  assert.equal(result.recordedFrom, cleanupId);
  assert.equal(result.teardownStepCount, cleanupWorkflow.steps.length);

  // Re-read main workflow.json and assert teardown was written correctly
  const raw = JSON.parse(readFileSync(mainPaths.workflowJsonPath, "utf8"));
  assert.equal(raw.teardown.strategy, "record");
  assert.deepEqual(raw.teardown.steps, cleanupWorkflow.steps);
  assert.deepEqual(raw.teardown.dummyNaming, { prefix: "__bf_test__", hashLen: 8 });

  // Re-validate via parseWorkflowArtifact to confirm schema-valid
  const validated = parseWorkflowArtifact(raw, mainPaths.workflowJsonPath);
  assert.ok(validated.teardown, "teardown field must be present after parse");
  assert.equal(validated.teardown.strategy, "record");
  assert.deepEqual(validated.teardown.steps, cleanupWorkflow.steps);
});

test("bf teardown --search links a search-discovered teardown into main workflow", () => {
  const mainId = `teardown-search-${Date.now()}`;
  const mainPaths = ensureRunDirs(mainId);
  writeJson(mainPaths.workflowJsonPath, makeBaseWorkflow(mainId)); // steps have pageKey "example/root"

  const pageNodePaths = pagePaths("example/root");
  mkdirSync(pageNodePaths.pageDir, { recursive: true });
  writeJson(pageNodePaths.selectorsPath, {
    schemaVersion: 1,
    pageKey: "example/root",
    selectors: [
      { selector: "[data-bf=\"item-create\"]", actions: ["click"], text: "Create" },
      { selector: "[data-bf=\"item-delete\"]", actions: ["click"], text: "Delete", ancestors: [{ role: "button" }] }
    ]
  });

  const result = runTeardownCommand({ runId: mainId, search: { intent: "delete the item", pageKey: "example/root" } });
  assert.equal(result.strategy, "search");

  const saved = parseWorkflowArtifact(JSON.parse(readFileSync(mainPaths.workflowJsonPath, "utf8")), mainPaths.workflowJsonPath);
  assert.ok(saved.teardown, "teardown field must be present after search");
  assert.equal(saved.teardown.strategy, "search");
  assert.equal(saved.teardown.steps.length, 1);
  assert.equal(saved.teardown.steps[0].selector, "[data-bf=\"item-delete\"]");
});

test("bf teardown --search and --record are mutually exclusive", () => {
  assert.throws(() => teardownCommand({ "run-id": "x", search: true, record: "y" }), /mutually exclusive/);
});
