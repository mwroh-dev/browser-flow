import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { parseScopeResult } from "../../scripts/lib/schemas.mjs";
import { runScopeCommand } from "../../scripts/commands/scope.mjs";

/** @param {any} r */ const R = (r) => r;

// --- schema ---------------------------------------------------------------

test("parseScopeResult: valid scoped result parses", () => {
  const r = parseScopeResult({
    schemaVersion: 1, runId: "x", stepIndex: 1, status: "scoped",
    anchors: ["메모 작성…"], scope: { ancestorUp: 1, includeAncestorSiblingText: true }
  });
  assert.equal(r.status, "scoped");
  assert.deepEqual(r.anchors, ["메모 작성…"]);
});

test("parseScopeResult: valid no-anchor result parses", () => {
  const r = parseScopeResult({ schemaVersion: 1, runId: "x", stepIndex: 1, status: "no-anchor", reason: "nothing distinguishes it" });
  assert.equal(r.status, "no-anchor");
});

test("parseScopeResult: bad schemaVersion throws (version guard)", () => {
  assert.throws(() => parseScopeResult({ schemaVersion: 2, runId: "x", stepIndex: 1, status: "scoped", anchors: ["a"] }), /scope-result/);
});

test("parseScopeResult: bad status throws", () => {
  assert.throws(() => parseScopeResult({ schemaVersion: 1, runId: "x", stepIndex: 1, status: "moved" }), /scope-result/);
});

// --- command --------------------------------------------------------------

/** @param {string} runId */
function writeSignalPoorWorkflow(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 1,
    id: runId,
    steps: [
      { action: "goto" },
      { action: "click", locator: { role: "presentation", name: "", structuralKey: "div>div>p|role=presentation||", neighborTexts: [] } }
    ],
    scopeCandidates: [1]
  });
  return runPaths;
}

test("runScopeCommand --apply: applies scope-result onto workflow + regenerates", async () => {
  const runId = `scope-cmd-apply-${Date.now()}`;
  const runPaths = writeSignalPoorWorkflow(runId);
  writeJson(runPaths.scopeResultPath, {
    schemaVersion: 1, runId, stepIndex: 1, status: "scoped",
    anchors: ["메모 작성…"], scope: { ancestorUp: 1, includeAncestorSiblingText: true }, signalWeights: { structuralKey: 0.5 }
  });

  let regenCalled = "";
  const out = R(await runScopeCommand({ runId, applyPath: runPaths.scopeResultPath }, { regenerate: R(async (/** @type {string} */ id) => { regenCalled = id; }) }));

  assert.equal(out.applied, true);
  assert.equal(regenCalled, runId, "regenerate must run after a successful apply");
  const wf = R(readJson(runPaths.workflowJsonPath));
  assert.deepEqual(wf.steps[1].locator.neighborTexts, ["메모 작성…"]);
  assert.deepEqual(wf.steps[1].locator.disambiguation.scopeRule, { ancestorUp: 1, includeAncestorSiblingText: true });
  assert.deepEqual(wf.steps[1].locator.disambiguation.weightOverrides, { structuralKey: 0.5 });
});

test("runScopeCommand --apply no-anchor: does NOT regenerate (nothing applied)", async () => {
  const runId = `scope-cmd-noanchor-${Date.now()}`;
  const runPaths = writeSignalPoorWorkflow(runId);
  writeJson(runPaths.scopeResultPath, { schemaVersion: 1, runId, stepIndex: 1, status: "no-anchor", reason: "gone" });

  let regenCalled = false;
  const out = R(await runScopeCommand({ runId, applyPath: runPaths.scopeResultPath }, { regenerate: R(async () => { regenCalled = true; }) }));

  assert.equal(out.applied, false);
  assert.equal(regenCalled, false, "no regenerate when nothing applied");
});

test("runScopeCommand no --apply: emits scope-request with the signal-poor candidates", async () => {
  const runId = `scope-cmd-request-${Date.now()}`;
  const runPaths = writeSignalPoorWorkflow(runId);

  const out = R(await runScopeCommand({ runId }));
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].stepIndex, 1);
  assert.equal(out.candidates[0].locator.role, "presentation");
  // persisted for the orchestrator to dispatch the scope-agent against
  const req = R(readJson(runPaths.scopeRequestPath));
  assert.equal(req.candidates[0].stepIndex, 1);
});
