import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../../scripts/extract/golden-probe.mjs";

test("classify returns data when rows present (no golden)", () => {
  const r = classify({ rows: [{ a: 1 }], cardinality: 1, containerResolved: true }, null);
  assert.equal(r.status, "data");
  assert.equal(r.rows.length, 1);
});

test("classify returns confident-zero when container resolves but 0 rows", () => {
  const r = classify({ rows: [], cardinality: 0, containerResolved: true }, null);
  assert.equal(r.status, "confident-zero");
});

test("classify returns drift when container absent", () => {
  const r = classify({ rows: [], cardinality: 0, containerResolved: false }, null);
  assert.equal(r.status, "drift");
  assert.match(String(r.reason), /container/);
});

test("classify flags drift on >=50% cardinality drop vs golden", () => {
  const r = classify({ rows: new Array(5).fill({ a: 1 }), cardinality: 5, containerResolved: true }, { cardinality: 24 });
  assert.equal(r.status, "drift");
  assert.match(String(r.reason), /cardinality/);
});

test("classify returns data on a small (<50%) cardinality dip", () => {
  const r = classify({ rows: new Array(20).fill({ a: 1 }), cardinality: 20, containerResolved: true }, { cardinality: 24 });
  assert.equal(r.status, "data");
});

test("classify ignores cardinality check when golden absent", () => {
  const r = classify({ rows: [{ a: 1 }], cardinality: 1, containerResolved: true }, undefined);
  assert.equal(r.status, "data");
});
