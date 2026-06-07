import test from "node:test";
import assert from "node:assert/strict";
import { isSecurityClean } from "../../scripts/security/scan-artifacts.mjs";

test("isSecurityClean: green only when ok and not warning-only", () => {
  assert.equal(isSecurityClean({ ok: true, warningOnly: false }), true);
  assert.equal(isSecurityClean({ ok: true }), true);                       // no findings
  assert.equal(isSecurityClean({ ok: true, warningOnly: true }), false);   // unmasked-suppressed
  assert.equal(isSecurityClean({ ok: false, warningOnly: false }), false); // blocked
  assert.equal(isSecurityClean(undefined), false);
});
