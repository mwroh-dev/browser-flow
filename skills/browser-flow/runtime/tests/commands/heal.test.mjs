import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { runHealCommand } from "../../scripts/commands/heal.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/** @param {string} runId */
function seed(runId) {
  const rp = ensureRunDirs(runId);
  writeJson(rp.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual", startUrl: "u", finalUrl: "u",
    steps: [ { action: "goto" }, { action: "fill", selector: "[data-bf=\"x\"]", value: "v", locator: { role: "textbox", name: "X", structuralKey: "old-key" } } ],
    segments: [{ range: [0,1], startPageKey: "p", endPageKey: "p", name: "s0" }],
    verification: { expectedNetwork: null, expectedEvidence: null, transitionTimeoutMs: 8000 },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });
  writeJson(rp.healRequestPath, { heldSegment: 0, intent: "s0", heldStepLocator: { role: "textbox", name: "X", structuralKey: "old-key" }, diff: { unchanged: [], changed: [], appeared: [], disappeared: [{ role: "textbox", name: "X", structuralKey: "old-key" }] }, liveSkeleton: [{ role: "textbox", name: "이름", structuralKey: "new-key" }] });
  return rp;
}

test("runHealCommand --apply replaces locator, runs cleanup + exactly one rerun", async () => {
  const runId = `heal-unit-${Date.now()}`;
  const rp = seed(runId);
  const healPath = rp.tasksDir + "/heal-result.json";
  writeJson(healPath, { schemaVersion: SCHEMA_VERSIONS.healResult, runId, status: "healed",
    healedLocators: [{ match: { structuralKey: "old-key" }, locator: { role: "textbox", name: "이름", structuralKey: "new-key" } }] });
  /** @type {Array<[string, ...unknown[]]>} */
  const calls = [];
  const res = await runHealCommand({ runId, applyPath: healPath, headless: true }, {
    regenerate: (/** @type {string} */ id) => { calls.push(["regen", id]); },
    cleanup: async () => { calls.push(["cleanup"]); return { dangling: [], removed: [], errors: [] }; },
    rerun: async () => { calls.push(["rerun"]); return { report: { success: true, pathComplete: true } }; }
  });
  assert.equal(res.status, "healed");
  assert.deepEqual(res.applied, ["old-key"]);
  const wf = /** @type {Record<string, any>} */ (readJson(rp.workflowJsonPath));
  assert.equal(wf.steps[1].locator.structuralKey, "new-key");
  assert.deepEqual(calls.map((c) => c[0]), ["regen", "cleanup", "rerun"]);
  assert.equal(res.rerun.report.success, true);
});

test("runHealCommand partial-incomplete marks affected segments, no rerun", async () => {
  const runId = `heal-unit-pi-${Date.now()}`;
  const rp = seed(runId);
  const healPath = rp.tasksDir + "/heal-result.json";
  writeJson(healPath, { schemaVersion: SCHEMA_VERSIONS.healResult, runId, status: "partial-incomplete", reason: "field gone" });
  /** @type {string[]} */
  const calls = [];
  const res = await runHealCommand({ runId, applyPath: healPath, headless: true }, {
    regenerate: () => { calls.push("regen"); }, cleanup: async () => { calls.push("cleanup"); }, rerun: async () => { calls.push("rerun"); }
  });
  assert.equal(res.status, "partial-incomplete");
  assert.equal(res.reason, "field gone");
  assert.deepEqual(res.affectedSegments, [0]);
  assert.deepEqual(calls, []);
});

test("runHealCommand without applyPath returns the heal-request", async () => {
  const runId = `heal-unit-req-${Date.now()}`;
  seed(runId);
  const res = /** @type {any} */ (await runHealCommand({ runId }, {}));
  assert.equal(res.healRequest.heldSegment, 0);
});

test("runHealCommand throws when no heal-request exists", async () => {
  const runId = `heal-unit-none-${Date.now()}`;
  ensureRunDirs(runId);
  await assert.rejects(() => runHealCommand({ runId }, {}));
});
