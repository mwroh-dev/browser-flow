import test from "node:test";
import assert from "node:assert/strict";
import { applyHeal } from "../../scripts/heal/heal-apply.mjs";

const baseWorkflow = () => ({
  steps: [
    { action: "goto" },
    { action: "fill", selector: "[data-bf=\"x\"]", value: "v", locator: { role: "textbox", name: "X", structuralKey: "old-key" } },
    { action: "click", selector: "[data-bf=\"y\"]", locator: { role: "button", name: "Y", structuralKey: "keep" } }
  ]
});

test("applyHeal replaces the matched step's locator and reports applied", () => {
  const wf = baseWorkflow();
  const out = applyHeal(wf, { status: "healed", healedLocators: [{ match: { structuralKey: "old-key" }, locator: { role: "textbox", name: "이름", structuralKey: "new-key" } }] });
  assert.equal(out.status, "healed");
  assert.deepEqual(out.applied, ["old-key"]);
  assert.deepEqual(out.unmatched, []);
  assert.equal(out.workflow.steps[1].locator.structuralKey, "new-key");
  assert.equal(out.workflow.steps[1].locator.name, "이름");
  assert.equal(out.workflow.steps[2].locator.structuralKey, "keep");
  assert.equal(wf.steps[1]?.locator?.structuralKey, "old-key"); // input not mutated
});

test("applyHeal reports unmatched keys without throwing", () => {
  const out = applyHeal(baseWorkflow(), { status: "healed", healedLocators: [{ match: { structuralKey: "ghost" }, locator: { role: "button", name: "Z", structuralKey: "nz" } }] });
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.unmatched, ["ghost"]);
});

test("applyHeal passes through partial-incomplete unchanged", () => {
  const wf = baseWorkflow();
  const out = applyHeal(wf, { status: "partial-incomplete", reason: "gone" });
  assert.equal(out.status, "partial-incomplete");
  assert.equal(out.reason, "gone");
  assert.deepEqual(out.applied, []);
  assert.deepEqual(out.workflow, wf);
});
