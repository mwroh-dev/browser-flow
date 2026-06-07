import test from "node:test";
import assert from "node:assert/strict";

import {
  checkRuntimeDependencyPreflight,
  formatRuntimePreflightError
} from "../../scripts/lib/runtime-preflight.mjs";

test("checkRuntimeDependencyPreflight reports non-writable runtime root", () => {
  const result = checkRuntimeDependencyPreflight("/runtime", {
    accessSync() {
      const err = /** @type {Error & { code?: string }} */ (new Error("EACCES: permission denied"));
      err.code = "EACCES";
      throw err;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "runtime_not_writable");
  assert.match(formatRuntimePreflightError("/runtime", result), /Permission preflight failed/);
  assert.match(formatRuntimePreflightError("/runtime", result), /approve an elevated dependency install/);
});

test("checkRuntimeDependencyPreflight passes writable runtime root", () => {
  const result = checkRuntimeDependencyPreflight("/runtime", { accessSync() {} });
  assert.equal(result.ok, true);
});
