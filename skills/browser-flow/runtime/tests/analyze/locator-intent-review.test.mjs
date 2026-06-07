import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { writeLocatorIntentPreview } from "../../scripts/commands/done.mjs";

function seedGenericSameNameRun(runId) {
  const runPaths = ensureRunDirs(runId);
  const startUrl = "http://127.0.0.1:4173/weather";
  const finalUrl = "http://127.0.0.1:4173/map/sat";
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl,
    unmasked: true
  });
  writeJson(runPaths.networkSummaryPath, [
    { url: finalUrl, method: "GET", status: 200, timestamp: 1015 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"final\"]", text: "Satellite map", url: finalUrl }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: startUrl, timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      url: startUrl,
      timestamp: 1010,
      tabOrdinal: 0,
      selector: "section:nth-of-type(2) a",
      role: "link",
      text: "More",
      href: "/map/sat",
      locator: {
        role: "link",
        name: "More",
        href: "/map/sat",
        structuralKey: "main>section>h2|a||more|More",
        relXPath: "/html/body/main/section[2]/h2/a",
        box: { cx: 900, cy: 220, w: 50, h: 20 },
        viewport: { w: 1000, h: 800, dpr: 1 },
        semanticRegion: {
          role: "section",
          headingText: "Satellite imagery",
          label: "Satellite imagery",
          sameNameCountPage: 3,
          sameNameCountRegion: 1,
          targetPosition: { x: 0.91, y: 0.12 }
        }
      }
    },
    { type: "navigate", url: finalUrl, timestamp: 1020, tabOrdinal: 0 }
  ]);
  return runPaths;
}

function seedGenericSameNameMissingRegionRun(runId) {
  const runPaths = ensureRunDirs(runId);
  const startUrl = "http://127.0.0.1:4173/cards";
  const finalUrl = "http://127.0.0.1:4173/detail";
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl,
    unmasked: true
  });
  writeJson(runPaths.networkSummaryPath, [
    { url: finalUrl, method: "GET", status: 200, timestamp: 1015 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "Detail page", url: finalUrl }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: startUrl, timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      url: startUrl,
      timestamp: 1010,
      tabOrdinal: 0,
      selector: "a.more",
      role: "link",
      text: "More",
      href: "/detail",
      siblings: { totalMatchingRole: 4, totalMatchingSelector: 4 },
      locator: {
        role: "link",
        name: "More",
        href: "/detail",
        structuralKey: "main>div.card|a||more|More",
        relXPath: "/html/body/main/div[3]/a",
        box: { cx: 830, cy: 420, w: 44, h: 18 },
        viewport: { w: 1000, h: 800, dpr: 1 }
      }
    },
    { type: "navigate", url: finalUrl, timestamp: 1020, tabOrdinal: 0 }
  ]);
  return runPaths;
}

test("generic same-name link requires locator_intent_review before analyze", () => {
  const runId = `locator-intent-analyze-${Date.now()}`;
  const runPaths = seedGenericSameNameRun(runId);
  const diagnostics = writeLocatorIntentPreview(runPaths);

  assert.equal(diagnostics.status, "needs_review");
  assert.equal(diagnostics.suggestions.length, 1);
  assert.equal(diagnostics.suggestions[0].semanticRegionSummary, "Satellite imagery section");
  assert.throws(() => compileRun(runId), /locator intent review required/);
});

test("weak same-name link without semantic region still requires locator_intent_review", () => {
  const runId = `locator-intent-missing-region-${Date.now()}`;
  const runPaths = seedGenericSameNameMissingRegionRun(runId);
  const diagnostics = writeLocatorIntentPreview(runPaths);

  assert.equal(diagnostics.status, "needs_review");
  assert.equal(diagnostics.suggestions.length, 1);
  assert.equal(diagnostics.suggestions[0].sameNameCountPage, 4);
  assert.equal(diagnostics.suggestions[0].semanticRegionSummary, "");
  assert.throws(() => compileRun(runId), /locator intent review required/);
});

test("short domain same-name link with href and neighbor text stays on scorer path", () => {
  const runId = `locator-intent-stable-scorer-${Date.now()}`;
  const runPaths = seedGenericSameNameMissingRegionRun(runId);
  const events = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.sanitizedEventsPath));
  events[1].text = "지리";
  events[1].locator.name = "지리";
  events[1].locator.neighborTexts = ["사회 과목", "한국"];
  writeJson(runPaths.sanitizedEventsPath, events);
  const diagnostics = writeLocatorIntentPreview(runPaths);

  assert.equal(diagnostics.status, "clean");
  assert.equal(diagnostics.suggestions.length, 0);
});

test("generic navigation affordance with href and neighbor text still requires locator_intent_review when semantic region is missing", () => {
  const runId = `locator-intent-generic-neighbor-${Date.now()}`;
  const runPaths = seedGenericSameNameMissingRegionRun(runId);
  const events = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.sanitizedEventsPath));
  events[1].text = "자세히 보기";
  events[1].locator.name = "자세히 보기";
  events[1].locator.neighborTexts = ["위성영상"];
  writeJson(runPaths.sanitizedEventsPath, events);
  const diagnostics = writeLocatorIntentPreview(runPaths);

  assert.equal(diagnostics.status, "needs_review");
  assert.equal(diagnostics.suggestions.length, 1);
  assert.equal(diagnostics.suggestions[0].actionText, "자세히 보기");
  assert.equal(diagnostics.suggestions[0].recommendedAction, "confirm");
  assert.throws(() => compileRun(runId), /locator intent review required/);
});

test("confirmed locator intent marks link step with navigation fallback metadata", () => {
  const runId = `locator-intent-confirm-${Date.now()}`;
  const runPaths = seedGenericSameNameRun(runId);
  const diagnostics = writeLocatorIntentPreview(runPaths);
  writeJson(runPaths.locatorIntentResultPath, {
    schemaVersion: SCHEMA_VERSIONS.locatorIntentResult,
    runId,
    decisions: diagnostics.suggestions.map((candidate) => ({
      candidateId: candidate.candidateId,
      verdict: "confirm"
    }))
  });

  compileRun(runId);
  const workflow = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  const click = workflow.steps.find((step) => step.action === "click");
  assert.equal(click.locatorIntentReview.candidateId, "li1");
  assert.deepEqual(click.navigationFallback, {
    kind: "confirmed-link-navigation",
    checkpoint: "locator_intent_review",
    href: "/map/sat"
  });
  assert.deepEqual(click.replayPermission, {
    level: "confirmed-equivalence",
    reasonCode: "confirmed-pure-navigation",
    decisionSource: "user-review",
    fallbackAllowed: true,
    proofRequired: false
  });
});
