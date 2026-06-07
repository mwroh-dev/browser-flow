import test from "node:test";
import assert from "node:assert/strict";
import { applyScope } from "../../scripts/scope/scope-apply.mjs";

// applyScope writes the scope-agent's verdict into a signal-poor step's locator:
// anchors → neighborTexts (target signal), scope → disambiguation.scopeRule
// (candidate harvest rule), signalWeights → disambiguation.weightOverrides.

/** @returns {any[]} */
function keepSteps() {
  return [
    { action: "goto" },
    { action: "click", locator: { role: "presentation", name: "", structuralKey: "div>div>p|role=presentation||", neighborTexts: [] } }
  ];
}

/** @param {any} r */
const R = (r) => r;

test("applyScope: scoped result writes anchors + scopeRule + weightOverrides onto the step locator", () => {
  const steps = keepSteps();
  const out = applyScope(steps, R({
    schemaVersion: 1, runId: "r", stepIndex: 1, status: "scoped",
    anchors: ["메모 작성…"],
    scope: { ancestorUp: 1, includeAncestorSiblingText: true, anchorRole: "combobox" },
    signalWeights: { neighborTexts: 1.5, structuralKey: 0.5 }
  }));
  assert.equal(out.applied, true);
  assert.deepEqual(steps[1].locator.neighborTexts, ["메모 작성…"]);
  assert.deepEqual(steps[1].locator.disambiguation.scopeRule, { ancestorUp: 1, includeAncestorSiblingText: true, anchorRole: "combobox" });
  assert.deepEqual(steps[1].locator.disambiguation.weightOverrides, { neighborTexts: 1.5, structuralKey: 0.5 });
});

test("applyScope: merges weightOverrides with any pre-existing ones (coexist)", () => {
  const steps = keepSteps();
  steps[1].locator.disambiguation = { weightOverrides: { href: 1.5 } };
  applyScope(steps, R({
    schemaVersion: 1, runId: "r", stepIndex: 1, status: "scoped",
    anchors: ["메모 작성…"], scope: { ancestorUp: 1, includeAncestorSiblingText: true },
    signalWeights: { structuralKey: 0.5 }
  }));
  assert.deepEqual(steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 });
});

test("applyScope: scoped without signalWeights leaves weightOverrides untouched", () => {
  const steps = keepSteps();
  const out = applyScope(steps, R({
    schemaVersion: 1, runId: "r", stepIndex: 1, status: "scoped",
    anchors: ["메모 작성…"], scope: { ancestorUp: 1, includeAncestorSiblingText: true }
  }));
  assert.equal(out.applied, true);
  assert.deepEqual(steps[1].locator.neighborTexts, ["메모 작성…"]);
  assert.equal(steps[1].locator.disambiguation.weightOverrides, undefined);
});

test("applyScope: no-anchor verdict applies nothing (element stays signal-poor)", () => {
  const steps = keepSteps();
  const out = applyScope(steps, R({ schemaVersion: 1, runId: "r", stepIndex: 1, status: "no-anchor", reason: "nothing distinguishes it" }));
  assert.equal(out.applied, false);
  assert.deepEqual(steps[1].locator.neighborTexts, []);
  assert.equal(steps[1].locator.disambiguation, undefined);
});

test("applyScope: invalid stepIndex or missing locator is a safe no-op", () => {
  const steps = keepSteps();
  assert.equal(applyScope(steps, R({ stepIndex: 9, status: "scoped", anchors: ["x"], scope: {} })).applied, false);
  assert.equal(applyScope(steps, R({ stepIndex: 0, status: "scoped", anchors: ["x"], scope: {} })).applied, false); // step 0 = goto, no locator
});

test("applyScope: redaction-sentinel anchors are dropped (agent-blind defensive)", () => {
  const steps = keepSteps();
  const out = applyScope(steps, R({
    schemaVersion: 1, runId: "r", stepIndex: 1, status: "scoped",
    anchors: ["<redacted-secret>", "메모 작성…"], scope: { ancestorUp: 1 }
  }));
  assert.equal(out.applied, true);
  assert.deepEqual(steps[1].locator.neighborTexts, ["메모 작성…"], "redacted anchor must be filtered out");
});
