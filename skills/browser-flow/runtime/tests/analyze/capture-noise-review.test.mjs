import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { detectCaptureNoise } from "../../scripts/analyze/capture-noise.mjs";

const BASE = "http://127.0.0.1:59999/reveal/noise";
const LAYERED_BASE = "http://127.0.0.1:59999/layered/start";
const LAYERED_PAGE = "http://127.0.0.1:59999/layered/panel";
const LAYERED_FINAL = "http://127.0.0.1:59999/layered/final";
const OBS_BASE = "http://127.0.0.1:59999/observation/start";
const OBS_FINAL = "http://127.0.0.1:59999/observation/final";
const JS_NAV_BASE = "http://127.0.0.1:59999/js-nav/start";
const JS_NAV_FINAL = "http://127.0.0.1:59999/js-nav/final";
const JOURNEY_BASE = "http://127.0.0.1:59999/journey/home";
const JOURNEY_MAP = "http://127.0.0.1:59999/journey/map";
const JOURNEY_FINAL = "http://127.0.0.1:59999/journey/map?layer=rain";

/**
 * @param {string} runId
 */
function seedRapidToggleRun(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", startUrl: BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/reveal/open", method: "POST", status: 200, timestamp: 1045 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"reveal-weather\"]", text: "Weather detail", url: "http://127.0.0.1:59999/reveal/weather" }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: BASE, text: "Reveal Noise", timestamp: 1000 },
    {
      type: "click",
      url: BASE,
      timestamp: 1010,
      actionId: "a1",
      selector: "a",
      text: "Expand menu",
      href: `${BASE}#closed`,
      role: "button",
      locator: { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||menu-toggle", href: `${BASE}#closed` }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      settleStatus: "interrupted",
      timestamp: 1011,
      beforeSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||menu-toggle" }],
      afterSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||menu-toggle" }]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1020,
      actionId: "a2",
      selector: "a",
      text: "Collapse menu",
      href: `${BASE}#open`,
      role: "button",
      locator: { role: "button", name: "Collapse menu", structuralKey: "header>nav>a|role=button||menu-toggle", href: `${BASE}#open` }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      settleStatus: "interrupted",
      timestamp: 1021,
      beforeSkeleton: [{ role: "button", name: "Collapse menu", structuralKey: "header>nav>a|role=button||menu-toggle" }],
      afterSkeleton: [{ role: "button", name: "Collapse menu", structuralKey: "header>nav>a|role=button||menu-toggle" }]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1030,
      actionId: "a3",
      selector: "a",
      text: "Expand menu",
      href: `${BASE}#closed`,
      role: "button",
      locator: { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||menu-toggle", href: `${BASE}#closed` }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a3",
      settleStatus: "settled",
      timestamp: 1031,
      beforeSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||menu-toggle" }],
      afterSkeleton: [
        { role: "button", name: "Collapse menu", structuralKey: "header>nav>a|role=button||menu-toggle" },
        { role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather" }
      ]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1040,
      actionId: "a4",
      selector: "a",
      text: "Weather",
      href: "http://127.0.0.1:59999/reveal/weather",
      role: "link",
      locator: { role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather", href: "http://127.0.0.1:59999/reveal/weather" }
    },
    { type: "navigate", url: "http://127.0.0.1:59999/reveal/weather", text: "Weather", timestamp: 1050 }
  ]);
  return runPaths;
}

/**
 * @param {string} runId
 */
function seedHiddenControlBurstRun(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", startUrl: LAYERED_BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/layered/complete", method: "POST", status: 200, timestamp: 1045 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"done\"]", text: "Done", url: LAYERED_FINAL }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: LAYERED_BASE, text: "Start", timestamp: 1000 },
    {
      type: "click",
      url: LAYERED_BASE,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-start",
      selector: "a",
      text: "Open layered panel",
      href: LAYERED_PAGE,
      role: "link",
      locator: { role: "link", name: "Open layered panel", structuralKey: "main>a|||Open layered panel", href: LAYERED_PAGE, box: { cx: 100, cy: 50, w: 120, h: 32 } }
    },
    { type: "navigate", url: LAYERED_PAGE, text: "Layered panel", timestamp: 1020 },
    {
      type: "click",
      url: LAYERED_PAGE,
      timestamp: 1030,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-panel",
      selector: "button",
      text: "Hidden layer A",
      role: "button",
      gestureId: "g-hidden",
      clickX: 240,
      clickY: 96,
      locator: { role: "button", name: "Hidden layer A", structuralKey: "div>button|role=button||Hidden layer A", box: { cx: 0, cy: 0, w: 0, h: 0 } },
      visibleHitTarget: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
      visibleActionableAncestor: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
      targetVisibility: { hasVisibleBox: false, rawBox: { cx: 0, cy: 0, w: 0, h: 0 }, visibleBox: { cx: 240, cy: 96, w: 120, h: 32 }, viewportIntersectionRatio: 0 }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-panel",
      settleStatus: "interrupted",
      beforeSkeleton: [],
      afterSkeleton: [],
      timestamp: 1031
    },
    {
      type: "click",
      url: LAYERED_PAGE,
      timestamp: 1032,
      actionId: "a3",
      actionSeq: 3,
      documentId: "doc-panel",
      selector: "button",
      text: "Hidden layer B",
      role: "button",
      gestureId: "g-hidden",
      clickX: 240,
      clickY: 96,
      locator: { role: "button", name: "Hidden layer B", structuralKey: "div>button|role=button||Hidden layer B", box: { cx: 0, cy: 0, w: 0, h: 0 } },
      visibleHitTarget: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
      visibleActionableAncestor: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
      targetVisibility: { hasVisibleBox: false, rawBox: { cx: 0, cy: 0, w: 0, h: 0 }, visibleBox: { cx: 240, cy: 96, w: 120, h: 32 }, viewportIntersectionRatio: 0 }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a3",
      actionSeq: 3,
      documentId: "doc-panel",
      settleStatus: "interrupted",
      beforeSkeleton: [],
      afterSkeleton: [],
      timestamp: 1033
    },
    {
      type: "click",
      url: LAYERED_PAGE,
      timestamp: 1040,
      actionId: "a4",
      actionSeq: 4,
      documentId: "doc-panel",
      selector: "a",
      text: "Continue",
      href: LAYERED_FINAL,
      role: "link",
      locator: { role: "link", name: "Continue", structuralKey: "main>a|||Continue", href: LAYERED_FINAL, box: { cx: 330, cy: 160, w: 90, h: 28 } }
    },
    { type: "navigate", url: LAYERED_FINAL, text: "Final", timestamp: 1050 }
  ]);
  return runPaths;
}

