/**
 * Broken-state validator.
 *
 * 사용자 framing (2026-05-19 대화, paraphrase 금지):
 *   "broken 상태로 꺼졋다고 치면 나중에 시작할때 validate 같은게
 *    잇어서 이거 하다가 말았다 와 같은식으로 되어야지."
 *
 * 책임: 주어진 runId의 모든 task unit을 스캔해 broken state 있으면
 * 리포트하고, 사용자-readable "이거 하다가 말았다" 메시지로 변환.
 * (i) `bf vars <runId>` 진입 시점 + (ii) variable-agent spawn 직전 hook 두 곳에서 호출.
 *
 * `bf status` 같은 모든-runs 스캔은 별도 구현 — 여기서는 단일 runId 범위만.
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { readJson } from "./fs.mjs";
import { getRunPaths } from "./config.mjs";
import { TASK_STATUS } from "./workflow-status.mjs";

/**
 * Scan all task unit files under a runId's tasksDir.
 *
 * @param {string} runId
 * @returns {Array<import("./workflow-status.mjs").TaskUnit>}
 */
export function scanAllTasks(runId) {
  const runPaths = getRunPaths(runId);
  if (!existsSync(runPaths.tasksDir)) {
    return [];
  }
  const files = readdirSync(runPaths.tasksDir).filter((name) => name.endsWith(".json"));
  /** @type {Array<import("./workflow-status.mjs").TaskUnit>} */
  const tasks = [];
  for (const file of files) {
    const taskPath = resolve(runPaths.tasksDir, file);
    try {
      const task = /** @type {import("./workflow-status.mjs").TaskUnit} */ (readJson(taskPath));
      if (task && typeof task === "object" && typeof task.status === "string") {
        tasks.push(task);
      }
    } catch {
      // Malformed task file — skip silently. Surface via the
      // validator's overall report rather than raising.
      continue;
    }
  }
  return tasks;
}

/**
 * @param {string} runId
 */
export function scanBrokenTasks(runId) {
  return scanAllTasks(runId).filter((task) => task.status === TASK_STATUS.BROKEN);
}

/**
 * Build a multiline user-facing notice for broken tasks. Returns ""
 * when input is empty so the caller can no-op cleanly.
 *
 * @param {Array<import("./workflow-status.mjs").TaskUnit> | null | undefined} brokenTasks
 * @param {{ resumeHint?: string }} [options]
 */
export function formatBrokenNotice(brokenTasks, options = {}) {
  if (!Array.isArray(brokenTasks) || brokenTasks.length === 0) {
    return "";
  }
  const lines = ["[browser-flow] 이전에 시작했으나 완료되지 못한 작업이 있습니다 (broken state):"];
  for (const task of brokenTasks) {
    const elapsed = describeElapsedSince(task.updatedAt);
    lines.push(`  - kind=${task.kind} runId=${task.runId} (${elapsed} 전 중단됨)`);
  }
  const hint = options.resumeHint ?? "재개하려면: bf vars --run-id <runId>";
  lines.push(hint);
  return lines.join("\n");
}

/**
 * @param {string} isoTimestamp
 */
function describeElapsedSince(isoTimestamp) {
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) {
    return "(시점 불명)";
  }
  const elapsedMs = Date.now() - then;
  if (elapsedMs < 0) {
    return "(미래 시각)";
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return "1분 미만";
  }
  if (minutes < 60) {
    return `${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간`;
  }
  const days = Math.floor(hours / 24);
  return `${days}일`;
}
