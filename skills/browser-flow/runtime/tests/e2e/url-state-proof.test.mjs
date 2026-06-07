import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { runCli } from "../helpers/cli.mjs";

function seedRouteIntentRun(runId, { withEvidence = false } = {}) {
  const runPaths = ensureRunDirs(runId);
  const startUrl = "http://127.0.0.1:59999/urlstate/home";
  const finalUrl = "http://127.0.0.1:59999/urlstate/map?id=abc&mode=rain";
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "urlstate",
    startUrl,
    unmasked: true
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: startUrl, text: "Route home", timestamp: 900, tabOrdinal: 0 },
    {
      type: "click",
      url: startUrl,
      selector: "a.more",
      role: "link",
      text: "More",
      href: "/urlstate/map?id=abc&mode=rain",
      timestamp: 1000,
      tabOrdinal: 0,
      locator: {
        role: "link",
        name: "More",
        href: "/urlstate/map?id=abc&mode=rain",
        structuralKey: "main>section.card|a||more|More"
      }
    },
    { type: "navigate", url: finalUrl, text: "Rain mode", timestamp: 1010, tabOrdinal: 0 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, withEvidence
    ? [{ selector: "[data-bf-evidence=\"urlstate-mode\"]", text: "Rain mode", url: finalUrl }]
    : []
  );
  return runPaths;
}

function confirmRouteIntent(runId, runPaths) {
  const preview = /** @type {any} */ (readJson(runPaths.routeIntentPreviewPath));
  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].strategy, "state-url");
  writeJson(runPaths.routeIntentResultPath, {
    schemaVersion: SCHEMA_VERSIONS.routeIntentResult,
    runId,
    decisions: preview.suggestions.map(
      /** @param {any} candidate */
      (candidate) => ({ candidateId: candidate.candidateId, verdict: "confirm-state-route" })
    )
  });
}

test("url-state final URL workflow analyzes and verifies without action network", { timeout: 120000 }, async () => {
  const runId = `url-state-proof-${Date.now()}`;
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "urlstate",
    "--headless"
  ]);
  assert.equal(typeof prepared.debugPort, "number");

  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);

  const runPaths = getRunPaths(runId);
  const workflow = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  const proofs = /** @type {Array<any>} */ (workflow.verification.proofs);
  assert.equal(workflow.finalUrl, "/urlstate/map?id=abc&mode=rain");
  assert.equal(workflow.verification.expectedNetwork, null);
  assert.ok(
    proofs.some((proof) => {
      return proof.kind === "url-state" &&
        proof.params.some(
          /** @param {{ key: string, value: string }} param */
          (param) => param.key === "mode" && param.value === "rain"
        );
    }),
    "workflow must carry mode=rain as a URL-state proof"
  );

  runCli(["generate", "--run-id", runId]);
  const result = runCli(["verify", "--run-id", runId, "--headless"]);
  const report = /** @type {any} */ (readJson(runPaths.verificationPath));
  const proofChecks = /** @type {Array<any>} */ (report.proofChecks);

  assert.equal(result.ok, true);
  assert.equal(report.success, true);
  assert.equal(report.pathComplete, true);
  assert.equal(report.replayOutcome, "passed");
  assert.ok(
    proofChecks.some((check) => check.kind === "url-state" && check.passed === true),
    "verification report must include a passing URL-state proof check"
  );
});