/**
 * @param {string} runId
 */
function seedObservationNoopRun(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", startUrl: OBS_BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/observation/complete", method: "POST", status: 200, timestamp: 1045 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"done\"]", text: "Done", url: OBS_FINAL }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: OBS_BASE, text: "Observation page", timestamp: 1000 },
    {
      type: "click",
      actionKind: "observation",
      url: OBS_BASE,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-obs",
      selector: "#content",
      text: "Forecast content panel",
      role: "main",
      observedTextSummary: "Sunrise 05:15 Sunset 19:44",
      pointer: { x: 520, y: 320 },
      locator: {
        role: "main",
        name: "Forecast content panel",
        structuralKey: "body>main|main|role=main|content|Forecast content panel",
        cleanId: "content",
        box: { cx: 600, cy: 500, w: 1200, h: 900 }
      },
      rawTarget: { selector: "#sunset-row", role: "", name: "Sunset 19:44", box: { cx: 520, cy: 320, w: 240, h: 48 } },
      visibleHitTarget: { selector: "#sunset-row", role: "", name: "Sunset 19:44", box: { cx: 520, cy: 320, w: 240, h: 48 } },
      visibleActionableAncestor: { selector: "#content", role: "main", name: "Forecast content panel", box: { cx: 600, cy: 500, w: 1200, h: 900 } },
      targetVisibility: {
        hasVisibleBox: true,
        rawBox: { cx: 600, cy: 500, w: 1200, h: 900 },
        visibleBox: { cx: 600, cy: 500, w: 1200, h: 900 },
        viewportIntersectionRatio: 0.75
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-obs",
      settleStatus: "settled",
      beforeSkeleton: [{ role: "main", name: "Forecast content panel", structuralKey: "body>main|main|role=main|content|Forecast content panel" }],
      afterSkeleton: [{ role: "main", name: "Forecast content panel", structuralKey: "body>main|main|role=main|content|Forecast content panel" }],
      timestamp: 1011
    },
    {
      type: "click",
      url: OBS_BASE,
      timestamp: 1040,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-obs",
      selector: "a",
      text: "Continue",
      href: OBS_FINAL,
      role: "link",
      locator: { role: "link", name: "Continue", structuralKey: "main>a|||Continue", href: OBS_FINAL, box: { cx: 330, cy: 160, w: 90, h: 28 } }
    },
    { type: "navigate", url: OBS_FINAL, text: "Final", timestamp: 1050 }
  ]);
  return runPaths;
}

/**
 * @param {string} runId
 */
function seedHiddenSingletonNoopRun(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", startUrl: LAYERED_PAGE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/layered/complete", method: "POST", status: 200, timestamp: 1045 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"done\"]", text: "Done", url: LAYERED_FINAL }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: LAYERED_PAGE, text: "Layered panel", timestamp: 1000 },
    {
      type: "click",
      url: LAYERED_PAGE,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-panel",
      selector: "button",
      text: "Hidden layer singleton",
      role: "button",
      locator: { role: "button", name: "Hidden layer singleton", structuralKey: "div>button|role=button||Hidden layer singleton", box: { cx: 0, cy: 0, w: 0, h: 0 } },
      visibleHitTarget: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
      visibleActionableAncestor: { selector: "[data-testid=\"visible-proxy\"]", role: "button", name: "Visible proxy" },
      targetVisibility: { hasVisibleBox: false, rawBox: { cx: 0, cy: 0, w: 0, h: 0 }, visibleBox: { cx: 240, cy: 96, w: 120, h: 32 }, viewportIntersectionRatio: 0 }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-panel",
      settleStatus: "settled",
      beforeSkeleton: [],
      afterSkeleton: [],
      timestamp: 1011
    },
    {
      type: "click",
      url: LAYERED_PAGE,
      timestamp: 1040,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-panel",
      selector: "a",
      text: "Continue",
      href: LAYERED_FINAL,
      role: "link",
      locator: { role: "link", name: "Continue", structuralKey: "main>a|||Continue", href: LAYERED_FINAL, box: { cx: 330, cy: 160, w: 90, h: 28 } }
    },
    { type: "navigate", url: LAYERED_FINAL, text: "Final", timestamp: 1050 }
  ]);
  return runPaths;
}

