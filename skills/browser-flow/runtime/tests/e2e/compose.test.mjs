import test from "node:test";
import assert from "node:assert/strict";
import { composeCommand } from "../../scripts/commands/compose.mjs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";

test("compose succeeds only after injected generation and green verification/security", async () => {
  const sourceRunId = `compose-e2e-source-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [
      { action: "goto", url: "/synthetic", pageKey: "synthetic/root" },
      { action: "click", selector: "[data-bf=\"run\"]", pageKey: "synthetic/root" }
    ],
    segments: [{ range: [0, 1], startPageKey: "synthetic/root", endPageKey: "synthetic/root", name: "root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: {},
        notes: []
      }),
      learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({
        ok: true,
        verification: { success: true },
        security: { ok: true }
      })
    }
  );

  const summary = readJson(result.composeSummaryPath);

  assert.equal(result.ok, true);
  assert.equal(summary.status, "composed");
  assert.equal(summary.blockedReason, "none");
});
