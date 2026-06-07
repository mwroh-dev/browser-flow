import test from "node:test";
import assert from "node:assert/strict";
import { selectResolutionMethod } from "../../scripts/lib/method-select.mjs";
import { applyScope } from "../../scripts/scope/scope-apply.mjs";

test("selectResolutionMethod — stable anchor → A", () => {
  // name present = stable anchor.
  assert.equal(selectResolutionMethod({ name: "Submit", structuralKey: "k" }, undefined), "A");
  // neighborTexts present = stable anchor, even with a transition.
  assert.equal(
    selectResolutionMethod({ name: "", neighborTexts: ["메모 작성…"] }, { appeared: [{ structuralKey: "x" }] }),
    "A"
  );
});

test("selectResolutionMethod — signal-poor + distinguishing transition → B", () => {
  const signalPoor = { name: "", neighborTexts: [], cleanId: "", href: "", structuralKey: "div>p|p|role=presentation||" };
  assert.equal(selectResolutionMethod(signalPoor, { appeared: [{ structuralKey: "k-body" }], changed: [] }), "B");
  assert.equal(selectResolutionMethod(signalPoor, { appeared: [], changed: [{ old: {}, live: {} }] }), "B");
});

test("selectResolutionMethod — signal-poor but no usable transition → A (fail-safe)", () => {
  const signalPoor = { name: "", neighborTexts: [], cleanId: "", href: "" };
  assert.equal(selectResolutionMethod(signalPoor, undefined), "A");
  assert.equal(selectResolutionMethod(signalPoor, { appeared: [], changed: [] }), "A");
});

test("applyScope freezes model method verdict B even with no anchors", () => {
  const steps = [/** @type {any} */ ({ action: "click", locator: { role: "presentation", name: "" } })];
  const res = applyScope(steps, { stepIndex: 0, status: "no-anchor", resolutionMethod: "B" });
  assert.equal(res.applied, true);
  assert.equal(steps[0].locator.disambiguation.resolutionMethod, "B");
  // No anchors applied (none provided).
  assert.equal(steps[0].locator.neighborTexts, undefined);
});

test("applyScope still applies anchors (method A) and method together", () => {
  const steps = [/** @type {any} */ ({ action: "click", locator: { role: "presentation", name: "" } })];
  const res = applyScope(steps, {
    stepIndex: 0,
    status: "scoped",
    anchors: ["메모 작성…"],
    scope: { ancestorUp: 1, includeAncestorSiblingText: true },
    resolutionMethod: "A"
  });
  assert.equal(res.applied, true);
  assert.equal(res.anchorCount, 1);
  assert.deepEqual(steps[0].locator.neighborTexts, ["메모 작성…"]);
  assert.equal(steps[0].locator.disambiguation.resolutionMethod, "A");
  assert.equal(steps[0].locator.disambiguation.scopeRule.ancestorUp, 1);
});
