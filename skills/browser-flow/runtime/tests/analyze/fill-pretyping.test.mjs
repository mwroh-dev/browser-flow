import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { sanitizeEvent } from "../../scripts/sanitize/event-sanitizer.mjs";

const BASE = "http://127.0.0.1:59999/synthetic";

test("compile uses preTypingLocator for the fill step (pre-morph identity), keeps post-morph as fallback", () => {
  const runId = `fill-pretyping-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: BASE });
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1012 }
  ]);
  writeJson(runPaths.pageEvidencePath, [{ selector: "[data-bf-evidence=\"result\"]", text: "ok", url: BASE }]);
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: BASE, text: "Synthetic", timestamp: 1000 },
    {
      type: "input",
      url: BASE,
      timestamp: 1010,
      selector: "div",
      fieldName: "body",
      value: "hello",
      contentEditable: true,
      role: "textbox",
      // POST-typing (morphed) identity — what the field looks like AFTER content.
      locator: { role: "textbox", name: "hello", structuralKey: "div>div|div|role=textbox|cls|hello" },
      // PRE-typing host identity captured at focus — the empty-state anchor.
      preTypingLocator: { role: "presentation", name: "", structuralKey: "div>div|p|role=presentation||", neighborTexts: ["메모 작성…"] }
    },
    { type: "navigate", url: `${BASE}/result?name=x`, text: "Result", timestamp: 1015 }
  ]);

  compileRun(runId);

  const workflow = /** @type {{ steps: Array<Record<string, any>> }} */ (readJson(runPaths.workflowJsonPath));
  const fillStep = workflow.steps.find((s) => s.action === "fill");
  assert.ok(fillStep, "fill step must exist");
  assert.equal(fillStep.locator.role, "presentation", "fill must use the PRE-typing host identity");
  assert.deepEqual(fillStep.locator.neighborTexts, ["메모 작성…"], "pre-typing anchor must carry over");
  assert.equal(fillStep.postMorphLocator.role, "textbox", "post-morph locator kept as fallback");
});

test("sanitizer redacts forbidden names inside preTypingLocator (agent-blind)", () => {
  const out = /** @type {any} */ (
    sanitizeEvent(/** @type {any} */ ({
      type: "input",
      timestamp: 1,
      selector: "div",
      fieldName: "note",
      value: "x",
      contentEditable: true,
      role: "textbox",
      locator: { role: "textbox", name: "note" },
      preTypingLocator: { role: "presentation", name: "password", structuralKey: "k1", neighborTexts: ["메모 작성…"] }
    }))
  );
  assert.ok(out.preTypingLocator, "preTypingLocator must survive sanitization");
  assert.equal(out.preTypingLocator.name, "<redacted-field>", "forbidden name redacted");
  assert.equal(out.preTypingLocator.structuralKey, "k1", "structuralKey kept");
  assert.deepEqual(out.preTypingLocator.neighborTexts, ["메모 작성…"], "non-secret anchor kept");
});
