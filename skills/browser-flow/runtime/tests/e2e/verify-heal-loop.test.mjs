import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { runHealCommand } from "../../scripts/commands/heal.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Heal-loop e2e (real Chrome; deterministic — the heal-result is
 * hand-written, standing in for the heal sub-agent per spec §6 "synthetic mode").
 *
 * 1. A workflow whose fill step has a PHANTOM locator + bad selector -> the
 *    resolver cannot find it -> drift-hold at segment 0 + heal-request.json.
 * 2. A synthetic heal-result heals the phantom fill to the REAL item-name input.
 * 3. `bf heal --apply` replaces step.locator (self-heal cache), regenerates,
 *    runs cleanup, then ONE full re-run -> the healed fill now resolves -> the
 *    flow completes (no second hold). Proves the bounded heal loop end-to-end.
 */
test("verify-heal-loop: drift-hold -> heal-result -> bf heal --apply -> re-run completes", { timeout: 120000 }, async () => {
  const runId = `heal-loop-e2e-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/selfclean`;
    const createdUrl = `${baseUrl}/selfclean?created=1`;

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: createdUrl,
      steps: [
        { action: "goto" },
        // Phantom fill: selector + locator both match nothing -> resolution fails -> hold.
        {
          action: "fill",
          selector: "[data-bf=\"phantom-fill\"]",
          value: "heal-loop-x",
          locator: { role: "textbox", name: "Phantom Field", structuralKey: "phantom-key" }
        },
        { action: "click", selector: "[data-bf=\"item-create\"]", text: "Create", expectUrl: createdUrl }
      ],
      segments: [
        { range: [0, 2], startPageKey: "selfclean", endPageKey: "selfclean", name: "create" }
      ],
      verification: {
        expectedNetwork: null,
        expectedEvidence: null,
        expectedFinalUrl: "/selfclean?created=1",
        transitionTimeoutMs: 8000
      },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
    });

    generateRunner(runId);

    // 1. First run drift-holds at segment 0 (phantom fill cannot resolve).
    const held = await verifyRun(runId, { headless: true });
    const heldReport = /** @type {any} */ (held.report);
    assert.equal(heldReport.heldAtSegment, 0, `must hold at segment 0 — report: ${JSON.stringify(heldReport)}`);
    assert.ok(existsSync(runPaths.healRequestPath), "heal-request.json must exist after drift-hold");

    // 2. Synthetic heal-result: heal the phantom fill to the real item-name input.
    //    A real heal-agent copies the live affordance's signals; here we heal to the
    //    unique name "Item name" + relXPath (no fabricated structuralKey — the scorer
    //    would score a made-up key as 0 and drag confidence down; omitting it lets the
    //    scorer rely on the surviving high-weight signals).
    const healResultPath = `${runPaths.tasksDir}/heal-result.json`;
    writeJson(healResultPath, {
      schemaVersion: SCHEMA_VERSIONS.healResult,
      runId,
      status: "healed",
      healedLocators: [
        {
          match: { structuralKey: "phantom-key" },
          locator: {
            role: "textbox",
            name: "Item name",
            relXPath: "//*[@data-bf='item-name']"
          }
        }
      ]
    });

    // 3. bf heal --apply: apply -> regenerate -> cleanup -> ONE re-run (real deps).
    const res = /** @type {any} */ (await runHealCommand({ runId, applyPath: healResultPath, headless: true }));

    assert.equal(res.status, "healed", `heal must succeed — got ${JSON.stringify(res)}`);
    assert.ok(res.applied.includes("phantom-key"), `phantom-key must be applied — got ${JSON.stringify(res.applied)}`);

    // Self-heal cache persisted to the workflow.
    const healedWorkflow = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
    assert.equal(healedWorkflow.steps[1].locator.relXPath, "//*[@data-bf='item-name']", "step.locator must be replaced with the healed locator (self-heal cache)");
    assert.equal(healedWorkflow.steps[1].locator.name, "Item name", "healed locator name applied");

    // The re-run no longer drift-holds and the previously-failing fill executed.
    const rerunReport = /** @type {any} */ (res.rerun.report);
    assert.ok(rerunReport.heldAtSegment === null || rerunReport.heldAtSegment === undefined, `re-run must NOT drift-hold again — heldAtSegment=${JSON.stringify(rerunReport.heldAtSegment)}`);
    assert.ok((rerunReport.executedSteps || []).includes("fill"), `the healed fill must have executed on re-run — executedSteps=${JSON.stringify(rerunReport.executedSteps)}`);
    assert.equal(rerunReport.pathComplete, true, `re-run must complete the path — report: ${JSON.stringify(rerunReport)}`);
  } finally {
    await fixtureServer.close();
  }
});
