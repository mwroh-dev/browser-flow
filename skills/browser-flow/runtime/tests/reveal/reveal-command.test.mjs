import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { parseRevealResult } from "../../scripts/lib/schemas.mjs";
import { runRevealCommand } from "../../scripts/commands/reveal.mjs";
import { COMMAND_REGISTRY } from "../../scripts/lib/cli-registry.mjs";
import { COMMANDS } from "../../scripts/lib/cli-metadata.mjs";

/** @param {any} r */ const R = (r) => r;
let nextRunId = 0;

function uniqueRunId(prefix) {
  nextRunId += 1;
  return `${prefix}-${Date.now()}-${nextRunId}`;
}

test("parseRevealResult: valid stateful-affordance result parses", () => {
  const r = parseRevealResult({
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId: "x",
    stepIndex: 1,
    status: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    followupStepIndex: 2
  });
  assert.equal(r.status, "stateful-affordance");
  assert.equal(r.hrefPolicy, "ignore");
  assert.equal(r.followupStepIndex, 2);
});

test("parseRevealResult: valid not-reveal result parses", () => {
  const r = parseRevealResult({
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId: "x",
    stepIndex: 1,
    status: "not-reveal",
    reason: "navigates directly"
  });
  assert.equal(r.status, "not-reveal");
});

test("parseRevealResult: bad schemaVersion throws", () => {
  assert.throws(
    () => parseRevealResult({
      schemaVersion: SCHEMA_VERSIONS.revealResult + 1,
      runId: "x",
      stepIndex: 1,
      status: "stateful-affordance"
    }),
    /reveal-result/
  );
});

/**
 * @param {string} runId
 */
function writeRevealWorkflow(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 1,
    id: runId,
    steps: [
      { action: "goto" },
      {
        action: "click",
        text: "Expand menu",
        href: "/",
        locator: { role: "button", name: "Expand menu", href: "/" },
        transition: {
          refType: "click",
          appeared: [{ role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather" }],
          disappeared: [],
          changed: []
        }
      },
      {
        action: "click",
        text: "Weather",
        href: "http://127.0.0.1:59999/reveal/weather",
        locator: { role: "link", name: "Weather", href: "http://127.0.0.1:59999/reveal/weather" }
      }
    ],
    revealCandidates: [1]
  });
  return runPaths;
}

test("runRevealCommand --apply: applies reveal semantics onto workflow + regenerates", async () => {
  const runId = uniqueRunId("reveal-cmd-apply");
  const runPaths = writeRevealWorkflow(runId);
  writeJson(runPaths.revealResultPath, {
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId,
    stepIndex: 1,
    status: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    followupStepIndex: 2
  });

  let regenCalled = "";
  const out = R(await runRevealCommand(
    { runId, applyPath: runPaths.revealResultPath },
    { regenerate: R(async (/** @type {string} */ id) => { regenCalled = id; }) }
  ));

  assert.equal(out.applied, true);
  assert.equal(regenCalled, runId, "regenerate must run after a successful reveal apply");
  const wf = R(readJson(runPaths.workflowJsonPath));
  assert.deepEqual(wf.steps[1].actionSemantics, {
    kind: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    followupStepIndex: 2
  });
});

test("runRevealCommand --apply not-reveal: does NOT regenerate", async () => {
  const runId = uniqueRunId("reveal-cmd-notreveal");
  const runPaths = writeRevealWorkflow(runId);
  writeJson(runPaths.revealResultPath, {
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId,
    stepIndex: 1,
    status: "not-reveal",
    reason: "navigates directly"
  });

  let regenCalled = false;
  const out = R(await runRevealCommand(
    { runId, applyPath: runPaths.revealResultPath },
    { regenerate: R(async () => { regenCalled = true; }) }
  ));

  assert.equal(out.applied, false);
  assert.equal(regenCalled, false, "no regenerate when semantics are rejected");
  const wf = R(readJson(runPaths.workflowJsonPath));
  assert.deepEqual(wf.revealCandidates, [], "resolved not-reveal candidate must be removed from the workflow");
});

