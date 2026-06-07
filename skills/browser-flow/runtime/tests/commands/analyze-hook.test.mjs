import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ensureRunDirs, getRunPaths, getTaskPath } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { analyzeCommand } from "../../scripts/commands/analyze.mjs";

test("analyze hook populates workflow.inputs[] + transitions task when capture is novel", () => {
  const runId = `analyze-hook-novel-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", timestamp: 900 },
    { type: "input", selector: "[data-bf=\"name-input\"]", fieldName: "name", value: "Codex", secret: false, timestamp: 950 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  // No prior task file — analyze should create one (defensive path)
  analyzeCommand({ "run-id": runId });

  const workflow = /** @type {{ inputs?: Array<{ name: string, type: string }>, steps: Array<{ valueRef?: string, action: string }> }} */ (
    readJson(runPaths.workflowJsonPath)
  );
  assert.ok(Array.isArray(workflow.inputs), "workflow.inputs[] must be populated for novel capture");
  assert.ok(workflow.inputs.length >= 1, "at least one input proposed from fill step");
  assert.equal(workflow.inputs[0].name, "name");
  const fillStep = workflow.steps.find((step) => step.action === "fill");
  assert.ok(fillStep !== undefined, "expected a fill step");
  assert.equal(fillStep.valueRef, "{{input.name}}");

  const taskPath = getTaskPath(runId, "variable-extraction");
  assert.equal(existsSync(taskPath), true);
  const task = /** @type {{ status: string, context: { confirmed: boolean, proposedInputs: string[] } }} */ (
    readJson(taskPath)
  );
  assert.equal(task.status, "in-progress");
  assert.equal(task.context.confirmed, false);
  assert.deepEqual(task.context.proposedInputs, ["name"]);
});

test("analyze hook is no-op when capture is not novel (snapshot has the pageKey + selectors)", () => {
  // Run analyze once to populate knowledge, then a SECOND analyze for a
  // sibling runId with the same fixture/selectors should NOT trigger
  // the proposer (judgeNovelty returns isNewPath=false against the
  // pre-compile snapshot — page-nodes from first run are visible).
  const firstRunId = `analyze-hook-prime-${Date.now()}`;
  const firstPaths = ensureRunDirs(firstRunId);
  writeJson(firstPaths.manifestPath, { runId: firstRunId, fixture: "synthetic", startUrl: "http://127.0.0.1:59999/synthetic" });
  writeJson(firstPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", timestamp: 1010 }
  ]);
  writeJson(firstPaths.networkSummaryPath, [{ url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }]);
  writeJson(firstPaths.pageEvidencePath, [{ selector: "[data-bf-evidence=\"result\"]", text: "Done", url: "http://127.0.0.1:59999/synthetic/result" }]);
  analyzeCommand({ "run-id": firstRunId });

  // Second run with identical capture data — page-nodes already in
  // snapshot, no novelty, no proposer.
  const secondRunId = `analyze-hook-secondary-${Date.now()}`;
  const secondPaths = ensureRunDirs(secondRunId);
  writeJson(secondPaths.manifestPath, { runId: secondRunId, fixture: "synthetic", startUrl: "http://127.0.0.1:59999/synthetic" });
  writeJson(secondPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", timestamp: 900 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result", timestamp: 1010 }
  ]);
  writeJson(secondPaths.networkSummaryPath, [{ url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }]);
  writeJson(secondPaths.pageEvidencePath, [{ selector: "[data-bf-evidence=\"result\"]", text: "Done", url: "http://127.0.0.1:59999/synthetic/result" }]);
  analyzeCommand({ "run-id": secondRunId });

  const workflow = /** @type {{ inputs?: unknown }} */ (readJson(secondPaths.workflowJsonPath));
  assert.equal(workflow.inputs, undefined, "workflow.inputs[] must not be populated when capture is not novel");

  // task file may not exist (we didn't call done hook), so just check that
  // if it does exist it's not in in-progress (the analyze hook didn't activate it)
  const taskPath = getTaskPath(secondRunId, "variable-extraction");
  if (existsSync(taskPath)) {
    const task = /** @type {{ status: string }} */ (readJson(taskPath));
    assert.notEqual(task.status, "in-progress");
  }
});