/**
 * @param {string} runId
 * @param {{ writeReview?: "exclude-navigation" | "keep-navigation" }} [options]
 */
function seedHiddenNavigationJourneyRun(runId, options = {}) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", startUrl: JOURNEY_BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/journey/rain", method: "GET", status: 200, timestamp: 1055 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"layer\"]", text: "Rain layer selected", url: JOURNEY_FINAL }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: JOURNEY_BASE, text: "Journey Home", timestamp: 1000 },
    {
      type: "click",
      url: JOURNEY_BASE,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-home",
      selector: "a",
      text: "Details",
      href: JOURNEY_MAP,
      role: "link",
      locator: {
        role: "link",
        name: "Details",
        structuralKey: "main>section>h2>a|||Details",
        href: JOURNEY_MAP,
        box: { cx: 210, cy: 120, w: 74, h: 18 }
      },
      visibleHitTarget: { selector: "h2", role: "", name: "Forecast Details", box: { cx: 180, cy: 118, w: 320, h: 48 } },
      visibleActionableAncestor: null,
      targetVisibility: {
        hasVisibleBox: true,
        rawBox: { cx: 210, cy: 120, w: 74, h: 18 },
        visibleBox: { cx: 180, cy: 118, w: 320, h: 48 },
        viewportIntersectionRatio: 1
      }
    },
    { type: "navigate", url: JOURNEY_MAP, text: "Journey Map", timestamp: 1020 },
    {
      type: "click",
      url: JOURNEY_MAP,
      timestamp: 1040,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-map",
      selector: "button",
      text: "Rain",
      role: "button",
      locator: {
        role: "button",
        name: "Rain",
        structuralKey: "aside>div>button|role=button||Rain",
        box: { cx: 340, cy: 160, w: 90, h: 36 }
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-map",
      settleStatus: "settled",
      timestamp: 1041,
      beforeSkeleton: [{ role: "button", name: "Rain", structuralKey: "aside>div>button|role=button||Rain" }],
      afterSkeleton: [{ role: "button", name: "Rain selected", structuralKey: "aside>div>button|role=button||Rain selected" }]
    }
  ]);
  if (options.writeReview) {
    writeJson(runPaths.captureNoisePreviewPath, {
      schemaVersion: 1,
      status: "needs_review",
      suggestions: [
        {
          candidateId: "cn1",
          kind: "ambiguous-hidden-control-burst",
          eventIndexes: [1],
          eventIndexRange: [1, 1],
          stableTargetKeys: ["xpath://main/section/h2/a"],
          hiddenTargets: ["Details"],
          visibleSummary: "Forecast Details h2",
          reason: "hidden-zero-box-noop",
          summary: "Navigation-looking hidden candidate",
          recommendedAction: "keep",
          effect: {
            kind: "navigation",
            fromUrl: JOURNEY_BASE,
            toUrl: JOURNEY_MAP,
            targetText: "Details",
            targetHref: JOURNEY_MAP,
            dependentRoute: true
          }
        }
      ]
    });
    writeJson(runPaths.captureNoiseResultPath, {
      schemaVersion: 1,
      runId,
      decisions: [
        { candidateId: "cn1", verdict: options.writeReview === "exclude-navigation" ? "exclude" : "keep" }
      ]
    });
  }
  return runPaths;
}

/**
 * @param {string} runId
 * @param {{ writeCleanPreview?: boolean, explicitReplayIntent?: boolean }} [options]
 */
function seedImplementationLayerNoopRun(runId, options = {}) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", startUrl: LAYERED_PAGE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/layered/complete", method: "POST", status: 200, timestamp: 1045 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"done\"]", text: "Done", url: LAYERED_FINAL }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: LAYERED_PAGE, text: "Layered panel", timestamp: 1000 },
    {
      type: "click",
      actionKind: "implementation-layer",
      isTrusted: false,
      url: LAYERED_PAGE,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-panel",
      selector: "button",
      text: "Internal timeline",
      href: options.explicitReplayIntent ? `${LAYERED_PAGE}#timeline` : undefined,
      role: "button",
      locator: {
        role: "button",
        name: "Internal timeline",
        structuralKey: "div>button|role=button||Internal timeline",
        href: options.explicitReplayIntent ? `${LAYERED_PAGE}#timeline` : undefined,
        box: { cx: 320, cy: 220, w: 96, h: 36 }
      },
      visibleHitTarget: { selector: "[data-testid=\"map-layer\"]", role: "region", name: "Visible map layer" },
      visibleActionableAncestor: { selector: "[data-testid=\"map-layer\"]", role: "region", name: "Visible map layer" },
      targetVisibility: {
        hasVisibleBox: true,
        rawBox: { cx: 320, cy: 220, w: 96, h: 36 },
        visibleBox: { cx: 320, cy: 220, w: 96, h: 36 },
        viewportIntersectionRatio: 1
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-panel",
      settleStatus: options.explicitReplayIntent ? "settled" : "interrupted",
      beforeSkeleton: [{ role: "button", name: "Internal timeline", structuralKey: "div>button|role=button||Internal timeline" }],
      afterSkeleton: options.explicitReplayIntent
        ? [
          { role: "button", name: "Internal timeline selected", structuralKey: "div>button|role=button||Internal timeline" },
          { role: "link", name: "Continue", structuralKey: "main>a|||Continue" }
        ]
        : [{ role: "button", name: "Internal timeline", structuralKey: "div>button|role=button||Internal timeline" }],
      timestamp: 1011
    },
    {
      type: "click",
      actionKind: "interactive",
      url: LAYERED_PAGE,
      timestamp: 1040,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-panel",
      selector: "a",
      text: "Continue",
      href: LAYERED_FINAL,
      role: "link",
      locator: { role: "link", name: "Continue", structuralKey: "main>a|||Continue", href: LAYERED_FINAL, box: { cx: 330, cy: 160, w: 90, h: 28 } }
    },
    { type: "navigate", url: LAYERED_FINAL, text: "Final", timestamp: 1050 }
  ]);
  if (options.writeCleanPreview) {
    writeJson(runPaths.captureNoisePreviewPath, {
      schemaVersion: 1,
      status: "clean",
      suggestions: []
    });
  }
  return runPaths;
}