test("state-url intent route verifies by navigating directly to step.url", { timeout: 120000 }, () => {
  const runId = `url-state-intent-route-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "urlstate",
    startUrl: "/urlstate/map?id=abc&mode=rain",
    finalUrl: "/urlstate/map?id=abc&mode=wind",
    steps: [
      { action: "goto", url: "/urlstate/map?id=abc&mode=wind" }
    ],
    segments: [{ range: [0, 0], name: "state route", startPageKey: "", endPageKey: "" }],
    compounds: [],
    workflowGraph: { edges: [] },
    intentPlan: {
      strategy: "state-url",
      source: "route-intent",
      targetStateUrl: "/urlstate/map?id=abc&mode=wind",
      omittedStepIndexes: [1],
      checkpointResolved: "route_intent_review"
    },
    tabCount: 1,
    revealCandidates: [],
    scopeCandidates: [],
    verification: {
      expectedFinalUrl: "/urlstate/map?id=abc&mode=wind",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [
        { kind: "final-url", expectedUrl: "/urlstate/map?id=abc&mode=wind", required: true },
        {
          kind: "url-state",
          expectedUrl: "/urlstate/map?id=abc&mode=wind",
          params: [{ key: "mode", value: "wind" }],
          required: true
        }
      ],
      transitionTimeoutMs: 30000
    },
    security: {
      localOnly: true,
      installScope: "project-local",
      targetScope: "local",
      sanitizedArtifactsOnly: true,
      screenshotMode: "off",
      screenshotsPersisted: false
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    }
  });

  runCli(["generate", "--run-id", runId]);
  const result = runCli(["verify", "--run-id", runId, "--headless"]);
  const report = /** @type {any} */ (readJson(runPaths.verificationPath));

  assert.equal(result.ok, true);
  assert.equal(report.success, true);
  assert.equal(report.pathComplete, true);
  assert.equal(report.replayOutcome, "passed");
  assert.equal(report.checkpointResolved, "route_intent_review");
  assert.ok(
    report.proofChecks.some(
      /** @param {any} check */
      (check) => check.kind === "url-state" && check.passed === true && check.actual.url === "/urlstate/map?id=abc&mode=wind"
    )
  );
});

test("route intent review confirm reduces a More-link DOM path to URL-state replay", { timeout: 120000 }, () => {
  const runId = `route-intent-urlstate-e2e-${Date.now()}`;
  const runPaths = seedRouteIntentRun(runId);

  assert.throws(() => runCli(["analyze", "--run-id", runId]), /route intent review required/);
  confirmRouteIntent(runId, runPaths);
  runCli(["analyze", "--run-id", runId]);
  const workflow = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  assert.deepEqual(workflow.steps, [{ action: "goto", url: "/urlstate/map?id=abc&mode=rain" }]);
  assert.equal(workflow.intentPlan.strategy, "state-url");
  assert.equal(workflow.verification.expectedNetwork, null);
  assert.equal(workflow.verification.expectedEvidence, null);

  runCli(["generate", "--run-id", runId]);
  const result = runCli(["verify", "--run-id", runId, "--headless"]);
  const report = /** @type {any} */ (readJson(runPaths.verificationPath));

  assert.equal(result.ok, true);
  assert.equal(report.replayOutcome, "passed");
  assert.equal(report.checkpointResolved, "route_intent_review");
  assert.ok(report.proofChecks.some(
    /** @param {any} check */
    (check) => check.kind === "url-state" && check.passed === true
  ));
});

test("state route verifies URL-state and DOM evidence proofs together", { timeout: 120000 }, () => {
  const runId = `route-intent-urlstate-dom-evidence-${Date.now()}`;
  const runPaths = seedRouteIntentRun(runId, { withEvidence: true });

  assert.throws(() => runCli(["analyze", "--run-id", runId]), /route intent review required/);
  confirmRouteIntent(runId, runPaths);
  runCli(["analyze", "--run-id", runId]);
  const workflow = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  assert.equal(workflow.verification.expectedEvidence.textIncludes, "Rain mode");
  assert.deepEqual(
    workflow.verification.proofs.map(
      /** @param {any} proof */
      (proof) => proof.kind
    ),
    ["final-url", "url-state", "dom-evidence"]
  );

  runCli(["generate", "--run-id", runId]);
  const result = runCli(["verify", "--run-id", runId, "--headless"]);
  const report = /** @type {any} */ (readJson(runPaths.verificationPath));

  assert.equal(result.ok, true);
  assert.equal(report.replayOutcome, "passed");
  assert.ok(report.proofChecks.some(
    /** @param {any} check */
    (check) => check.kind === "dom-evidence" && check.passed === true
  ));
});
