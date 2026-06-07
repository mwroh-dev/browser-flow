import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  getRunPaths, getVerifySpecPaths, getTaskPath, validateRunId, getRepoRoot, assertInsideRoot
} from "../../scripts/lib/config.mjs";

const runsRoot = resolve(getRepoRoot(), "artifacts", "runs");

test("validateRunId rejects traversal and malformed ids", () => {
  for (const bad of ["../escape", "/tmp/escape", "a/b", "a\\b", "..", "", "C:\\x", "a".repeat(81)]) {
    assert.throws(() => validateRunId(bad), /Invalid runId/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("validateRunId accepts conservative valid ids", () => {
  for (const ok of ["demo", "demo-run", "run-2026-05-25T02-17-00.000Z", "breadth-e2e-1730000000000"]) {
    assert.equal(validateRunId(ok), ok);
  }
});

test("getRunPaths throws on traversal ids", () => {
  for (const bad of ["../escape", "/tmp/escape", "a/b", "a\\b", "..", ""]) {
    assert.throws(() => getRunPaths(bad), /Invalid runId/);
  }
});

test("getRunPaths keeps runRoot inside artifacts/runs", () => {
  const p = getRunPaths("demo-run");
  assert.equal(p.runRoot, resolve(runsRoot, "demo-run"));
  assert.ok(p.runRoot.startsWith(runsRoot + "/"));
});

test("getVerifySpecPaths and getTaskPath reject traversal ids", () => {
  assert.throws(() => getVerifySpecPaths("../escape"), /Invalid runId/);
  assert.throws(() => getTaskPath("../escape", "variable-extraction"), /Invalid runId/);
});

test("assertInsideRoot blocks siblings and escapes, allows children and exact root", () => {
  const root = resolve(getRepoRoot(), "artifacts", "runs");
  assert.throws(() => assertInsideRoot(resolve(root, "..", "evil"), root, "t"), /escapes/);
  assert.throws(() => assertInsideRoot(root + "-evil", root, "t"), /escapes/); // sibling prefix
  assert.doesNotThrow(() => assertInsideRoot(resolve(root, "valid"), root, "t"));
  assert.doesNotThrow(() => assertInsideRoot(root, root, "t")); // exact root OK
});