/**
 * @param {string} runId
 */
function seedUntrustedJsNavigationRun(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "manual", startUrl: JS_NAV_BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: JS_NAV_FINAL, method: "GET", status: 200, timestamp: 1020 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"done\"]", text: "Done", url: JS_NAV_FINAL }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: JS_NAV_BASE, text: "Start", timestamp: 1000 },
    {
      type: "click",
      actionKind: "interactive",
      isTrusted: false,
      url: JS_NAV_BASE,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-js-nav",
      selector: "div",
      text: "Go",
      role: "",
      locator: {
        role: "",
        name: "Go",
        structuralKey: "body>main|div|||Go",
        relXPath: "//body/main/div",
        box: { cx: 40, cy: 80, w: 40, h: 32 }
      },
      targetVisibility: {
        hasVisibleBox: true,
        rawBox: { cx: 40, cy: 80, w: 40, h: 32 },
        visibleBox: { cx: 40, cy: 80, w: 40, h: 32 },
        viewportIntersectionRatio: 1
      }
    },
    { type: "navigate", url: JS_NAV_FINAL, text: "Done", timestamp: 1020 }
  ]);
  return runPaths;
}

test("compile requires capture-noise review when preview reports unresolved ambiguous prefix toggles", () => {
  const runId = `capture-noise-review-needed-${Date.now()}`;
  const runPaths = seedRapidToggleRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-prefix-toggle",
        pageKey: "manual/127.0.0.1/reveal/noise",
        eventIndexes: [1, 2, 3, 4],
        eventIndexRange: [1, 4],
        summary: "Rapid toggle prefix before final settled expand",
        recommendedAction: "exclude"
      }
    ]
  });

  assert.throws(
    () => compileRun(runId),
    /capture noise review required/i
  );
});

test("compile excludes reviewed capture-noise prefixes from the replay path and records ignored-events", () => {
  const runId = `capture-noise-exclude-${Date.now()}`;
  const runPaths = seedRapidToggleRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-prefix-toggle",
        pageKey: "manual/127.0.0.1/reveal/noise",
        eventIndexes: [1, 2, 3, 4],
        eventIndexRange: [1, 4],
        summary: "Rapid toggle prefix before final settled expand",
        recommendedAction: "exclude"
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [
      { candidateId: "cn1", verdict: "exclude" }
    ]
  });

  const workflow = compileRun(runId);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["Expand menu", "Weather"]);
  assert.equal(
    ignored.some((entry) => entry.reason === "user-excluded-capture-noise" && entry.candidateId === "cn1"),
    true
  );
});

test("compile keeps reviewed capture-noise prefixes only when strict risk is acknowledged", () => {
  const runId = `capture-noise-keep-${Date.now()}`;
  const runPaths = seedRapidToggleRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-prefix-toggle",
        pageKey: "manual/127.0.0.1/reveal/noise",
        eventIndexes: [1, 2, 3, 4],
        eventIndexRange: [1, 4],
        summary: "Rapid toggle prefix before final settled expand",
        recommendedAction: "exclude"
      }
    ],
    intentGroups: [
      {
        intentGroupId: "ig1",
        intentKind: "toggle-reveal",
        summary: "Open/close/open reveal journey before Weather",
        rawEventIndexes: [1, 2, 3, 4, 5, 6],
        candidateIds: ["cn1"],
        canonicalReplay: {
          keepEventIndexes: [5, 6],
          excludeEventIndexes: [1, 2, 3, 4],
          hrefPolicy: "ignore",
          reason: "Keep only the final settled reveal before the Weather link."
        },
        risk: "href-bearing-interrupted-toggle"
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [
      { candidateId: "cn1", verdict: "keep" }
    ],
    intentResolutions: [
      { intentGroupId: "ig1", resolution: "strict", riskAcknowledged: true }
    ]
  });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["Expand menu", "Collapse menu", "Expand menu", "Weather"]);
});