test("runRevealCommand no --apply: emits reveal-request with queued candidates", async () => {
  const runId = uniqueRunId("reveal-cmd-request");
  const runPaths = writeRevealWorkflow(runId);

  const out = R(await runRevealCommand({ runId }));
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].stepIndex, 1);
  assert.equal(out.candidates[0].followupStepIndex, 2);
  assert.deepEqual(out.candidates[0].locator, { role: "button", name: "Expand menu", href: "/" });
  assert.equal("step" in out.candidates[0], false, "request candidate must expose locator directly, not nested step payload");
  const req = R(readJson(runPaths.revealRequestPath));
  assert.equal(req.candidates[0].stepIndex, 1);
  assert.equal(req.candidates[0].followupStepIndex, 2);
  assert.deepEqual(req.candidates[0].locator, { role: "button", name: "Expand menu", href: "/" });
  assert.equal("step" in req.candidates[0], false, "persisted request must match the reveal-agent contract");
});

test("runRevealCommand --apply rejects reveal results for a different runId", async () => {
  const runId = uniqueRunId("reveal-cmd-runid");
  const runPaths = writeRevealWorkflow(runId);
  writeJson(runPaths.revealResultPath, {
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId: `${runId}-other`,
    stepIndex: 1,
    status: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    followupStepIndex: 2
  });

  await assert.rejects(
    () => runRevealCommand(
      { runId, applyPath: runPaths.revealResultPath },
      { regenerate: R(async () => {}) }
    ),
    /belongs to run/
  );
});

test("runRevealCommand --apply rejects stateful-affordance for a non-candidate step", async () => {
  const runId = uniqueRunId("reveal-cmd-noncandidate");
  const runPaths = writeRevealWorkflow(runId);
  const wf = R(readJson(runPaths.workflowJsonPath));
  wf.revealCandidates = [];
  writeJson(runPaths.workflowJsonPath, wf);
  writeJson(runPaths.revealResultPath, {
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId,
    stepIndex: 1,
    status: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    followupStepIndex: 2
  });

  await assert.rejects(
    () => runRevealCommand(
      { runId, applyPath: runPaths.revealResultPath },
      { regenerate: R(async () => {}) }
    ),
    /not a queued reveal candidate/
  );
});

test("runRevealCommand --apply rejects stateful-affordance without transition evidence", async () => {
  const runId = uniqueRunId("reveal-cmd-notransition");
  const runPaths = writeRevealWorkflow(runId);
  const wf = R(readJson(runPaths.workflowJsonPath));
  delete wf.steps[1].transition;
  writeJson(runPaths.workflowJsonPath, wf);
  writeJson(runPaths.revealResultPath, {
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId,
    stepIndex: 1,
    status: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    followupStepIndex: 2
  });

  await assert.rejects(
    () => runRevealCommand(
      { runId, applyPath: runPaths.revealResultPath },
      { regenerate: R(async () => {}) }
    ),
    /requires recorded transition evidence/
  );
});

test("runRevealCommand --apply rejects mismatched followupStepIndex", async () => {
  const runId = uniqueRunId("reveal-cmd-followup");
  const runPaths = writeRevealWorkflow(runId);
  writeJson(runPaths.revealResultPath, {
    schemaVersion: SCHEMA_VERSIONS.revealResult,
    runId,
    stepIndex: 1,
    status: "stateful-affordance",
    verification: "transition",
    hrefPolicy: "ignore",
    followupStepIndex: 99
  });

  await assert.rejects(
    () => runRevealCommand(
      { runId, applyPath: runPaths.revealResultPath },
      { regenerate: R(async () => {}) }
    ),
    /followupStepIndex .* does not match expected/
  );
});

test("assembled runtime mirrors reveal command surfaces", async () => {
  const reveal = COMMAND_REGISTRY.get("reveal");
  const metadata = COMMANDS.find((entry) => entry.name === "reveal");

  assert.ok(reveal);
  assert.ok(metadata);
  assert.equal(reveal.metadata, metadata);
  assert.equal(typeof reveal.run, "function");
  assert.equal(metadata.writtenArtifacts.includes("reveal-request.json"), true);
  assert.equal(metadata.safetyImplications.some((item) => item.toLowerCase().includes("reveal")), true);
});
