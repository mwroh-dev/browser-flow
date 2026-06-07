import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureRunDirs, getTaskPath, getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { varsCommand } from "../../scripts/commands/vars.mjs";
import { createTask, transitionTask } from "../../scripts/lib/workflow-status.mjs";
import { createScriptedAsk } from "../../scripts/lib/variable-agent-interaction.mjs";

/**
 * @param {string} runId
 * @param {string} status
 * @param {Record<string, unknown>} context
 */
function setupRunWithProposals(runId, status, context = {}) {
  const runPaths = ensureRunDirs(runId);
  // workflow.json with 2 proposed inputs
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 1,
    id: runId,
    fixture: "synthetic",
    startUrl: "/x",
    finalUrl: "/x",
    steps: [
      { action: "goto", url: "/x", pageKey: "synthetic/x" },
      { action: "fill", selector: "#a", value: "Hello", valueRef: "{{input.title}}", pageKey: "synthetic/x" },
      { action: "fill", selector: "#b", value: "World", valueRef: "{{input.body}}", pageKey: "synthetic/x" }
    ],
    inputs: [
      { name: "title", label: "title", suggestedFrom: 1, type: "text" },
      { name: "body", label: "body", suggestedFrom: 2, type: "text" }
    ],
    verification: {
      expectedFinalUrl: "/x",
      expectedNetwork: { url: "/api/x", method: "POST", status: 200 },
      expectedEvidence: { selector: "h1", textIncludes: "ok" }
    },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });
  // task
  let task = createTask({ kind: "variable-extraction", runId, context });
  if (status !== "pending") {
    task = transitionTask(task, "in-progress");
    if (status === "broken") task = transitionTask(task, "broken");
    if (status === "complete") task = transitionTask(task, "complete");
  }
  mkdirSync(runPaths.tasksDir, { recursive: true });
  writeFileSync(getTaskPath(runId, "variable-extraction"), JSON.stringify(task, null, 2) + "\n", "utf8");
  return runPaths;
}

test("vars --interactive accepts all proposals (default empty answers) and transitions to complete", async () => {
  const runId = `vars-interactive-accept-${Date.now()}`;
  setupRunWithProposals(runId, "in-progress", { proposedInputs: ["title", "body"], confirmed: false });
  const ask = createScriptedAsk(["", ""]);
  const result = /** @type {{ status: string, finalInputCount: number }} */ (
    await varsCommand({ "run-id": runId, interactive: true }, { askFn: ask })
  );
  assert.equal(result.status, "complete");
  assert.equal(result.finalInputCount, 2);
  // workflow.json updated: inputs[] preserved
  const workflow = /** @type {{ inputs: Array<{ name: string }>, steps: Array<{ valueRef?: string }> }} */ (
    readJson(getRunPaths(runId).workflowJsonPath)
  );
  assert.equal(workflow.inputs.length, 2);
  assert.equal(workflow.steps[1].valueRef, "{{input.title}}");
});

test("vars --interactive: reject + rename + accept produces correct workflow", async () => {
  const runId = `vars-interactive-mixed-${Date.now()}`;
  setupRunWithProposals(runId, "in-progress");
  const ask = createScriptedAsk(["n", "subject"]);  // title=reject, body=rename to "subject"
  const result = /** @type {{ status: string, finalInputCount: number }} */ (
    await varsCommand({ "run-id": runId, interactive: true }, { askFn: ask })
  );
  assert.equal(result.status, "complete");
  assert.equal(result.finalInputCount, 1, "1 accepted (renamed body), 1 rejected (title)");
  const workflow = /** @type {{ inputs: Array<{ name: string }>, steps: Array<{ value?: string, valueRef?: string }> }} */ (
    readJson(getRunPaths(runId).workflowJsonPath)
  );
  assert.equal(workflow.inputs.length, 1);
  assert.equal(workflow.inputs[0].name, "subject");
  // step[1] (title rejected): valueRef stripped, literal "Hello" stays
  assert.equal(workflow.steps[1].valueRef, undefined);
  assert.equal(workflow.steps[1].value, "Hello");
  // step[2] (body renamed): valueRef = {{input.subject}}
  assert.equal(workflow.steps[2].valueRef, "{{input.subject}}");
});

test("vars --interactive: invalid rename → task transitions to broken", async () => {
  const runId = `vars-interactive-broken-${Date.now()}`;
  setupRunWithProposals(runId, "in-progress");
  const ask = createScriptedAsk(["bad-name!"]);
  await assert.rejects(
    varsCommand({ "run-id": runId, interactive: true }, { askFn: ask }),
    /Invalid rename/
  );
  const task = /** @type {{ status: string, context: { reason?: string } }} */ (
    readJson(getTaskPath(runId, "variable-extraction"))
  );
  assert.equal(task.status, "broken");
  assert.ok(typeof task.context.reason === "string", "expected reason string");
  assert.match(task.context.reason, /Invalid rename/);
});

test("vars --resume on broken task transitions to in-progress then to complete after accept", async () => {
  const runId = `vars-resume-${Date.now()}`;
  setupRunWithProposals(runId, "broken", { brokenAt: new Date().toISOString(), reason: "earlier abort" });
  const ask = createScriptedAsk(["y", "y"]);
  const result = /** @type {{ status: string, finalInputCount: number }} */ (
    await varsCommand({ "run-id": runId, resume: true }, { askFn: ask })
  );
  assert.equal(result.status, "complete");
  assert.equal(result.finalInputCount, 2);
  // task records resumedAt context
  const task = /** @type {{ status: string, context: { resumedAt?: string } }} */ (
    readJson(getTaskPath(runId, "variable-extraction"))
  );
  assert.equal(task.status, "complete");
  assert.equal(typeof task.context.resumedAt, "string");
});

test("vars --resume rejects when task is not broken", async () => {
  const runId = `vars-resume-not-broken-${Date.now()}`;
  setupRunWithProposals(runId, "in-progress");
  await assert.rejects(
    varsCommand({ "run-id": runId, resume: true }, { askFn: createScriptedAsk(["y", "y"]) }),
    /requires broken state/
  );
});