test("detectCaptureNoise flags generic settled toggle oscillation with label-changing structural keys", () => {
  const events = [
    { type: "navigate", url: BASE, text: "Generic Toggle", timestamp: 1000 },
    {
      type: "click",
      url: BASE,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-a",
      selector: "a",
      text: "More",
      href: "/",
      role: "button",
      locator: { role: "button", name: "More", structuralKey: "header>nav>a|role=button||More", relXPath: "//*[@id='menu-toggle']", href: "/" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-a",
      settleStatus: "settled",
      timestamp: 1011,
      beforeSkeleton: [{ role: "button", name: "More", structuralKey: "header>nav>a|role=button||More" }],
      afterSkeleton: [
        { role: "button", name: "Less", structuralKey: "header>nav>a|role=button||Less" },
        { role: "link", name: "Destination", structuralKey: "nav>ul>li>a|||Destination" }
      ]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1020,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-a",
      selector: "a",
      text: "Less",
      href: "#",
      role: "button",
      locator: { role: "button", name: "Less", structuralKey: "header>nav>a|role=button||Less", relXPath: "//*[@id='menu-toggle']", href: "#" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-a",
      settleStatus: "settled",
      timestamp: 1021,
      beforeSkeleton: [
        { role: "button", name: "Less", structuralKey: "header>nav>a|role=button||Less" },
        { role: "link", name: "Destination", structuralKey: "nav>ul>li>a|||Destination" }
      ],
      afterSkeleton: [{ role: "button", name: "More", structuralKey: "header>nav>a|role=button||More" }]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1030,
      actionId: "a3",
      actionSeq: 3,
      documentId: "doc-a",
      selector: "a",
      text: "More",
      href: "/",
      role: "button",
      locator: { role: "button", name: "More", structuralKey: "header>nav>a|role=button||More", relXPath: "//*[@id='menu-toggle']", href: "/" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a3",
      actionSeq: 3,
      documentId: "doc-a",
      settleStatus: "settled",
      timestamp: 1031,
      beforeSkeleton: [{ role: "button", name: "More", structuralKey: "header>nav>a|role=button||More" }],
      afterSkeleton: [
        { role: "button", name: "Less", structuralKey: "header>nav>a|role=button||Less" },
        { role: "link", name: "Destination", structuralKey: "nav>ul>li>a|||Destination" }
      ]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1040,
      actionId: "a4",
      actionSeq: 4,
      documentId: "doc-a",
      selector: "a",
      text: "Destination",
      href: "http://127.0.0.1:59999/reveal/destination",
      role: "link",
      locator: { role: "link", name: "Destination", structuralKey: "nav>ul>li>a|||Destination", href: "http://127.0.0.1:59999/reveal/destination" }
    },
    { type: "navigate", url: "http://127.0.0.1:59999/reveal/destination", text: "Destination", timestamp: 1050 }
  ];

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: BASE,
    finalNavigate: "http://127.0.0.1:59999/reveal/destination"
  });

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].kind, "ambiguous-prefix-toggle");
  assert.equal(preview.suggestions[0].reason, "settled-oscillation");
  assert.equal(preview.suggestions[0].recommendedAction, "exclude");
  assert.ok(String(preview.suggestions[0].stableTargetKey).includes("menu-toggle"));
  assert.deepEqual(preview.suggestions[0].eventIndexes, [1, 2, 3, 4]);
});

test("detectCaptureNoise groups a toggle journey with a canonical replay plan", () => {
  const runId = `rapid-toggle-intent-${Date.now()}`;
  const runPaths = seedRapidToggleRun(runId);
  const events = readJson(runPaths.sanitizedEventsPath);

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: BASE,
    finalNavigate: "http://127.0.0.1:59999/reveal/weather"
  });

  assert.equal(Array.isArray(preview.intentGroups), true);
  const group = preview.intentGroups.find((entry) => entry.intentKind === "toggle-reveal");
  assert.ok(group, `expected toggle-reveal intent group, got ${JSON.stringify(preview.intentGroups)}`);
  assert.match(group.summary, /Expand menu|Collapse menu|toggle/i);
  assert.deepEqual(group.rawEventIndexes, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(group.canonicalReplay.keepEventIndexes, [5, 6]);
  assert.deepEqual(group.canonicalReplay.excludeEventIndexes, [1, 2, 3, 4]);
  assert.equal(group.canonicalReplay.hrefPolicy, "ignore");
  assert.equal(group.risk, "href-bearing-interrupted-toggle");
});

test("detectCaptureNoise flags generic hidden zero-box control bursts after navigation", () => {
  const runId = `hidden-burst-detect-${Date.now()}`;
  const runPaths = seedHiddenControlBurstRun(runId);
  const events = readJson(runPaths.sanitizedEventsPath);

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: LAYERED_BASE,
    finalNavigate: LAYERED_FINAL
  });

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].kind, "ambiguous-hidden-control-burst");
  assert.equal(preview.suggestions[0].reason, "interrupted-hidden-control");
  assert.equal(preview.suggestions[0].recommendedAction, "exclude");
  assert.deepEqual(preview.suggestions[0].eventIndexes, [3, 4, 5, 6]);
  assert.match(preview.suggestions[0].visibleSummary, /Visible proxy/);
});

test("compile requires review for unresolved hidden zero-box control bursts", () => {
  const runId = `hidden-burst-review-needed-${Date.now()}`;
  seedHiddenControlBurstRun(runId);

  assert.throws(
    () => compileRun(runId),
    /capture noise review required/i
  );
});

