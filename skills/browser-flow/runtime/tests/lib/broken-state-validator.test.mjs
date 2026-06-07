import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureRunDirs, getRunPaths, getTaskPath } from "../../scripts/lib/config.mjs";
import {
  scanAllTasks,
  scanBrokenTasks,
  formatBrokenNotice
} from "../../scripts/lib/broken-state-validator.mjs";
import { createTask, transitionTask } from "../../scripts/lib/workflow-status.mjs";

/**
 * @param {string} runId
 * @param {string} kind
 * @param {string} status
 * @param {number} [updatedMinusMin] minutes ago for updatedAt
 */
function writeTaskFile(runId, kind, status, updatedMinusMin = 0) {
  let task = createTask({ kind, runId });
  if (status === "in-progress") {
    task = transitionTask(task, "in-progress");
  } else if (status === "broken") {
    task = transitionTask(transitionTask(task, "in-progress"), "broken");
  } else if (status === "complete") {
    task = transitionTask(transitionTask(task, "in-progress"), "complete");
  }
  if (updatedMinusMin > 0) {
    task = { ...task, updatedAt: new Date(Date.now() - updatedMinusMin * 60_000).toISOString() };
  }
  const runPaths = getRunPaths(runId);
  mkdirSync(runPaths.tasksDir, { recursive: true });
  writeFileSync(getTaskPath(runId, kind), JSON.stringify(task, null, 2) + "\n", "utf8");
}

test("scanAllTasks returns empty array when tasksDir missing", () => {
  const runId = `validator-empty-${Date.now()}`;
  ensureRunDirs(runId);
  assert.deepEqual(scanAllTasks(runId), []);
});

test("scanAllTasks reads all task files; scanBrokenTasks filters", () => {
  const runId = `validator-mix-${Date.now()}`;
  ensureRunDirs(runId);
  writeTaskFile(runId, "variable-extraction", "broken", 30);
  writeTaskFile(runId, "composition-request", "complete", 5);

  const all = scanAllTasks(runId);
  assert.equal(all.length, 2);
  const broken = scanBrokenTasks(runId);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].kind, "variable-extraction");
  assert.equal(broken[0].status, "broken");
});

test("scanAllTasks silently skips malformed task files", () => {
  const runId = `validator-malformed-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  mkdirSync(runPaths.tasksDir, { recursive: true });
  writeFileSync(resolve(runPaths.tasksDir, "broken-json.json"), "{not valid json}", "utf8");
  writeTaskFile(runId, "variable-extraction", "broken");
  const tasks = scanAllTasks(runId);
  assert.equal(tasks.length, 1, "malformed file ignored, valid one returned");
});

test("formatBrokenNotice returns empty string for empty input", () => {
  assert.equal(formatBrokenNotice([]), "");
  assert.equal(formatBrokenNotice(null), "");
});

test("formatBrokenNotice produces user-readable Korean notice with elapsed time + resume hint", () => {
  const runId = `validator-notice-${Date.now()}`;
  ensureRunDirs(runId);
  writeTaskFile(runId, "variable-extraction", "broken", 30);
  const broken = scanBrokenTasks(runId);
  const notice = formatBrokenNotice(broken);
  assert.match(notice, /이전에 시작했으나 완료되지 못한 작업/);
  assert.match(notice, /kind=variable-extraction/);
  assert.match(notice, /30분 전 중단됨/);
  assert.match(notice, /재개하려면/);
});

test("formatBrokenNotice accepts custom resumeHint", () => {
  const runId = `validator-custom-hint-${Date.now()}`;
  ensureRunDirs(runId);
  writeTaskFile(runId, "variable-extraction", "broken");
  const broken = scanBrokenTasks(runId);
  const notice = formatBrokenNotice(broken, { resumeHint: "재개: custom-command" });
  assert.match(notice, /재개: custom-command/);
});
