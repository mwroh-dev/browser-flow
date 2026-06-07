import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { runScoreCommand } from "../../scripts/commands/score.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Reactive scoring loop e2e (real Chrome; synthetic model stand-in).
 *
 * 1. A workflow whose click element is ambiguous-but-present (default weights →
 *    mass<0.55 → "ambiguous locator" drift-hold with winner≥0.5) emits
 *    scoring-request.json at the run's scoringRequestPath.
 * 2. A synthetic scoring-result (hand-written, standing in for the scoring agent)
 *    carries a nav-tab weightOverride (href decisive).
 * 3. `bf score --apply` applies the weightOverride → workflow.steps[1].locator.disambiguation,
 *    regenerates the runner, cleans up, does exactly ONE bounded re-run.
 * 4. The re-run completes (pathComplete=true) and the nav-tab click executes.
 *
 * Mirrors verify-heal-loop.test.mjs structure exactly.
 */
test("verify-scoring-loop: ambiguous drift-hold -> scoring-request -> bf score --apply -> re-run completes", { timeout: 120000 }, async () => {
  const runId = `scoring-loop-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startFixtureServer();
  try {
    const baseUrl = server.baseUrl;

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl: `${baseUrl}/navtab`,
      finalUrl: `${baseUrl}/navtab/talk`,
      steps: [
        { action: "goto" },
        {
          action: "click",
          selector: "nav a",
          text: "Section",
          href: "/navtab/talk",
          expectUrl: `${baseUrl}/navtab/talk`,
          locator: {
            role: "link",
            name: "Section",
            structuralKey: "nav>STALE-WRAPPER|a|||Section",
            href: "/navtab/talk",
            relXPath: "//nav/a[2]"
          }
        }
      ],
      segments: [
        {
          range: [0, 1],
          startPageKey: "navtab",
          endPageKey: "navtab/talk",
          name: "open-talk"
        }
      ],
      verification: {
        expectedNetwork: null,
        expectedEvidence: null,
        expectedFinalUrl: "/navtab/talk",
        transitionTimeoutMs: 8000
      },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
    });

    generateRunner(runId);

    // 1. First run: ambiguous drift-holds at segment 0 + emits scoring-request.json.
    const held = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
    assert.equal(held.heldAtSegment, 0, `must hold at segment 0 — ${JSON.stringify(held)}`);
    assert.ok(String(held.driftReason).includes("ambiguous locator"), `drift must be ambiguous — ${held.driftReason}`);
    assert.ok(existsSync(runPaths.scoringRequestPath), "scoring-request.json must exist after ambiguous hold");

    const req = /** @type {any} */ (readJson(runPaths.scoringRequestPath));
    assert.equal(req.heldElement.hasHref, true, "scoring-request heldElement carries hasHref");
    assert.ok(req.drift.winner >= 0.5, `winner must clear the scoring floor — ${JSON.stringify(req.drift)}`);
    assert.ok(req.drift.mass < 0.55, `drift mass should be sub-threshold — ${JSON.stringify(req.drift)}`);

    // 2. Synthetic scoring-result (model stand-in): nav-tab weightOverride — href decisive.
    const applyPath = `${runPaths.tasksDir}/scoring-result.json`;
    writeJson(applyPath, {
      schemaVersion: SCHEMA_VERSIONS.scoringResult,
      runId,
      stepIndex: req.stepIndex,
      disambiguation: {
        weightOverrides: { href: 1.5, structuralKey: 0.5 },
        note: "nav tab: href decisive"
      }
    });

    // 3. bf score --apply: apply -> regenerate -> cleanup -> ONE bounded re-run.
    const res = /** @type {any} */ (await runScoreCommand({ runId, applyPath, headless: true }));
    assert.equal(res.status, "scored");

    const rerun = /** @type {any} */ (res.rerun.report);
    assert.equal(rerun.pathComplete, true, `re-run must complete — ${JSON.stringify(rerun)}`);
    assert.ok((rerun.executedSteps || []).includes("click"), "the nav-tab click executed on re-run");

    // 4. The workflow's step locator carries the applied disambiguation.
    const wf = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
    assert.deepEqual(wf.steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 });
  } finally {
    await server.close();
  }
});
