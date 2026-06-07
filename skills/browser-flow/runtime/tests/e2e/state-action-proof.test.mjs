import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

test("same-page state action verifies with state-control proof", { timeout: 120000 }, async () => {
  const server = await startFixtureServer();
  try {
    const runId = `state-action-proof-${Date.now()}`;
    const runPaths = ensureRunDirs(runId);
    const url = `${server.baseUrl}/state-action`;
    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow,
      id: runId,
      fixture: "manual",
      startUrl: url,
      finalUrl: url,
      steps: [
        { action: "goto", url },
        {
          action: "click",
          selector: "[data-bf=\"rain-layer\"]",
          text: "Rain",
          replayIntent: "state_action",
          locator: { role: "button", name: "Rain", cleanId: "rain-layer", structuralKey: "main>button||rain-layer|Rain" }
        }
      ],
      segments: [{ range: [0, 1], name: "state action", startPageKey: "", endPageKey: "" }],
      compounds: [],
      workflowGraph: { edges: [] },
      tabCount: 1,
      revealCandidates: [],
      scopeCandidates: [],
      verification: {
        expectedFinalUrl: url,
        expectedNetwork: null,
        expectedEvidence: {
          selector: "[data-bf-evidence=\"state-layer\"]",
          textIncludes: "Rain layer selected"
        },
        proofs: [
          { kind: "final-url", expectedUrl: url, required: true },
          {
            kind: "state-control",
            stepIndex: 1,
            controlText: "Rain",
            controlRole: "button",
            domEvidence: {
              selector: "[data-bf-evidence=\"state-layer\"]",
              textIncludes: "Rain layer selected"
            },
            networkHints: [{ url: `${server.baseUrl}/api/state-layer?layer=rain`, method: "GET", status: 200 }],
            required: true
          }
        ]
      },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
      safety: { irreversibleStepIndexes: [], consentRequired: false, sandbox: { available: false, location: null } }
    });

    generateRunner(runId);
    await verifyRun(runId, { headless: true });
    const report = readJson(runPaths.verificationPath);

    assert.equal(report.success, true);
    assert.equal(report.pathComplete, true);
    assert.ok(report.proofChecks.some((check) => check.kind === "state-control" && check.passed === true));
  } finally {
    await server.close();
  }
});
