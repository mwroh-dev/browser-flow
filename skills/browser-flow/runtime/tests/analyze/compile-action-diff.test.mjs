import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { sanitizeEvent } from "../../scripts/sanitize/event-sanitizer.mjs";

const BASE = "http://127.0.0.1:59999/synthetic";

/**
 * Minimal manifest + sanitized event stream with a click + its action-diff.
 * @param {string} runId
 */
function seed(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1012 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "ok", url: BASE }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: BASE, text: "Synthetic", timestamp: 1000 },
    {
      type: "click",
      url: BASE,
      timestamp: 1010,
      selector: "[data-bf=\"composer\"]",
      text: "open",
      role: "presentation",
      locator: { role: "presentation", name: "", structuralKey: "div>p|p|role=presentation||", neighborTexts: ["메모 작성…"] }
    },
    // The answer key: clicking the composer makes the body textbox APPEAR (morph).
    {
      type: "action-diff",
      refType: "click",
      url: BASE,
      timestamp: 1011,
      beforeSkeleton: [
        { role: "button", name: "Menu", structuralKey: "k-menu" },
        { role: "textbox", name: "제목", structuralKey: "k-title" }
      ],
      afterSkeleton: [
        { role: "button", name: "Menu", structuralKey: "k-menu" },
        { role: "textbox", name: "제목", structuralKey: "k-title" },
        { role: "textbox", name: "메모 작성…", structuralKey: "k-body" }
      ]
    },
    { type: "navigate", url: `${BASE}/result?name=x`, text: "Result", timestamp: 1015 }
  ]);
  return runPaths;
}

test("compile attaches action-diff transition delta (appeared) to the click step", () => {
  const runId = `compile-action-diff-${Date.now()}`;
  const runPaths = seed(runId);

  compileRun(runId);

  const workflow = /** @type {{ steps: Array<Record<string, any>> }} */ (readJson(runPaths.workflowJsonPath));
  const clickStep = workflow.steps.find((s) => s.action === "click");
  assert.ok(clickStep, "click step must exist");
  assert.ok(clickStep.transition, "click step must carry a transition (answer key)");
  assert.equal(clickStep.transition.refType, "click");
  // The morph: body textbox appeared.
  const appearedKeys = clickStep.transition.appeared.map((/** @type {any} */ a) => a.structuralKey);
  assert.deepEqual(appearedKeys, ["k-body"], "transition.appeared must be the newly-shown body textbox");
  assert.equal(clickStep.transition.disappeared.length, 0);
  assert.equal(clickStep.transition.changed.length, 0);
});

