import test from "node:test";
import assert from "node:assert/strict";
import { saveSession, readSession } from "../../scripts/lib/keychain.mjs";

function makeFakeKeychain() {
  const store = new Map();
  return {
    store,
    /** @param {string} file @param {string[]} args @returns {string} */
    exec(file, args) {
      assert.equal(file, "security");
      const sub = args[0];
      const sIdx = args.indexOf("-s");
      const sFlag = sIdx !== -1 ? args[sIdx + 1] : undefined;
      if (sub === "add-generic-password") {
        const wIdx = args.indexOf("-w");
        const wVal = wIdx !== -1 ? args[wIdx + 1] : undefined;
        if (sFlag !== undefined && wVal !== undefined) store.set(sFlag, wVal);
        return "";
      }
      if (sub === "find-generic-password") {
        if (sFlag === undefined || !store.has(sFlag)) {
          const e = new Error("not found");
          throw e;
        }
        return /** @type {string} */ (store.get(sFlag)) + "\n";
      }
      throw new Error("unexpected subcommand " + sub);
    }
  };
}

test("saveSession + readSession round-trip via injected exec (value base64, never raw in args path we assert)", () => {
  const kc = makeFakeKeychain();
  const value = JSON.stringify({ cookies: [{ name: "SID", value: "secret-session-xyz" }] });
  saveSession("verify:example.com", value, { exec: kc.exec });
  const back = readSession("verify:example.com", { exec: kc.exec });
  assert.equal(back, value);
  // stored form is base64 (raw secret not stored as plaintext arg)
  const stored = kc.store.get("verify:example.com");
  assert.ok(stored !== undefined, "stored value should exist in fake keychain");
  assert.notEqual(stored, value);
  assert.equal(Buffer.from(/** @type {string} */ (stored), "base64").toString("utf8"), value);
});

test("readSession returns null when absent (no throw leaking the ref)", () => {
  const kc = makeFakeKeychain();
  assert.equal(readSession("verify:missing", { exec: kc.exec }), null);
});
