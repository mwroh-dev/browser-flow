import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { getPaths, getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

/**
 * @param {string} runId
 * @param {"synthetic" | "docs" | "stateful" | "submit" | "secret"} fixture
 * @param {"synthetic" | "docs" | "stateful" | "submit" | "secret"} workflow
 */
async function executeLoop(runId, fixture, workflow) {
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", fixture,
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow
  });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);
  runCli(["generate", "--run-id", runId]);
  return runCli(["verify", "--run-id", runId, "--headless"]);
}

test("full loop passes for the synthetic fixture", async () => {
  const runId = `full-synth-${Date.now()}`;
  const result = await executeLoop(runId, "synthetic", "synthetic");
  const runPaths = getRunPaths(runId);
  const registry = /** @type {Array<{ id: string, status: string }>} */ (readJson(getPaths().registryPath));
  const report = /** @type {{ securityOk: boolean }} */ (readJson(runPaths.verificationPath));
  const security = /** @type {{ ok: boolean }} */ (readJson(runPaths.securityPath));

  assert.equal(result.ok, true);
  assert.equal(existsSync(runPaths.pathYamlPath), true);
  assert.equal(existsSync(runPaths.recipeYamlPath), true);
  assert.equal(existsSync(runPaths.runnerPath), true);
  assert.equal(existsSync(runPaths.securityPath), true);
  assert.equal(report.securityOk, true);
  assert.equal(result.security.ok, true);
  assert.equal(security.ok, true);
  assert.equal(registry.some((entry) => entry.id === runId && entry.status === "verified"), true);
  // bf done registers variable-extraction task; the analyze hook may transition
  // pending → in-progress when the capture path is novel against the page-node
  // snapshot. Both states are valid here — what matters is the task exists with
  // kind=variable-extraction and is in a known forward state.
  const taskPath = `${runPaths.tasksDir}/variable-extraction.json`;
  assert.equal(existsSync(taskPath), true, "variable-extraction task must be registered after bf done");
  const task = /** @type {{ status: string, kind: string }} */ (readJson(taskPath));
  assert.equal(task.kind, "variable-extraction");
  assert.ok(
    ["pending", "in-progress", "complete"].includes(task.status),
    `task.status must be a forward state, got "${task.status}"`
  );
});

test("full loop passes for the read-only docs fixture", async () => {
  const runId = `full-docs-${Date.now()}`;
  const result = await executeLoop(runId, "docs", "docs");
  const report = /** @type {{ success: boolean }} */ (readJson(getRunPaths(runId).verificationPath));
  const security = /** @type {{ ok: boolean }} */ (readJson(getRunPaths(runId).securityPath));

  assert.equal(result.ok, true);
  assert.equal(report.success, true);
  assert.equal(security.ok, true);
});

test("full loop passes for the stateful fixture", async () => {
  const runId = `full-stateful-${Date.now()}`;
  const result = await executeLoop(runId, "stateful", "stateful");
  const runPaths = getRunPaths(runId);
  const report = /** @type {{ success: boolean, pathComplete: boolean, securityOk: boolean }} */ (readJson(runPaths.verificationPath));
  const security = /** @type {{ ok: boolean }} */ (readJson(runPaths.securityPath));

  assert.equal(result.ok, true);
  assert.equal(report.success, true);
  assert.equal(report.pathComplete, true);
  assert.equal(report.securityOk, true);
  assert.equal(security.ok, true);
});

test("full loop passes for the submit fixture", async () => {
  const runId = `full-submit-${Date.now()}`;
  const result = await executeLoop(runId, "submit", "submit");
  const runPaths = getRunPaths(runId);
  const report = /** @type {{ success: boolean, pathComplete: boolean, securityOk: boolean }} */ (readJson(runPaths.verificationPath));
  const security = /** @type {{ ok: boolean }} */ (readJson(runPaths.securityPath));
  const workflow = /** @type {{ steps: Array<{ action: string }> }} */ (readJson(runPaths.workflowJsonPath));

  assert.equal(result.ok, true);
  assert.equal(report.success, true);
  assert.equal(report.pathComplete, true);
  assert.equal(report.securityOk, true);
  assert.equal(security.ok, true);
  assert.equal(workflow.steps.some((step) => step.action === "submit"), true);
});

test("full loop passes for the secret-input fixture", async () => {
  const runId = `full-secret-${Date.now()}`;
  process.env.BROWSER_FLOW_SECRET_0 = "letmein";
  try {
    const result = await executeLoop(runId, "secret", "secret");
    const runPaths = getRunPaths(runId);
    const report = /** @type {{ success: boolean, pathComplete: boolean, securityOk: boolean }} */ (readJson(runPaths.verificationPath));
    const workflow = /** @type {{ steps: Array<{ action: string, secret?: boolean }> }} */ (readJson(runPaths.workflowJsonPath));
    const reportText = readJson(runPaths.verificationPath);

    assert.equal(result.ok, true);
    assert.equal(report.success, true);
    assert.equal(report.pathComplete, true);
    assert.equal(report.securityOk, true);
    assert.equal(workflow.steps.some((step) => step.action === "fill" && step.secret === true), true);
    assert.equal(JSON.stringify(reportText).includes("letmein"), false);
  } finally {
    delete process.env.BROWSER_FLOW_SECRET_0;
  }
});
