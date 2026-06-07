import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";

// compile propagates step.tabOrdinal + workflow.tabCount

test("compile propagates tabOrdinal from events onto steps and computes tabCount=2", () => {
  const runId = `compile-tabordinal-multitab-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    // tab0: initial navigate
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900, tabOrdinal: 0 },
    // tab0: click that opens a new tab
    { type: "click", selector: "[data-bf=\"open-tab\"]", text: "Open New Tab", timestamp: 1000, tabOrdinal: 0 },
    // tab1: navigate in the new tab (triggers expectUrl on the click above)
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/tab1", text: "Tab 1 Page", timestamp: 1005, tabOrdinal: 1 },
    // tab1: click on the new tab page
    { type: "click", selector: "[data-bf=\"finish\"]", text: "Finish", timestamp: 1010, tabOrdinal: 1 },
    // tab1: final result navigate
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Tab1", text: "Tab 1 Result", timestamp: 1020, tabOrdinal: 1 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Tab1" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(
    workflow.steps.some((s) => /** @type {any} */ (s).tabOrdinal === 1),
    "a step must carry tabOrdinal 1"
  );
  assert.equal(/** @type {any} */ (workflow).tabCount, 2, "tabCount reflects two tabs");
});

test("expectUrl pairs only a SAME-tab non-blank navigate (cross-tab/about:blank not leaked)", () => {
  const runId = `compile-expecturl-tab-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Demo", timestamp: 900, tabOrdinal: 0 },
    // tab0 click OPENS a new tab — the original tab does NOT navigate.
    { type: "click", selector: "[data-bf=\"open\"]", text: "Open", timestamp: 1000, tabOrdinal: 0 },
    // the immediately-following navigates belong to the NEW tab (tab1): blank then real.
    { type: "navigate", url: "about:blank", timestamp: 1002, tabOrdinal: 1 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/tab1", text: "Tab1", timestamp: 1005, tabOrdinal: 1 },
    // tab1 click -> SAME-tab real navigate => SHOULD get expectUrl.
    { type: "click", selector: "[data-bf=\"finish\"]", text: "Finish", timestamp: 1010, tabOrdinal: 1 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=X", text: "Result", timestamp: 1020, tabOrdinal: 1 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=X" }
  ]);

  const workflow = compileRun(runId);
  const openClick = workflow.steps.find((s) => /** @type {any} */ (s).tabOrdinal === 0 && /** @type {any} */ (s).action === "click");
  const finishClick = workflow.steps.find((s) => /** @type {any} */ (s).tabOrdinal === 1 && /** @type {any} */ (s).action === "click");
  assert.equal(/** @type {any} */ (openClick).expectUrl, undefined, "tab0 tab-opening click must NOT inherit the new tab's navigate as expectUrl");
  assert.ok(
    /** @type {any} */ (finishClick).expectUrl && String(/** @type {any} */ (finishClick).expectUrl).includes("/synthetic/result"),
    "tab1 click pairs with its own same-tab navigate"
  );
});

test("legacy events (no tabOrdinal) -> all steps tabOrdinal 0, tabCount=1", () => {
  const runId = `compile-tabordinal-legacy-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  // Legacy events — no tabOrdinal field at all
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "input", selector: "[data-bf=\"name-input\"]", value: "Codex", secret: false, timestamp: 950 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  const workflow = compileRun(runId);

  assert.ok(
    workflow.steps.every((s) => (/** @type {any} */ (s).tabOrdinal ?? 0) === 0),
    "legacy events -> all steps tabOrdinal 0"
  );
  assert.equal(/** @type {any} */ (workflow).tabCount, 1, "legacy -> tabCount 1");
});
