import { test } from "node:test";
import assert from "node:assert/strict";
import { findProvenance } from "../../scripts/security/no-provenance.mjs";

test("flags a Phase marker", () => {
  assert.deepEqual(findProvenance("// Phase 43: parser-backed sanitize"), ["Phase 43"]);
});

test("flags a lesson marker", () => {
  assert.ok(findProvenance("symmetric gates (#29 [2026-05-19])").includes("(#29"));
});

test("ignores prose without markers", () => {
  assert.deepEqual(findProvenance("parser-backed DOM sanitize with redaction"), []);
});

test("does not flag the word phase or version numbers", () => {
  assert.deepEqual(findProvenance("a phased rollout in v1.2.3"), []);
});

test("exempts the product pipeline-stage header form (Phase N — Name)", () => {
  assert.deepEqual(findProvenance("### Phase 1 — Capture"), []);
  assert.deepEqual(findProvenance("### Phase 5 — Extract"), []);
});

test("still flags archaeology forms", () => {
  assert.deepEqual(findProvenance("Phase 64-72 migration"), ["Phase 64"]);
  assert.deepEqual(findProvenance("see Phase 91 (P2)"), ["Phase 91"]);
});
