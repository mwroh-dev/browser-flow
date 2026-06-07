import test from "node:test";
import assert from "node:assert/strict";
import {
  TASK_STATUS,
  createTask,
  isValidTransition,
  transitionTask,
  isResumable,
  isTerminal,
  isActive
} from "../../scripts/lib/workflow-status.mjs";

test("createTask returns a pending task with id derived from runId + kind", () => {
  const task = createTask({ kind: "variable-extraction", runId: "run-abc" });
  assert.equal(task.kind, "variable-extraction");
  assert.equal(task.id, "run-abc-variable-extraction");
  assert.equal(task.runId, "run-abc");
  assert.equal(task.status, TASK_STATUS.PENDING);
  assert.equal(typeof task.requestedAt, "string");
  assert.equal(typeof task.updatedAt, "string");
  assert.deepEqual(task.context, {});
});

test("createTask rejects invalid kind", () => {
  assert.throws(() => createTask({ kind: "Variable-Extraction", runId: "x" }), /Invalid task kind/);
  assert.throws(() => createTask({ kind: "", runId: "x" }), /Invalid task kind/);
  assert.throws(() => createTask({ kind: "-leading-dash", runId: "x" }), /Invalid task kind/);
});

test("createTask rejects empty runId", () => {
  assert.throws(() => createTask({ kind: "x", runId: "" }), /non-empty runId/);
});

test("isValidTransition encodes the 4-state machine", () => {
  // pending → in-progress | broken
  assert.equal(isValidTransition("pending", "in-progress"), true);
  assert.equal(isValidTransition("pending", "broken"), true);
  assert.equal(isValidTransition("pending", "complete"), false);
  // in-progress → complete | broken
  assert.equal(isValidTransition("in-progress", "complete"), true);
  assert.equal(isValidTransition("in-progress", "broken"), true);
  assert.equal(isValidTransition("in-progress", "pending"), false);
  // broken → in-progress (resume)
  assert.equal(isValidTransition("broken", "in-progress"), true);
  assert.equal(isValidTransition("broken", "complete"), false);
  assert.equal(isValidTransition("broken", "pending"), false);
  // complete is terminal
  assert.equal(isValidTransition("complete", "in-progress"), false);
  assert.equal(isValidTransition("complete", "broken"), false);
  // unknown states never valid
  assert.equal(isValidTransition("ghost", "complete"), false);
  assert.equal(isValidTransition("pending", "ghost"), false);
});

test("transitionTask returns a new task with updated status + timestamp + merged context", async () => {
  const original = createTask({ kind: "variable-extraction", runId: "run-x", context: { foo: 1 } });
  // sleep 2ms so updatedAt differs reliably
  await new Promise((resolve) => setTimeout(resolve, 2));
  const inProgress = transitionTask(original, "in-progress", { answeredStep: 2 });
  assert.equal(inProgress.status, "in-progress");
  assert.notEqual(inProgress.updatedAt, original.updatedAt);
  assert.equal(inProgress.requestedAt, original.requestedAt);
  assert.deepEqual(inProgress.context, { foo: 1, answeredStep: 2 });
  // original immutable
  assert.equal(original.status, "pending");
  assert.deepEqual(original.context, { foo: 1 });
});

test("transitionTask throws on invalid transition", () => {
  const task = createTask({ kind: "variable-extraction", runId: "run-x" });
  assert.throws(
    () => transitionTask(task, "complete"),
    /Invalid task status transition: "pending" → "complete"/
  );
});

test("isResumable / isTerminal / isActive convenience predicates", () => {
  const pending = createTask({ kind: "x", runId: "r" });
  const inProgress = transitionTask(pending, "in-progress");
  const broken = transitionTask(inProgress, "broken");
  const complete = transitionTask(transitionTask(broken, "in-progress"), "complete");

  assert.equal(isResumable(pending), false);
  assert.equal(isResumable(broken), true);
  assert.equal(isResumable(complete), false);

  assert.equal(isTerminal(pending), false);
  assert.equal(isTerminal(broken), false);
  assert.equal(isTerminal(complete), true);

  assert.equal(isActive(pending), false);
  assert.equal(isActive(inProgress), true);
  assert.equal(isActive(complete), false);

  // null-safe
  assert.equal(isResumable(null), false);
  assert.equal(isTerminal(undefined), false);
  assert.equal(isActive(null), false);
});

test("transitionTask context merge does not mutate input", () => {
  const task = createTask({ kind: "x", runId: "r", context: { a: 1, nested: { x: 1 } } });
  const next = transitionTask(task, "in-progress", { b: 2 });
  assert.deepEqual(task.context, { a: 1, nested: { x: 1 } }, "input context unchanged");
  assert.deepEqual(next.context, { a: 1, nested: { x: 1 }, b: 2 });
});
