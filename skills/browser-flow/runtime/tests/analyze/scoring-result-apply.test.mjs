import test from "node:test";
import assert from "node:assert/strict";
import { applyScoringResult } from "../../scripts/analyze/compile.mjs";

test("applyScoringResult: writes disambiguation onto the target step.locator; clamps unknown/oob", () => {
  /** @type {Array<any>} */
  const steps = [
    { action: "goto" },
    { action: "click", locator: { role: "link", structuralKey: "x>y|a|||Z", href: "/z" } }
  ];
  const result = {
    stepIndex: 1,
    disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5, bogusSignal: 9, name: 99 }, note: "synthetic" }
  };
  applyScoringResult(steps, result);
  assert.deepEqual(steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5, name: 3 },
    "unknown key dropped, name clamped to 3");
  assert.equal(steps[1].locator.disambiguation.note, "synthetic");
});

test("applyScoringResult: no-op when step/locator/disambiguation missing", () => {
  /** @type {Array<any>} */
  const steps = [{ action: "click", locator: { role: "link" } }];
  applyScoringResult(steps, { stepIndex: 5, disambiguation: { weightOverrides: { href: 1.5 } } }); // out-of-range index
  assert.equal(steps[0].locator.disambiguation, undefined);
  applyScoringResult(steps, { stepIndex: 0 }); // no disambiguation
  assert.equal(steps[0].locator.disambiguation, undefined);
});