test("compile freezes resolutionMethod=B for a signal-poor step with a distinguishing transition", () => {
  const runId = `compile-method-b-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1012 }
  ]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "[data-bf-evidence=\"result\"]", text: "ok", url: BASE }]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: BASE, text: "Synthetic", timestamp: 1000 },
    {
      type: "click",
      url: BASE,
      timestamp: 1010,
      selector: "[data-bf=\"anon\"]",
      text: "",
      role: "presentation",
      // signal-poor: no name / neighborTexts / cleanId / href.
      locator: { role: "presentation", name: "", structuralKey: "div>p|p|role=presentation||", neighborTexts: [] }
    },
    {
      type: "action-diff",
      refType: "click",
      url: BASE,
      timestamp: 1011,
      beforeSkeleton: [{ role: "button", name: "Menu", structuralKey: "k-menu" }],
      afterSkeleton: [
        { role: "button", name: "Menu", structuralKey: "k-menu" },
        { role: "textbox", name: "메모 작성…", structuralKey: "k-body" }
      ]
    },
    { type: "navigate", url: `${BASE}/result?name=x`, text: "Result", timestamp: 1015 }
  ]);

  compileRun(runId);

  const workflow = /** @type {{ steps: Array<Record<string, any>> }} */ (readJson(runPaths.workflowJsonPath));
  const clickStep = workflow.steps.find((s) => s.action === "click");
  assert.ok(clickStep, "click step must exist");
  assert.equal(
    clickStep.locator.disambiguation?.resolutionMethod,
    "B",
    "signal-poor step with a distinguishing transition must be frozen as method B"
  );
});

test("action-diff sanitization redacts forbidden skeleton names, keeps structure", () => {
  const out = /** @type {any} */ (
    sanitizeEvent(/** @type {any} */ ({
      type: "action-diff",
      refType: "input",
      actionId: "a1",
      actionSeq: 7,
      documentId: "doc-1",
      settleStatus: "interrupted",
      timestamp: 1,
      beforeSkeleton: [{ role: "textbox", name: "password", structuralKey: "k1" }],
      afterSkeleton: [{ role: "textbox", name: "메모 작성…", structuralKey: "k1" }]
    }))
  );
  assert.equal(out.type, "action-diff");
  assert.equal(out.refType, "input");
  assert.equal(out.actionId, "a1");
  assert.equal(out.actionSeq, 7);
  assert.equal(out.documentId, "doc-1");
  assert.equal(out.settleStatus, "interrupted");
  // "password" matches the forbidden-field pattern → redacted; structuralKey kept.
  assert.equal(out.beforeSkeleton[0].name, "<redacted-field>");
  assert.equal(out.beforeSkeleton[0].structuralKey, "k1");
  // Non-secret accessible text passes through sanitizeText.
  assert.equal(out.afterSkeleton[0].name, "메모 작성…");
});

test("compile matches duplicate actionIds by actionSeq before page-local fallback", () => {
  const runId = `compile-action-seq-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1040 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "ok", url: `${BASE}/done` }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: BASE, text: "Start", timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      url: BASE,
      timestamp: 1010,
      tabOrdinal: 0,
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-start",
      selector: "a",
      text: "More",
      href: "/",
      role: "button",
      locator: { role: "button", name: "More", structuralKey: "header>nav>a|role=button||More", relXPath: "//*[@id='toggle']", href: "/" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 1,
      documentId: "doc-start",
      settleStatus: "settled",
      url: BASE,
      tabOrdinal: 0,
      timestamp: 1011,
      beforeSkeleton: [{ role: "button", name: "More", structuralKey: "header>nav>a|role=button||More" }],
      afterSkeleton: [
        { role: "button", name: "Less", structuralKey: "header>nav>a|role=button||Less" },
        { role: "link", name: "Target", structuralKey: "nav>ul>li>a|||Target" }
      ]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1020,
      tabOrdinal: 0,
      actionId: "a2",
      actionSeq: 2,
      documentId: "doc-start",
      selector: "a",
      text: "Target",
      href: `${BASE}/next`,
      role: "link",
      locator: { role: "link", name: "Target", structuralKey: "nav>ul>li>a|||Target", href: `${BASE}/next` }
    },
    { type: "navigate", url: `${BASE}/next`, text: "Next", timestamp: 1030, tabOrdinal: 0 },
    {
      type: "click",
      url: `${BASE}/next`,
      timestamp: 1040,
      tabOrdinal: 0,
      actionId: "a1",
      actionSeq: 3,
      documentId: "doc-next",
      selector: "button",
      text: "Finish",
      role: "button",
      locator: { role: "button", name: "Finish", structuralKey: "main>button|button|type=button||Finish" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      actionSeq: 3,
      documentId: "doc-next",
      settleStatus: "settled",
      url: `${BASE}/next`,
      tabOrdinal: 0,
      timestamp: 1041,
      beforeSkeleton: [{ role: "button", name: "Finish", structuralKey: "main>button|button|type=button||Finish" }],
      afterSkeleton: [
        { role: "button", name: "Finish", structuralKey: "main>button|button|type=button||Finish" },
        { role: "status", name: "Done", structuralKey: "main>div|div|role=status||Done" }
      ]
    },
    { type: "navigate", url: `${BASE}/done`, text: "Done", timestamp: 1050, tabOrdinal: 0 }
  ]);

  compileRun(runId);

  const workflow = /** @type {{ steps: Array<Record<string, any>> }} */ (readJson(runPaths.workflowJsonPath));
  const clickSteps = workflow.steps.filter((s) => s.action === "click");
  assert.equal(clickSteps[0].actionId, "a1");
  assert.equal(clickSteps[0].actionSeq, 1);
  assert.equal(clickSteps[0].transition.actionSeq, 1);
  assert.deepEqual(
    clickSteps[0].transition.appeared.map((/** @type {any} */ entry) => entry.structuralKey),
    ["header>nav>a|role=button||Less", "nav>ul>li>a|||Target"]
  );
  assert.equal(clickSteps[2].actionSeq, 3);
  assert.equal(clickSteps[2].transition.actionSeq, 3);
});

