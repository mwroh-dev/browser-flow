import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { writeCaptureNoisePreview } from "../../scripts/commands/done.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

/**
 * @param {{
 *   runId: string,
 *   startUrl: string,
 *   finalUrl: string
 * }} input
 */
function seedLayeredReviewRun({ runId, startUrl, finalUrl }) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl
  });
  writeJson(runPaths.networkSummaryPath, [
    { url: finalUrl, method: "GET", status: 200, timestamp: 1035 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"layered-review-final\"]", text: "Layered review complete", url: finalUrl }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: startUrl, text: "Layered Review", timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      url: startUrl,
      timestamp: 1010,
      tabOrdinal: 0,
      actionId: "obs",
      actionSeq: 1,
      documentId: "doc-1",
      actionKind: "observation",
      selector: "main",
      role: "main",
      text: "Observation value: 19:44",
      observedTextSummary: "Observation value: 19:44",
      locator: {
        role: "main",
        name: "Layered Review Observation value: 19:44 Open final",
        structuralKey: "body|main|data-bf=content-region||",
        box: { cx: 220, cy: 180, w: 500, h: 260 }
      },
      targetVisibility: {
        hasVisibleBox: true,
        rawBox: { cx: 220, cy: 180, w: 500, h: 260 },
        viewportIntersectionRatio: 1
      },
      visibleHitTarget: { role: "main", name: "Observation value: 19:44", selector: "main" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "obs",
      actionSeq: 1,
      documentId: "doc-1",
      settleStatus: "settled",
      timestamp: 1011,
      beforeSkeleton: [{ role: "main", name: "Layered Review", structuralKey: "body|main|data-bf=content-region||" }],
      afterSkeleton: [{ role: "main", name: "Layered Review", structuralKey: "body|main|data-bf=content-region||" }]
    },
    {
      type: "click",
      url: startUrl,
      timestamp: 1020,
      tabOrdinal: 0,
      actionId: "hidden",
      actionSeq: 2,
      documentId: "doc-1",
      actionKind: "implementation-layer",
      selector: "[data-bf=\"hidden-internal\"]",
      role: "button",
      text: "Internal layer",
      locator: {
        role: "button",
        name: "Internal layer",
        structuralKey: "body>main|button|data-bf=hidden-internal||Internal layer",
        box: { cx: 0, cy: 0, w: 0, h: 0 }
      },
      targetVisibility: {
        hasVisibleBox: false,
        rawBox: { cx: 0, cy: 0, w: 0, h: 0 },
        pointerEvents: "auto"
      },
      visibleHitTarget: { role: "main", name: "Layered Review", selector: "main" },
      visibleActionableAncestor: { role: "main", name: "Layered Review", selector: "main" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "hidden",
      actionSeq: 2,
      documentId: "doc-1",
      settleStatus: "settled",
      timestamp: 1021,
      beforeSkeleton: [{ role: "button", name: "Internal layer", structuralKey: "body>main|button|data-bf=hidden-internal||Internal layer" }],
      afterSkeleton: [{ role: "button", name: "Internal layer", structuralKey: "body>main|button|data-bf=hidden-internal||Internal layer" }]
    },
    {
      type: "click",
      url: startUrl,
      timestamp: 1030,
      tabOrdinal: 0,
      actionId: "final",
      actionSeq: 3,
      documentId: "doc-1",
      actionKind: "interactive",
      selector: "[data-bf=\"final\"]",
      role: "link",
      text: "Open final",
      href: "/layered-review/final",
      locator: {
        role: "link",
        name: "Open final",
        structuralKey: "body>main|a|data-bf=final||Open final",
        href: "/layered-review/final",
        box: { cx: 84, cy: 172, w: 84, h: 20 },
        disambiguation: {
          weightOverrides: { href: 1.5, structuralKey: 0.5 }
        }
      },
      targetVisibility: {
        hasVisibleBox: true,
        rawBox: { cx: 84, cy: 172, w: 84, h: 20 },
        viewportIntersectionRatio: 1
      },
      visibleHitTarget: { role: "link", name: "Open final", selector: "[data-bf=\"final\"]" }
    },
    { type: "navigate", url: finalUrl, text: "Layered Review Final", timestamp: 1040, tabOrdinal: 0 }
  ]);
  return runPaths;
}

test("capture_noise_review excludes observation and implementation-layer no-op controls before replaying visible intent", { timeout: 120000 }, async () => {
  const runId = `capture-noise-visible-intent-${Date.now()}`;
  const server = await startFixtureServer();
  try {
    const startUrl = `${server.baseUrl}/layered-review`;
    const finalUrl = `${server.baseUrl}/layered-review/final`;
    const runPaths = seedLayeredReviewRun({ runId, startUrl, finalUrl });
    const diagnostics = writeCaptureNoisePreview(runPaths);

    assert.equal(diagnostics.status, "needs_review");
    assert.deepEqual(
      diagnostics.suggestions.map((candidate) => candidate.kind).sort(),
      ["ambiguous-implementation-layer-click", "ambiguous-observation-click"]
    );
    assert.throws(() => compileRun(runId), /capture noise review required/);

    writeJson(runPaths.captureNoiseResultPath, {
      schemaVersion: SCHEMA_VERSIONS.captureNoiseResult,
      runId,
      decisions: diagnostics.suggestions.map((candidate) => ({
        candidateId: candidate.candidateId,
        verdict: "exclude"
      }))
    });

    compileRun(runId);
    const ignored = /** @type {{ ignored: Array<{ reason: string }> }} */ (readJson(runPaths.ignoredEventsPath));
    assert.ok(ignored.ignored.some((entry) => entry.reason === "user-excluded-observation-click"));
    assert.ok(ignored.ignored.some((entry) => entry.reason === "user-excluded-implementation-layer-click"));

    generateRunner(runId);
    const result = /** @type {any} */ ((await verifyRun(runId, { headless: true, screenshots: "final" })).report);
    assert.equal(result.success, true, `visible-intent replay must pass — report: ${JSON.stringify(result)}`);
    assert.equal(result.pathComplete, true, `visible-intent replay must complete — report: ${JSON.stringify(result)}`);
    assert.equal(result.replayOutcome, "passed");
  } finally {
    await server.close();
  }
});
