import test from "node:test";
import assert from "node:assert/strict";

import { resolveCaptureModeOption } from "../../scripts/commands/prepare.mjs";

test("prepare capture mode defaults to non-blocking normal journal capture", () => {
  assert.equal(resolveCaptureModeOption({}), "normal");
});

test("prepare capture mode accepts strict debugger-style capture", () => {
  assert.equal(resolveCaptureModeOption({ "capture-mode": "strict" }), "strict");
});

test("prepare capture mode rejects unknown modes", () => {
  assert.throws(
    () => resolveCaptureModeOption({ "capture-mode": "debug" }),
    /invalid --capture-mode/i
  );
});