test("compile recomputes stale clean preview and still requires hidden burst review", () => {
  const runId = `hidden-burst-stale-clean-${Date.now()}`;
  const runPaths = seedHiddenControlBurstRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "clean",
    suggestions: []
  });

  assert.throws(
    () => compileRun(runId),
    /capture noise review required/i
  );
});

test("compile excludes reviewed hidden zero-box control bursts only from replay path", () => {
  const runId = `hidden-burst-exclude-${Date.now()}`;
  const runPaths = seedHiddenControlBurstRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-hidden-control-burst",
        eventIndexes: [3, 4, 5, 6],
        eventIndexRange: [3, 6],
        stableTargetKeys: ["fallback:button|button"],
        hiddenTargets: ["Hidden layer A", "Hidden layer B"],
        visibleSummary: "Visible proxy",
        reason: "interrupted-hidden-control",
        summary: "Hidden layered controls fired before visible continuation",
        recommendedAction: "exclude"
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [
      { candidateId: "cn1", verdict: "exclude" }
    ]
  });

  const workflow = compileRun(runId);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["Open layered panel", "Continue"]);
  assert.equal(
    ignored.some((entry) => entry.reason === "user-excluded-hidden-control-burst" && entry.candidateId === "cn1"),
    true
  );
});

test("detectCaptureNoise flags generic observation no-op content clicks", () => {
  const runId = `observation-noop-detect-${Date.now()}`;
  const runPaths = seedObservationNoopRun(runId);
  const events = readJson(runPaths.sanitizedEventsPath);

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: OBS_BASE,
    finalNavigate: OBS_FINAL
  });

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].kind, "ambiguous-observation-click");
  assert.equal(preview.suggestions[0].reason, "content-observation-noop");
  assert.equal(preview.suggestions[0].recommendedAction, "exclude");
  assert.equal(preview.suggestions[0].effect.kind, "observation");
  assert.equal(preview.suggestions[0].effect.dependentRoute, false);
  assert.deepEqual(preview.suggestions[0].providerContext, {
    pattern: "auto-observation",
    stateCarrier: "none",
    replayStrategy: "exclude-observation",
    confidence: "medium"
  });
  assert.deepEqual(preview.suggestions[0].eventIndexes, [1, 2]);
  assert.match(preview.suggestions[0].observedTextSummary, /Sunrise 05:15 Sunset 19:44/);
});

test("compile excludes reviewed observation no-op clicks only from replay path", () => {
  const runId = `observation-noop-exclude-${Date.now()}`;
  const runPaths = seedObservationNoopRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-observation-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        stableTargetKeys: ["container:#content"],
        visibleSummary: "Sunset 19:44",
        observedTextSummary: "Sunrise 05:15 Sunset 19:44",
        reason: "content-observation-noop",
        summary: "Content observation click with no page transition",
        recommendedAction: "exclude"
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [
      { candidateId: "cn1", verdict: "exclude" }
    ]
  });

  const workflow = compileRun(runId);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["Continue"]);
  assert.equal(
    ignored.some((entry) => entry.reason === "user-excluded-observation-click" && entry.candidateId === "cn1"),
    true
  );
});

test("detectCaptureNoise flags a singleton hidden zero-box no-op click", () => {
  const runId = `hidden-singleton-detect-${Date.now()}`;
  const runPaths = seedHiddenSingletonNoopRun(runId);
  const events = readJson(runPaths.sanitizedEventsPath);

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: LAYERED_PAGE,
    finalNavigate: LAYERED_FINAL
  });

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].kind, "ambiguous-hidden-control-burst");
  assert.equal(preview.suggestions[0].reason, "hidden-zero-box-noop");
  assert.equal(preview.suggestions[0].recommendedAction, "exclude");
  assert.deepEqual(preview.suggestions[0].eventIndexes, [1, 2]);
  assert.match(preview.suggestions[0].visibleSummary, /Visible proxy/);
});

test("detectCaptureNoise does not classify hidden-looking navigation links as hidden no-op noise", () => {
  const runId = `hidden-navigation-detect-${Date.now()}`;
  const runPaths = seedHiddenNavigationJourneyRun(runId);
  const events = readJson(runPaths.sanitizedEventsPath);

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: JOURNEY_BASE,
    finalNavigate: JOURNEY_MAP
  });

  assert.equal(
    preview.suggestions.some((candidate) =>
      candidate.kind === "ambiguous-hidden-control-burst" &&
      candidate.reason === "hidden-zero-box-noop" &&
      candidate.eventIndexes?.includes(1)
    ),
    false,
    "navigation-producing Details link must not be briefed as a no-op hidden control"
  );
});

test("compile fails when excluding a navigation click whose destination still has later replay steps", () => {
  const runId = `route-continuity-exclude-${Date.now()}`;
  seedHiddenNavigationJourneyRun(runId, { writeReview: "exclude-navigation" });

  assert.throws(
    () => compileRun(runId),
    /Cannot exclude navigation click "Details" to .*journey\/map.*later replay steps depend/i
  );
});

test("compile keeps a reviewed navigation click when later steps depend on its destination", () => {
  const runId = `route-continuity-keep-${Date.now()}`;
  seedHiddenNavigationJourneyRun(runId, { writeReview: "keep-navigation" });

  const workflow = compileRun(runId);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["Details", "Rain"]);
});

