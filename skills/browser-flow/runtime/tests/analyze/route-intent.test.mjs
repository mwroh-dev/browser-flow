import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import {
  detectRouteIntent,
  applyRouteIntentReview
} from "../../scripts/analyze/route-intent.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";

const FINAL_URL = "https://example.com/map?id=abc&mode=rain";

test("detectRouteIntent proposes state-url when URL state can replace captured DOM clicks", () => {
  const steps = [
    { action: "goto", url: "https://example.com/home" },
    { action: "click", text: "More", href: "/map?id=abc&mode=rain", expectUrl: FINAL_URL }
  ];
  const proofs = [
    { kind: "final-url", expectedUrl: FINAL_URL, required: true },
    { kind: "url-state", expectedUrl: FINAL_URL, params: [{ key: "mode", value: "rain" }], required: true }
  ];

  const preview = detectRouteIntent({ steps, proofs, finalUrl: FINAL_URL });

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].strategy, "state-url");
  assert.equal(preview.suggestions[0].targetStateUrl, FINAL_URL);
  assert.equal(preview.suggestions[0].omittedSteps[0].text, "More");
});

test("detectRouteIntent does not propose state-url for unsafe form/input actions", () => {
  const steps = [
    { action: "goto", url: "https://example.com/form" },
    { action: "fill", value: "abc" },
    { action: "click", text: "Submit", formAction: "/submit" }
  ];
  const proofs = [
    { kind: "final-url", expectedUrl: "https://example.com/form?done=1", required: true },
    { kind: "url-state", expectedUrl: "https://example.com/form?done=1", params: [{ key: "done", value: "1" }], required: true }
  ];

  const preview = detectRouteIntent({ steps, proofs, finalUrl: "https://example.com/form?done=1" });

  assert.equal(preview.status, "clean");
  assert.equal(preview.suggestions.length, 0);
});

test("detectRouteIntent does not collapse same-page state controls into state-url routes", () => {
  const steps = [
    { action: "goto", url: "https://example.com/map?id=abc&mode=sat" },
    {
      action: "click",
      text: "Rain",
      role: "button",
      expectUrl: FINAL_URL,
      locator: { role: "button", name: "Rain" },
      transition: { kind: "same-page-state", selected: true }
    }
  ];
  const proofs = [
    { kind: "final-url", expectedUrl: FINAL_URL, required: true },
    { kind: "url-state", expectedUrl: FINAL_URL, params: [{ key: "mode", value: "rain" }], required: true }
  ];

  const preview = detectRouteIntent({ steps, proofs, finalUrl: FINAL_URL });

  assert.equal(preview.status, "clean");
  assert.equal(preview.suggestions.length, 0);
});

test("detectRouteIntent does not canonicalize provider layered controls", () => {
  const steps = [
    { action: "goto", url: "https://example.com/map?id=abc&mode=sat" },
    {
      action: "click",
      text: "Rain",
      expectUrl: FINAL_URL,
      providerContext: {
        pattern: "layered-control-surface",
        stateCarrier: "canvas-tile",
        replayStrategy: "state-proof-click",
        surfaceKey: "manual/example.com/map#weather-map",
        controlGroup: "visual-layer",
        confidence: "high"
      },
      locator: { name: "Rain" }
    }
  ];
  const proofs = [
    { kind: "final-url", expectedUrl: FINAL_URL, required: true },
    { kind: "url-state", expectedUrl: FINAL_URL, params: [{ key: "mode", value: "rain" }], required: true }
  ];

  const preview = detectRouteIntent({ steps, proofs, finalUrl: FINAL_URL });

  assert.equal(preview.status, "clean");
  assert.equal(preview.suggestions.length, 0);
});

test("applyRouteIntentReview fails unresolved candidates and rewrites confirmed state-url route", () => {
  const steps = [
    { action: "goto", url: "https://example.com/home" },
    { action: "click", text: "More", href: "/map?id=abc&mode=rain", expectUrl: FINAL_URL }
  ];
  const proofs = [
    { kind: "final-url", expectedUrl: FINAL_URL, required: true },
    { kind: "url-state", expectedUrl: FINAL_URL, params: [{ key: "mode", value: "rain" }], required: true }
  ];
  const preview = detectRouteIntent({ steps, proofs, finalUrl: FINAL_URL });

  assert.throws(
    () => applyRouteIntentReview({ steps, proofs, finalUrl: FINAL_URL, preview, result: null }),
    /route intent review required/
  );

  const applied = applyRouteIntentReview({
    steps,
    proofs,
    finalUrl: FINAL_URL,
    preview,
    result: {
      schemaVersion: SCHEMA_VERSIONS.routeIntentResult,
      runId: "inline",
      decisions: [{ candidateId: "ri1", verdict: "confirm-state-route" }]
    }
  });

  assert.deepEqual(applied.steps, [{ action: "goto", url: FINAL_URL }]);
  assert.equal(applied.intentPlan.strategy, "state-url");
  assert.deepEqual(applied.intentPlan.omittedStepIndexes, [1]);
  assert.deepEqual(applied.proofs.map((proof) => proof.kind), ["final-url", "url-state"]);
});

test("compile writes route-intent preview and requires confirmation before reducing DOM path", () => {
  const runId = `route-intent-compile-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", unmasked: true, startUrl: "https://example.com/home" });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://example.com/home", timestamp: 1000 },
    { type: "click", text: "More", href: "/map?id=abc&mode=rain", timestamp: 1010, locator: { role: "link", name: "More", href: "/map?id=abc&mode=rain" } },
    { type: "navigate", url: FINAL_URL, timestamp: 1020 }
  ]);
  writeJson(runPaths.networkSummaryPath, []);
  writeJson(runPaths.pageEvidencePath, []);

  assert.throws(() => compileRun(runId), /route intent review required/);
  const preview = readJson(runPaths.routeIntentPreviewPath);
  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].targetStateUrl, FINAL_URL);

  writeJson(runPaths.routeIntentResultPath, {
    schemaVersion: SCHEMA_VERSIONS.routeIntentResult,
    runId,
    decisions: [{ candidateId: "ri1", verdict: "confirm-state-route" }]
  });

  const workflow = compileRun(runId);
  assert.deepEqual(workflow.steps, [{ action: "goto", url: FINAL_URL }]);
  assert.equal(workflow.intentPlan.strategy, "state-url");
  assert.equal(workflow.verification.expectedNetwork, null);
  assert.deepEqual(workflow.verification.proofs.map((proof) => proof.kind), ["final-url", "url-state"]);
});
