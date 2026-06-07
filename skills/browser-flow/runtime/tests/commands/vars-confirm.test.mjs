import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureRunDirs, getTaskPath } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { varsCommand } from "../../scripts/commands/vars.mjs";
import { createTask, transitionTask } from "../../scripts/lib/workflow-status.mjs";

/**
 * @param {string} runId
 * @param {string} kind
 * @param {string} status
 * @param {Record<string, unknown>} context
 */
function writeTask(runId, kind, status, context = {}) {
  let task = createTask({ kind, runId, context });
  if (status !== "pending") {
    task = transitionTask(task, "in-progress");
    if (status === "broken") {
      task = transitionTask(task, "broken");
    } else if (status === "complete") {
      task = transitionTask(task, "complete");
    }
  }
  const runPaths = ensureRunDirs(runId);
  mkdirSync(runPaths.tasksDir, { recursive: true });
  writeFileSync(getTaskPath(runId, kind), JSON.stringify(task, null, 2) + "\n", "utf8");
  return task;
}

test("vars --confirm transitions in-progress task to complete and stores confirmed=true", async () => {
  const runId = `vars-confirm-${Date.now()}`;
  writeTask(runId, "variable-extraction", "in-progress", {
    proposedInputs: ["fileName", "searchTerm"],
    proposedCount: 2,
    confirmed: false
  });
  const result = /** @type {{ status: string, proposedInputs: unknown[] }} */ (
    /** @type {unknown} */ (await varsCommand({ "run-id": runId, confirm: true }))
  );
  assert.equal(result.status, "complete");
  assert.deepEqual(result.proposedInputs, ["fileName", "searchTerm"]);
  const persisted = /** @type {{ status: string, context: { confirmed: boolean } }} */ (
    readJson(getTaskPath(runId, "variable-extraction"))
  );
  assert.equal(persisted.status, "complete");
  assert.equal(persisted.context.confirmed, true);
});

test("vars --confirm rejects when task is still pending (analyze not run)", async () => {
  const runId = `vars-confirm-pending-${Date.now()}`;
  writeTask(runId, "variable-extraction", "pending");
  await assert.rejects(
    varsCommand({ "run-id": runId, confirm: true }),
    /still pending/
  );
});

test("vars --confirm is no-op when task already complete", async () => {
  const runId = `vars-confirm-complete-${Date.now()}`;
  writeTask(runId, "variable-extraction", "complete");
  const result = /** @type {{ status: string, message: string }} */ (
    await varsCommand({ "run-id": runId, confirm: true })
  );
  assert.equal(result.status, "complete");
  assert.match(result.message, /no-op/i);
});

test("vars --confirm rejects when task is broken (resume required first)", async () => {
  const runId = `vars-confirm-broken-${Date.now()}`;
  writeTask(runId, "variable-extraction", "broken");
  await assert.rejects(
    varsCommand({ "run-id": runId, confirm: true }),
    /broken/
  );
});

test("vars --confirm rejects when task file missing", async () => {
  const runId = `vars-confirm-missing-${Date.now()}`;
  ensureRunDirs(runId);
  await assert.rejects(
    varsCommand({ "run-id": runId, confirm: true }),
    /No variable-extraction task found/
  );
});
