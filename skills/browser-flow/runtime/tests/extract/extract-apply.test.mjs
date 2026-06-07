import test from "node:test";
import assert from "node:assert/strict";
import { applyExtract } from "../../scripts/extract/extract-apply.mjs";

/** @returns {Record<string, any>[]} */
const STEPS = () => [{ action: "goto" }, { action: "click", pageKey: "manual/x/list" }];

test("applyExtract writes step.extraction for an extracted result", () => {
  const steps = STEPS();
  const out = applyExtract(steps, {
    stepIndex: 1, status: "extracted",
    extractorConfig: { container: "ul", fields: [{ name: "t", selector: "a" }] },
    pagination: { kind: "none" }
  });
  assert.equal(out.applied, true);
  assert.equal(out.pageKey, "manual/x/list");
  assert.equal(steps[1].extraction.status, "extracted");
  assert.equal(steps[1].extraction.pageKey, "manual/x/list");
  assert.deepEqual(steps[1].extraction.pagination, { kind: "none" });
});

test("applyExtract records no-schema without marking applied", () => {
  const steps = STEPS();
  const out = applyExtract(steps, { stepIndex: 1, status: "no-schema", reason: "none" });
  assert.equal(out.applied, false);
  assert.equal(steps[1].extraction.status, "no-schema");
});

test("applyExtract is a no-op for an out-of-range stepIndex", () => {
  const steps = STEPS();
  const out = applyExtract(steps, { stepIndex: 9, status: "extracted", extractorConfig: { container: null, fields: [{ name: "t", selector: "a" }] } });
  assert.equal(out.applied, false);
});