test("compile applies canonical toggle intent by dropping raw prefix clicks and freezing href policy", () => {
  const runId = `canonical-toggle-compile-${Date.now()}`;
  const runPaths = seedRapidToggleRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-prefix-toggle",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        stableTargetKey: "shape:header>nav>a|role=button||",
        reason: "interrupted-prefix",
        summary: "User toggled a reveal control before clicking Weather",
        recommendedAction: "exclude"
      }
    ],
    intentGroups: [
      {
        intentGroupId: "ig1",
        intentKind: "toggle-reveal",
        summary: "Open/close/open reveal journey before Weather",
        rawEventIndexes: [1, 2, 3, 4, 5, 6],
        candidateIds: ["cn1"],
        canonicalReplay: {
          keepEventIndexes: [5, 6],
          excludeEventIndexes: [1, 2, 3, 4],
          hrefPolicy: "ignore",
          reason: "Keep only the final settled reveal before the Weather link."
        },
        risk: "href-bearing-interrupted-toggle"
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "exclude" }],
    intentResolutions: [{ intentGroupId: "ig1", resolution: "canonical" }]
  });

  const workflow = compileRun(runId);
  const clickSteps = workflow.steps.filter((step) => step.action === "click");

  assert.deepEqual(clickSteps.map((step) => step.text), ["Expand menu", "Weather"]);
  assert.equal(clickSteps[0].actionSemantics?.hrefPolicy, "ignore");
  assert.equal(clickSteps[0].actionSemantics?.kind, "stateful-affordance");
});

