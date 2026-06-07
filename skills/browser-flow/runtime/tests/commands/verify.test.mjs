import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyCommand } from "../../scripts/commands/verify.mjs";

test("verifyCommand --screenshots overrides workflow screenshot mode and emits artifacts", async () => {
  const runId = `verify-cmd-shots-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result?name=CmdShot",
    steps: [
      { action: "goto" },
      { action: "fill", selector: "[data-bf=\"name-input\"]", value: "CmdShot" },
      { action: "click", selector: "[data-bf=\"launch\"]", expectUrl: "/synthetic/result?name=CmdShot" }
    ],
    verification: {
      expectedFinalUrl: "/synthetic/result?name=CmdShot",
      transitionTimeoutMs: 30_000,
      expectedNetwork: { url: "/api/complete?mode=synthetic", method: "POST", status: 200 },
      expectedEvidence: { selector: "[data-bf-evidence=\"result\"]", textIncludes: "Workflow Complete" }
    },
    security: {
      localOnly: true,
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    }
  });

  generateRunner(runId);
  const result = await verifyCommand({ "run-id": runId, screenshots: "final", headless: true });
  const workflow = readJson(runPaths.workflowJsonPath);
  const manifest = readJson(runPaths.screenshotsManifestPath);

  assert.equal(result.report.replayOutcome, "passed");
  assert.equal(workflow.security.screenshotMode, "final");
  assert.equal(workflow.security.screenshotsPersisted, true);
  assert.equal(manifest.mode, "final");
  assert.equal(manifest.entries.length, 1);
  assert.equal(existsSync(manifest.entries[0].path), true);
});
