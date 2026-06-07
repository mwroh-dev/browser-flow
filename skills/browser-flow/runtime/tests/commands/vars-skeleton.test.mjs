import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureRunDirs, getTaskPath } from "../../scripts/lib/config.mjs";
import { varsCommand } from "../../scripts/commands/vars.mjs";
import { createTask, transitionTask } from "../../scripts/lib/workflow-status.mjs";

test("varsCommand rejects when --run-id missing", async () => {
  await assert.rejects(varsCommand({}), /vars requires --run-id/);
});

test("varsCommand rejects when runId does not exist", async () => {
  await assert.rejects(
    varsCommand({ "run-id": `does-not-exist-${Date.now()}` }),
    /not found at/
  );
});

test("varsCommand reports tasks for an existing run (no tasks → empty list)", async () => {
  const runId = `vars-empty-${Date.now()}`;
  ensureRunDirs(runId);
  const result = /** @type {{ runId: string, tasks: unknown[], brokenCount: number, resumeAvailable: boolean }} */ (
    await varsCommand({ "run-id": runId })
  );
  assert.equal(result.runId, runId);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.brokenCount, 0);
  assert.equal(result.resumeAvailable, false);
});

test("varsCommand surfaces broken tasks + resumeAvailable flag", async () => {
  const runId = `vars-broken-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  mkdirSync(runPaths.tasksDir, { recursive: true });
  let task = createTask({ kind: "variable-extraction", runId });
  task = transitionTask(task, "in-progress");
  task = transitionTask(task, "broken");
  writeFileSync(getTaskPath(runId, "variable-extraction"), JSON.stringify(task) + "\n", "utf8");

  const result = /** @type {{ tasks: Array<{ kind: string, status: string }>, brokenCount: number, resumeAvailable: boolean }} */ (
    await varsCommand({ "run-id": runId })
  );
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].kind, "variable-extraction");
  assert.equal(result.tasks[0].status, "broken");
  assert.equal(result.brokenCount, 1);
  assert.equal(result.resumeAvailable, true);
});
