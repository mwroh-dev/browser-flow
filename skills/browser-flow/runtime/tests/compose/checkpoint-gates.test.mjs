import test from "node:test";
import assert from "node:assert/strict";
import { advanceCheckpoint } from "../../scripts/compose/checkpoint-gates.mjs";

test("advanceCheckpoint moves successful gates through the fixed order", () => {
  const state = advanceCheckpoint({
    current: "request_structured",
    ok: true
  });

  assert.equal(state.status, "in-progress");
  assert.equal(state.blockedReason, "none");
  assert.equal(state.next, "reusable_prefix_selected");
});

test("advanceCheckpoint halts on failed gate", () => {
  const state = advanceCheckpoint({
    current: "reusable_prefix_selected",
    ok: false,
    blockedReason: "graph_disconnect"
  });

  assert.equal(state.status, "broken");
  assert.equal(state.blockedReason, "graph_disconnect");
  assert.equal(state.next, null);
});

test("advanceCheckpoint throws on unknown checkpoint names", () => {
  assert.throws(
    () => advanceCheckpoint({ current: "unknown_checkpoint", ok: true }),
    /Unknown compose checkpoint: unknown_checkpoint/
  );
});

test("advanceCheckpoint throws on unknown checkpoint names before failed gate handling", () => {
  assert.throws(
    () => advanceCheckpoint({ current: "unknown_checkpoint", ok: false }),
    /Unknown compose checkpoint: unknown_checkpoint/
  );
});
