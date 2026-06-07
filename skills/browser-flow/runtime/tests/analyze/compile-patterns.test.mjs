import test from "node:test";
import assert from "node:assert/strict";
import { applyPatternsToSteps } from "../../scripts/analyze/compile.mjs";
import { loadPatterns } from "../../scripts/lib/pattern-match.mjs";

test("applyPatternsToSteps: nav-tab step.locator gets weightOverrides; non-matching untouched", () => {
  /** @type {Array<any>} */
  const steps = [
    { action: "goto" },
    { action: "click", locator: { role: "link", structuralKey: "nav>ul>li|a|||Talk", href: "/navtab/talk" } },
    { action: "click", locator: { role: "button" } },
    { action: "click" } // no locator
  ];
  applyPatternsToSteps(steps, loadPatterns());
  assert.deepEqual(steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 });
  assert.equal(steps[2].locator.disambiguation, undefined);
  assert.equal(steps[3].locator, undefined);
});
