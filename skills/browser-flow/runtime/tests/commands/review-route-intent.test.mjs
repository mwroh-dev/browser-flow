import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { reviewRouteIntentCommand } from "../../scripts/commands/review-route-intent.mjs";

test("review-route-intent briefs every route candidate and applies route verdicts", async () => {
  const runId = `route-intent-cmd-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.routeIntentPreviewPath, {
    schemaVersion: SCHEMA_VERSIONS.routeIntentPreview,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "ri1",
        strategy: "state-url",
        targetStateUrl: "http://example.test/map?id=abc&mode=rain",
        omittedSteps: [
          {
            stepIndex: 1,
            action: "click",
            text: "More",
            href: "/map?id=abc&mode=rain",
            pageUrl: "http://example.test/home",
            providerContext: {
              pattern: "spa-route-state",
              stateCarrier: "url",
              replayStrategy: "route-canonicalization",
              confidence: "medium"
            }
          }
        ],
        proofs: [
          {
            kind: "url-state",
            expectedUrl: "http://example.test/map?id=abc&mode=rain",
            params: [{ key: "mode", value: "rain" }],
            required: true
          }
        ],
        risks: ["omits captured DOM clicks"],
        recommendedAction: "confirm-state-route"
      },
      {
        candidateId: "ri2",
        strategy: "captured-dom",
        targetStateUrl: "http://example.test/home",
        omittedSteps: [],
        proofs: [],
        risks: ["state route unavailable"],
        recommendedAction: "keep-dom-route"
      }
    ]
  });

  const briefing = /** @type {any} */ (await reviewRouteIntentCommand({ "run-id": runId }));
  assert.equal(briefing.status, "needs_review");
  assert.equal(briefing.unresolved.length, 2, "briefing must show every unresolved candidate");
  assert.deepEqual(briefing.unresolved.map((entry) => entry.candidateId), ["ri1", "ri2"]);
  assert.equal(briefing.unresolved[0].targetStateUrl, "http://example.test/map?id=abc&mode=rain");
  assert.equal(briefing.unresolved[0].omittedSteps[0].text, "More");
  assert.equal(briefing.unresolved[0].proofs[0].kind, "url-state");
  assert.deepEqual(briefing.unresolved[0].risks, ["omits captured DOM clicks"]);
  assert.match(briefing.unresolved[0].briefing, /More/);
  assert.match(briefing.unresolved[0].briefing, /\/map\?id=abc&mode=rain/);
  assert.match(briefing.unresolved[0].briefing, /url-state/);
  assert.match(briefing.unresolved[0].briefing, /provider spa-route-state\/url\/route-canonicalization/);
  assert.match(briefing.unresolved[0].briefing, /mode=rain/);
  assert.match(briefing.unresolved[0].briefing, /omits captured DOM clicks/);

  const applyPath = `${runPaths.tasksDir}/route-intent-result.json`;
  writeJson(applyPath, {
    schemaVersion: SCHEMA_VERSIONS.routeIntentResult,
    runId,
    decisions: [
      { candidateId: "ri1", verdict: "confirm-state-route" },
      { candidateId: "ri2", verdict: "keep-dom-route" }
    ]
  });

  const applied = /** @type {any} */ (await reviewRouteIntentCommand({ "run-id": runId, apply: applyPath }));
  assert.equal(applied.status, "resolved");
  assert.deepEqual(applied.unresolved, []);
  assert.equal(readJson(runPaths.routeIntentResultPath).decisions.length, 2);
});

test("review-route-intent rejects keep/exclude capture-noise verdicts", async () => {
  const runId = `route-intent-invalid-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.routeIntentPreviewPath, {
    schemaVersion: SCHEMA_VERSIONS.routeIntentPreview,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "ri1",
        strategy: "state-url",
        targetStateUrl: "http://example.test/map?id=abc&mode=rain",
        recommendedAction: "confirm-state-route"
      }
    ]
  });
  const applyPath = `${runPaths.tasksDir}/route-intent-result.json`;
  writeJson(applyPath, {
    schemaVersion: SCHEMA_VERSIONS.routeIntentResult,
    runId,
    decisions: [{ candidateId: "ri1", verdict: "exclude" }]
  });

  await assert.rejects(
    () => reviewRouteIntentCommand({ "run-id": runId, apply: applyPath }),
    /Expected confirm-state-route or keep-dom-route/
  );
});
