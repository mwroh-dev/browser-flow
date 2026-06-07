import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureRunDirs, getRepoRoot, getRunPaths, getScoringPatternsPath } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { runScoreCommand } from "../../scripts/commands/score.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

test("runScoreCommand --apply writes weightOverride to the step, regenerates, re-runs (bounded)", async () => {
  const runId = `score-cmd-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.scoringRequestPath, { stepIndex: 1, intent: "open-talk", heldElement: { role: "link", structuralKey: "nav>x|a|||Section", hasHref: true, type: "", neighborCount: 0 }, drift: { winner: 0.64, margin: 0.01, mass: 0.13 } });
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual", startUrl: "http://x/", finalUrl: "http://x/t",
    steps: [{ action: "goto", url: "http://x/" }, { action: "click", selector: "nav a", locator: { role: "link", structuralKey: "nav>x|a|||Section", href: "/t" } }],
    verification: { expectedFinalUrl: "http://x/t" }, security: { localOnly: true }
  });
  const scoringResult = { schemaVersion: SCHEMA_VERSIONS.scoringResult, runId, stepIndex: 1, disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5 } }, generalizable: { id: "nav-tab", match: { structuralKeyIncludes: "nav>", hasHref: true }, signalWeights: { href: 1.5, structuralKey: 0.5 } } };
  const applyPath = `${runPaths.tasksDir}/scoring-result.json`;
  writeJson(applyPath, scoringResult);

  const calls = { regenerate: 0, cleanup: 0, rerun: 0 };
  const res = /** @type {any} */ (await runScoreCommand({ runId, applyPath, headless: true }, {
    regenerate: async () => { calls.regenerate++; },
    cleanup: async () => { calls.cleanup++; return { ok: true }; },
    rerun: async () => { calls.rerun++; return { report: { pathComplete: true } }; }
  }));

  assert.equal(res.status, "scored");
  assert.equal(calls.regenerate, 1, "regenerate once");
  assert.equal(calls.rerun, 1, "exactly one bounded re-run");
  const wf = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  assert.deepEqual(wf.steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 }, "weightOverride persisted to step.locator");
});

test("runScoreCommand --apply appends generalizable patterns to learned knowledge, not playbooks", async () => {
  const runId = `score-learned-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const playbookPath = resolve(getRepoRoot(), "agents/analyzer/playbooks/scoring-patterns.json");
  const playbookBefore = readFileSync(playbookPath, "utf8");

  writeJson(runPaths.scoringRequestPath, { stepIndex: 1, intent: "open-menu", heldElement: { role: "button" }, drift: { winner: 0.61, margin: 0.02, mass: 0.21 } });
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual", startUrl: "http://x/", finalUrl: "http://x/menu",
    steps: [{ action: "goto", url: "http://x/" }, { action: "click", selector: "button.menu", locator: { role: "button", type: "button", structuralKey: "header>button|||menu" } }],
    verification: { expectedFinalUrl: "http://x/menu" }, security: { localOnly: true }
  });
  const patternId = `learned-button-${Date.now()}`;
  const scoringResult = {
    schemaVersion: SCHEMA_VERSIONS.scoringResult,
    runId,
    stepIndex: 1,
    disambiguation: { weightOverrides: { role: 1.5, structuralKey: 1 } },
    generalizable: { id: patternId, match: { roleIn: ["button"], typeIn: ["button"] }, signalWeights: { role: 1.5, structuralKey: 1 } }
  };
  const applyPath = `${runPaths.tasksDir}/scoring-result.json`;
  writeJson(applyPath, scoringResult);

  await runScoreCommand({ runId, applyPath, headless: true }, {
    regenerate: async () => {},
    cleanup: async () => ({ ok: true }),
    rerun: async () => ({ report: { pathComplete: true } })
  });

  assert.equal(readFileSync(playbookPath, "utf8"), playbookBefore, "static playbook seed patterns must not be mutated");
  const learned = readJson(getScoringPatternsPath());
  assert.equal(learned.some((p) => p.id === patternId), true, "learned pattern should be appended to mutable knowledge store");
});

test("runScoreCommand without --apply returns the scoring-request", async () => {
  const runId = `score-req-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.scoringRequestPath, { stepIndex: 1, intent: "x", heldElement: {}, drift: {} });
  const res = /** @type {any} */ (await runScoreCommand({ runId }, {}));
  assert.equal(res.scoringRequest.stepIndex, 1);
});

test("runScoreCommand errors when there is no scoring-request", async () => {
  const runId = `score-none-${Date.now()}`;
  ensureRunDirs(runId);
  await assert.rejects(() => runScoreCommand({ runId }, {}), /no scoring-request/);
});
