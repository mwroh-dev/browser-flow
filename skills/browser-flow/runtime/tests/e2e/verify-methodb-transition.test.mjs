import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * Method-B before/after transition verification e2e (real browser): wired into the
 * runner and is fail-safe. A method-B step carries a recorded transition that demands
 * an affordance which will NOT appear at replay. The runner must capture before/after
 * skeletons, diff, find no overlap with the recorded transition, and drift-hold
 * (never proceed on a wrong reaction).
 */
test("verify-methodb: bogus recorded transition → live diff mismatch → drift-hold (fail-safe)", { timeout: 90000 }, async () => {
  const runId = `methodb-tx-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const fixtureServer = await startFixtureServer();
  try {
    const baseUrl = fixtureServer.baseUrl;
    const startUrl = `${baseUrl}/spa`;

    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl,
      finalUrl: `${baseUrl}/spa/done`,
      steps: [
        { action: "goto" },
        {
          action: "fill",
          selector: "[data-bf=\"spa-title\"]",
          contentEditable: true,
          value: "x",
          // Resolves via the scorer (name "Title"); method B + a recorded
          // transition that can NEVER match (the affordance won't appear).
          locator: {
            role: "textbox",
            name: "Title",
            disambiguation: { resolutionMethod: "B" }
          },
          transition: {
            refType: "input",
            appeared: [{ role: "button", name: "ghost", structuralKey: "GHOST-WILL-NEVER-APPEAR" }],
            disappeared: [],
            changed: []
          }
        }
      ],
      verification: {
        expectedFinalUrl: `${baseUrl}/spa/done`,
        expectedNetwork: null,
        expectedEvidence: null,
        transitionTimeoutMs: 15000
      },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
    });

    generateRunner(runId);
    const result = await verifyRun(runId, { headless: true });
    const report = /** @type {any} */ (result.report);

    assert.equal(report.success, false, "method-B mismatch must drift-hold (not succeed)");
    assert.ok(
      String(report.driftReason || report.error || "").includes("method-B transition mismatch"),
      `held reason must cite method-B transition mismatch — got: ${report.driftReason || report.error}`
    );
    // The fill must NOT count as executed (held during/after its verification).
    assert.equal(
      (report.executedSteps || []).includes("fill"),
      false,
      "the fill step must not be recorded as executed when its transition verification fails"
    );
  } finally {
    await fixtureServer.close();
  }
});
