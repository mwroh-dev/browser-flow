import test from "node:test";
import assert from "node:assert/strict";
import { recorderInitScript } from "../../scripts/observe/recorder-script.mjs";

test("recorder click events include gesture provenance source fields", () => {
  for (const token of [
    "gestureId",
    "pointerdown",
    "composedPath",
    "targetSelector",
    "actionableSelector",
    "isTrusted",
    "pageSkeleton",
    "__bfStrictCapture"
  ]) {
    assert.match(recorderInitScript, new RegExp(token), `recorder source must include ${token}`);
  }
});