test("compile rejects excluding a new-tab opener while later tab steps remain", () => {
  const runId = `route-continuity-new-tab-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    startUrl: "http://127.0.0.1:59999/new-tab/home"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/new-tab/home", timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      selector: "a",
      text: "Weather",
      href: "http://127.0.0.1:59999/new-tab/weather",
      role: "link",
      url: "http://127.0.0.1:59999/new-tab/home",
      timestamp: 1010,
      tabOrdinal: 0,
      locator: { role: "link", name: "Weather", structuralKey: "nav>a|||Weather", href: "http://127.0.0.1:59999/new-tab/weather" }
    },
    { type: "navigate", url: "about:blank", timestamp: 1011, tabOrdinal: 1 },
    { type: "navigate", url: "http://127.0.0.1:59999/new-tab/weather", timestamp: 1020, tabOrdinal: 1 },
    {
      type: "click",
      selector: "button",
      text: "Finish",
      role: "button",
      url: "http://127.0.0.1:59999/new-tab/weather",
      timestamp: 1030,
      tabOrdinal: 1,
      locator: { role: "button", name: "Finish", structuralKey: "main>button|role=button||Finish" }
    },
    { type: "navigate", url: "http://127.0.0.1:59999/new-tab/done", timestamp: 1040, tabOrdinal: 1 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/new-tab/done", method: "GET", status: 200, timestamp: 1040 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"done\"]", text: "Done", url: "http://127.0.0.1:59999/new-tab/done" }
  ]);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-hidden-control-burst",
        eventIndexes: [1],
        eventIndexRange: [1, 1],
        reason: "hidden-zero-box-noop",
        summary: "New tab opener was ambiguous",
        recommendedAction: "keep",
        effect: {
          kind: "new-tab-navigation",
          fromUrl: "http://127.0.0.1:59999/new-tab/home",
          toUrl: "http://127.0.0.1:59999/new-tab/weather",
          toTabOrdinal: 1,
          targetText: "Weather",
          targetHref: "http://127.0.0.1:59999/new-tab/weather",
          dependentRoute: true
        }
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [{ candidateId: "cn1", verdict: "exclude" }]
  });

  assert.throws(
    () => compileRun(runId),
    /Cannot exclude navigation click "Weather" to .*new-tab\/weather.*later replay steps depend/i
  );
});

test("detectCaptureNoise flags untrusted implementation-layer no-op clicks even with visible boxes", () => {
  const runId = `implementation-layer-detect-${Date.now()}`;
  const runPaths = seedImplementationLayerNoopRun(runId);
  const events = readJson(runPaths.sanitizedEventsPath);

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: LAYERED_PAGE,
    finalNavigate: LAYERED_FINAL
  });

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].kind, "ambiguous-implementation-layer-click");
  assert.equal(preview.suggestions[0].reason, "interrupted-implementation-event");
  assert.equal(preview.suggestions[0].recommendedAction, "exclude");
  assert.deepEqual(preview.suggestions[0].eventIndexes, [1, 2]);
  assert.equal(preview.suggestions[0].actionKind, "implementation-layer");
  assert.equal(preview.suggestions[0].isTrusted, false);
  assert.equal(preview.suggestions[0].settleStatus, "interrupted");
  assert.equal(preview.suggestions[0].effect.kind, "implementation-noise");
  assert.equal(preview.suggestions[0].effect.dependentRoute, false);
});

test("detectCaptureNoise treats provider surface implementation clicks as state review, not discard-only noise", () => {
  const mapUrl = "https://weather.naver.com/map/09740660?visualMapType=sat";
  const events = [
    { type: "navigate", url: mapUrl, text: "Naver Weather", timestamp: 1000 },
    {
      type: "click",
      actionKind: "implementation-layer",
      isTrusted: false,
      url: mapUrl,
      timestamp: 1010,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-map",
      selector: "button",
      text: "강수예측",
      role: "button",
      locator: {
        role: "button",
        name: "강수예측",
        structuralKey: "div>div|button|type=button|map_depth_button.type_rain|강수예측",
        neighborTexts: ["위성", "레이더"],
        box: { cx: 720, cy: 120, w: 88, h: 32 }
      },
      targetVisibility: {
        hasVisibleBox: true,
        rawBox: { cx: 720, cy: 120, w: 88, h: 32 },
        visibleBox: { cx: 720, cy: 120, w: 88, h: 32 },
        viewportIntersectionRatio: 1
      }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-map",
      settleStatus: "settled",
      beforeSkeleton: [{ role: "button", name: "위성", structuralKey: "div>div|button|type=button|map_depth_button.type_sat|위성" }],
      afterSkeleton: [{ role: "button", name: "강수예측 선택됨", structuralKey: "div>div|button|type=button|map_depth_button.type_rain.is_selected|강수예측" }],
      changed: [{ role: "button", name: "강수예측 선택됨" }],
      timestamp: 1011
    }
  ];

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: mapUrl,
    finalNavigate: mapUrl
  });

  assert.equal(preview.status, "needs_review");
  assert.equal(preview.suggestions[0].kind, "ambiguous-implementation-layer-click");
  assert.equal(preview.suggestions[0].recommendedAction, "keep");
  assert.equal(preview.suggestions[0].effect.kind, "state-change");
  assert.deepEqual(preview.suggestions[0].providerContext, {
    pattern: "layered-control-surface",
    stateCarrier: "canvas-tile",
    replayStrategy: "state-proof-click",
    surfaceKey: "manual/weather.naver.com/map/:id#weather-map",
    controlGroup: "visual-layer",
    confidence: "high"
  });
});

test("compile gates stale clean captures that still contain replay-ineligible implementation-layer clicks", () => {
  const runId = `implementation-layer-stale-clean-${Date.now()}`;
  seedImplementationLayerNoopRun(runId, { writeCleanPreview: true });

  assert.throws(
    () => compileRun(runId),
    /(?:capture noise|replay eligibility) review required/i
  );
});

test("untrusted JS navigation clicks with a following navigate are replay eligible", () => {
  const runId = `untrusted-js-nav-${Date.now()}`;
  const runPaths = seedUntrustedJsNavigationRun(runId);
  const events = readJson(runPaths.sanitizedEventsPath);

  const preview = detectCaptureNoise({
    events,
    fixture: "manual",
    firstNavigate: JS_NAV_BASE,
    finalNavigate: JS_NAV_FINAL
  });
  const workflow = compileRun(runId);
  const clickStep = workflow.steps.find((step) => step.action === "click");

  assert.equal(preview.status, "clean");
  assert.equal(clickStep?.text, "Go");
});

test("compile excludes reviewed implementation-layer clicks from replay path", () => {
  const runId = `implementation-layer-exclude-${Date.now()}`;
  const runPaths = seedImplementationLayerNoopRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        stableTargetKeys: ["shape:div>button|role=button||Internal timeline"],
        reason: "interrupted-implementation-event",
        summary: "Internal implementation-layer click produced no replayable transition",
        recommendedAction: "exclude",
        actionKind: "implementation-layer",
        isTrusted: false,
        settleStatus: "interrupted"
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [
      { candidateId: "cn1", verdict: "exclude" }
    ]
  });

  const workflow = compileRun(runId);
  const ignored = /** @type {Array<Record<string, any>>} */ (readJson(runPaths.ignoredEventsPath).ignored);
  const clickTexts = workflow.steps.filter((step) => step.action === "click").map((step) => step.text);

  assert.deepEqual(clickTexts, ["Continue"]);
  assert.equal(
    ignored.some((entry) => entry.reason === "user-excluded-implementation-layer-click" && entry.candidateId === "cn1"),
    true
  );
});

test("compile keeps reviewed implementation-layer clicks strict with replay risk metadata", () => {
  const runId = `implementation-layer-keep-${Date.now()}`;
  const runPaths = seedImplementationLayerNoopRun(runId);
  writeJson(runPaths.captureNoisePreviewPath, {
    schemaVersion: 1,
    status: "needs_review",
    suggestions: [
      {
        candidateId: "cn1",
        kind: "ambiguous-implementation-layer-click",
        eventIndexes: [1, 2],
        eventIndexRange: [1, 2],
        stableTargetKeys: ["shape:div>button|role=button||Internal timeline"],
        reason: "interrupted-implementation-event",
        summary: "Internal implementation-layer click produced no replayable transition",
        recommendedAction: "exclude",
        actionKind: "implementation-layer",
        isTrusted: false,
        settleStatus: "interrupted"
      }
    ]
  });
  writeJson(runPaths.captureNoiseResultPath, {
    schemaVersion: 1,
    runId,
    decisions: [
      { candidateId: "cn1", verdict: "keep" }
    ]
  });

  const workflow = compileRun(runId);
  const internalStep = workflow.steps.find((step) => step.action === "click" && step.text === "Internal timeline");

  assert.equal(internalStep?.actionKind, "implementation-layer");
  assert.equal(internalStep?.replayRisk?.kind, "reviewed-implementation-layer");
});
