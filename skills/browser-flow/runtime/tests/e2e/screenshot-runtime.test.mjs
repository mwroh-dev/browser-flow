import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

/**
 * @param {string} runId
 * @param {"off" | "final" | "steps" | "both"} screenshotMode
 */
function writeSyntheticWorkflow(runId, screenshotMode) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result?name=Screenshot",
    steps: [
      { action: "goto" },
      { action: "fill", selector: "[data-bf=\"name-input\"]", value: "Screenshot" },
      { action: "click", selector: "[data-bf=\"launch\"]", expectUrl: "/synthetic/result?name=Screenshot" }
    ],
    verification: {
      expectedFinalUrl: "/synthetic/result?name=Screenshot",
      transitionTimeoutMs: 30_000,
      expectedNetwork: { url: "/api/complete?mode=synthetic", method: "POST", status: 200 },
      expectedEvidence: { selector: "[data-bf-evidence=\"result\"]", textIncludes: "Workflow Complete" }
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotMode,
      screenshotsPersisted: true
    }
  });
  return runPaths;
}

test("verify emits no screenshot artifacts when screenshot mode is off", async () => {
  const runId = `screenshots-off-${Date.now()}`;
  const runPaths = writeSyntheticWorkflow(runId, "off");

  generateRunner(runId);
  await verifyRun(runId, { headless: true });
  const report = /** @type {{ success: boolean }} */ (readJson(runPaths.verificationPath));

  assert.equal(report.success, true);
  assert.equal(existsSync(runPaths.screenshotsManifestPath), false);
  assert.equal(existsSync(runPaths.screenshotsDir), false);
});

for (const [mode, expectedKinds] of [
  ["steps", ["step", "step", "step"]],
  ["final", ["final"]],
  ["both", ["step", "step", "step", "final"]]
]) {
  test(`verify emits sanitized screenshot artifacts in ${mode} mode`, async () => {
    const runId = `screenshots-${mode}-${Date.now()}`;
    const runPaths = writeSyntheticWorkflow(runId, /** @type {"final" | "steps" | "both"} */ (mode));

    generateRunner(runId);
    await verifyRun(runId, { headless: true });
    const report = /** @type {{ success: boolean }} */ (readJson(runPaths.verificationPath));
    const manifest = /** @type {{ mode: string, entries: Array<{ kind: string, file: string, path: string, sanitized: boolean, redaction: string, stepIndex?: number, action?: string }> }} */ (
      readJson(runPaths.screenshotsManifestPath)
    );

    assert.equal(report.success, true);
    assert.equal(manifest.mode, mode);
    assert.deepEqual(manifest.entries.map((entry) => entry.kind), expectedKinds);
    for (const entry of manifest.entries) {
      assert.equal(entry.sanitized, true);
      assert.equal(entry.redaction, "dom-mask-v1");
      assert.equal(existsSync(entry.path), true);
      assert.equal(entry.path.startsWith(runPaths.screenshotsDir), true);
      assert.match(entry.file, /\.png$/);
    }
    if (mode !== "final") {
      assert.deepEqual(
        manifest.entries.filter((entry) => entry.kind === "step").map((entry) => entry.stepIndex),
        [0, 1, 2]
      );
    }
  });
}
