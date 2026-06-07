import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { reviewLocatorIntentCommand } from "../../scripts/commands/review-locator-intent.mjs";

test("review-locator-intent briefs every candidate and applies confirm verdicts", async () => {
  const runId = `locator-intent-cmd-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.locatorIntentPreviewPath, {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentPreview,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "li1",
        kind: "generic-same-name-action",
        eventIndex: 2,
        actionText: "More",
        pageUrl: "http://example.test/weather",
        targetHref: "/map/sat",
        sameNameCountPage: 3,
        sameNameCountRegion: 1,
        semanticRegionSummary: "Satellite imagery section",
        replayPermission: {
          level: "confirmed-equivalence",
          reasonCode: "generic-action-needs-semantic-region",
          decisionSource: "locator_intent_review",
          fallbackAllowed: true,
          proofRequired: false
        },
        recommendedAction: "confirm"
      },
      {
        candidateId: "li2",
        kind: "generic-same-name-action",
        eventIndex: 4,
        actionText: "More",
        pageUrl: "http://example.test/weather",
        targetHref: "/map/radar",
        sameNameCountPage: 3,
        sameNameCountRegion: 1,
        semanticRegionSummary: "Radar section",
        recommendedAction: "confirm"
      }
    ]
  });

  const briefing = /** @type {any} */ (await reviewLocatorIntentCommand({ "run-id": runId }));
  assert.equal(briefing.status, "needs_review");
  assert.equal(briefing.unresolved.length, 2, "briefing must show every unresolved candidate");
  assert.deepEqual(briefing.unresolved.map((entry) => entry.candidateId), ["li1", "li2"]);
  assert.ok(briefing.unresolved[0].semanticRegionSummary.includes("Satellite"));
  assert.match(briefing.unresolved[0].briefing, /More/);
  assert.match(briefing.unresolved[0].briefing, /Satellite imagery section/);
  assert.match(briefing.unresolved[0].briefing, /\/map\/sat/);
  assert.match(briefing.unresolved[0].briefing, /same-name count: 3/);
  assert.match(briefing.unresolved[0].briefing, /replay permission: confirmed-equivalence/);
  assert.equal(briefing.unresolved[0].replayPermission.level, "confirmed-equivalence");

  const applyPath = `${runPaths.tasksDir}/locator-intent-result.json`;
  writeJson(applyPath, {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentResult,
    runId,
    decisions: [
      { candidateId: "li1", verdict: "confirm" },
      { candidateId: "li2", verdict: "confirm" }
    ]
  });

  const applied = /** @type {any} */ (await reviewLocatorIntentCommand({ "run-id": runId, apply: applyPath }));
  assert.equal(applied.status, "resolved");
  assert.deepEqual(applied.unresolved, []);
  assert.equal(readJson(runPaths.locatorIntentResultPath).decisions.length, 2);
});

test("review-locator-intent rejects keep/exclude verdicts", async () => {
  const runId = `locator-intent-invalid-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.locatorIntentPreviewPath, {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentPreview,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "li1",
        kind: "generic-same-name-action",
        eventIndex: 2,
        actionText: "More",
        sameNameCountPage: 2,
        sameNameCountRegion: 1,
        semanticRegionSummary: "Satellite imagery section",
        recommendedAction: "confirm"
      }
    ]
  });
  const applyPath = `${runPaths.tasksDir}/locator-intent-result.json`;
  writeJson(applyPath, {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentResult,
    runId,
    decisions: [{ candidateId: "li1", verdict: "exclude" }]
  });

  await assert.rejects(
    () => reviewLocatorIntentCommand({ "run-id": runId, apply: applyPath }),
    /Expected confirm or recapture/
  );
});