test("compile recovers legacy duplicate actionIds by nearest same-page diff when actionSeq is absent", () => {
  const runId = `compile-legacy-action-id-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1040 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "ok", url: `${BASE}/done` }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: BASE, text: "Start", timestamp: 1000, tabOrdinal: 0 },
    {
      type: "click",
      url: BASE,
      timestamp: 1010,
      tabOrdinal: 0,
      actionId: "a1",
      selector: "a",
      text: "More",
      href: "/",
      role: "button",
      locator: { role: "button", name: "More", structuralKey: "header>nav>a|role=button||More", relXPath: "//*[@id='toggle']", href: "/" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      settleStatus: "settled",
      url: BASE,
      tabOrdinal: 0,
      timestamp: 1011,
      beforeSkeleton: [{ role: "button", name: "More", structuralKey: "header>nav>a|role=button||More" }],
      afterSkeleton: [
        { role: "button", name: "Less", structuralKey: "header>nav>a|role=button||Less" },
        { role: "link", name: "Target", structuralKey: "nav>ul>li>a|||Target" }
      ]
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1020,
      tabOrdinal: 0,
      actionId: "a2",
      selector: "a",
      text: "Target",
      href: `${BASE}/next`,
      role: "link",
      locator: { role: "link", name: "Target", structuralKey: "nav>ul>li>a|||Target", href: `${BASE}/next` }
    },
    { type: "navigate", url: `${BASE}/next`, text: "Next", timestamp: 1030, tabOrdinal: 0 },
    {
      type: "click",
      url: `${BASE}/next`,
      timestamp: 1040,
      tabOrdinal: 0,
      actionId: "a1",
      selector: "button",
      text: "Finish",
      role: "button",
      locator: { role: "button", name: "Finish", structuralKey: "main>button|button|type=button||Finish" }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      settleStatus: "settled",
      url: `${BASE}/next`,
      tabOrdinal: 0,
      timestamp: 1041,
      beforeSkeleton: [{ role: "button", name: "Finish", structuralKey: "main>button|button|type=button||Finish" }],
      afterSkeleton: [
        { role: "button", name: "Finish", structuralKey: "main>button|button|type=button||Finish" },
        { role: "status", name: "Done", structuralKey: "main>div|div|role=status||Done" }
      ]
    },
    { type: "navigate", url: `${BASE}/done`, text: "Done", timestamp: 1050, tabOrdinal: 0 }
  ]);

  compileRun(runId);

  const workflow = /** @type {{ steps: Array<Record<string, any>> }} */ (readJson(runPaths.workflowJsonPath));
  const clickSteps = workflow.steps.filter((s) => s.action === "click");
  assert.deepEqual(
    clickSteps[0].transition.appeared.map((/** @type {any} */ entry) => entry.structuralKey),
    ["header>nav>a|role=button||Less", "nav>ul>li>a|||Target"]
  );
});

test("compile correlates action-diff by actionId before queue order and preserves settleStatus", () => {
  const runId = `compile-action-id-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1012 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "ok", url: `${BASE}/result` }
  ]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: BASE, text: "Synthetic", timestamp: 1000 },
    {
      type: "click",
      url: BASE,
      timestamp: 1010,
      actionId: "a1",
      selector: "[data-bf=\"expand\"]",
      text: "Expand menu",
      href: "/",
      role: "button",
      locator: { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu", href: "/" }
    },
    {
      type: "click",
      url: BASE,
      timestamp: 1020,
      actionId: "a2",
      selector: "[data-bf=\"weather\"]",
      text: "Weather",
      href: `${BASE}/weather`,
      role: "link",
      locator: { role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather", href: `${BASE}/weather` }
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a2",
      settleStatus: "settled",
      url: BASE,
      timestamp: 1021,
      beforeSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" }],
      afterSkeleton: [
        { role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" },
        { role: "link", name: "Weather", structuralKey: "nav>ul>li>a|||Weather" }
      ]
    },
    {
      type: "action-diff",
      refType: "click",
      actionId: "a1",
      settleStatus: "interrupted",
      url: BASE,
      timestamp: 1022,
      beforeSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" }],
      afterSkeleton: [{ role: "button", name: "Expand menu", structuralKey: "header>nav>a|role=button||Expand menu" }]
    },
    { type: "navigate", url: `${BASE}/result`, text: "Result", timestamp: 1030 }
  ]);

  compileRun(runId);

  const workflow = /** @type {{ steps: Array<Record<string, any>> }} */ (readJson(runPaths.workflowJsonPath));
  const clickSteps = workflow.steps.filter((s) => s.action === "click");
  assert.equal(clickSteps.length, 2);
  assert.equal(clickSteps[0].actionId, "a1");
  assert.equal(clickSteps[0].transition.actionId, "a1");
  assert.equal(clickSteps[0].transition.settleStatus, "interrupted");
  assert.equal(clickSteps[1].actionId, "a2");
  assert.equal(clickSteps[1].transition.actionId, "a2");
  assert.equal(clickSteps[1].transition.settleStatus, "settled");
  assert.deepEqual(
    clickSteps[1].transition.appeared.map((/** @type {any} */ entry) => entry.structuralKey),
    ["nav>ul>li>a|||Weather"]
  );
});
