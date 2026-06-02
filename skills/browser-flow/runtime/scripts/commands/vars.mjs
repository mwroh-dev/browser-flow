/**
 * `bf vars <runId>` — task inspection + interaction.
 *
 * Read-only mode:
 *   - task 상태 조회 + broken state stderr notice + 구조화된 status report
 *
 * Extended flags:
 *   - --confirm: in-progress → complete rubber-stamp (CI / automation 용)
 *   - --interactive: 사용자 합의 surface — 각 제안 후보마다 yes/no/이름
 *     readline 인터랙션. abort 시 broken state. 사용자 framing의
 *     "사용자와 합의" 핵심.
 *   - --resume: broken state task 를 in-progress 로 transition 후
 *     interactive 모드 재진입. 부분 decisions 보존.
 */

import { existsSync, writeFileSync } from "node:fs";
import { getStringOption, getBooleanOption } from "../lib/args.mjs";
import { getRunPaths, getTaskPath } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import {
  scanAllTasks,
  scanBrokenTasks,
  formatBrokenNotice
} from "../lib/broken-state-validator.mjs";
import {
  transitionTask,
  TASK_STATUS
} from "../lib/workflow-status.mjs";
import {
  interactiveConfirm,
  applyDecisions,
  createReadlineAsk,
  createScriptedAsk,
  ZeroProposalRejectedError
} from "../lib/variable-agent-interaction.mjs";

/**
 * @param {Record<string, string | boolean>} options
 * @param {{ askFn?: import("../lib/variable-agent-interaction.mjs").AskFn }} [hooks]
 *   Injectable askFn for tests. Default constructs a readline-backed ask.
 */
export async function varsCommand(options, hooks = {}) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("vars requires --run-id.");
  }
  const runPaths = getRunPaths(runId);
  if (!existsSync(runPaths.runRoot)) {
    throw new Error(`Run "${runId}" not found at ${runPaths.runRoot}.`);
  }
  const confirm = getBooleanOption(options, "confirm");
  const interactive = getBooleanOption(options, "interactive");
  const resume = getBooleanOption(options, "resume");

  if (confirm) {
    return confirmVariableExtraction(runId);
  }
  if (resume) {
    return await resumeVariableExtraction(runPaths, hooks);
  }
  if (interactive) {
    return await interactiveVariableExtraction(runPaths, hooks);
  }
  return reportStatus(runId);
}

/**
 * @param {string} runId
 */
function reportStatus(runId) {
  const tasks = scanAllTasks(runId);
  const brokenTasks = scanBrokenTasks(runId);
  if (brokenTasks.length > 0) {
    process.stderr.write(formatBrokenNotice(brokenTasks, {
      resumeHint: `재개하려면: bf vars --run-id ${runId} --resume`
    }) + "\n");
  }
  return {
    runId,
    tasks: tasks.map((task) => ({
      kind: task.kind,
      id: task.id,
      status: task.status,
      requestedAt: task.requestedAt,
      updatedAt: task.updatedAt,
      context: task.context
    })),
    brokenCount: brokenTasks.length,
    resumeAvailable: brokenTasks.length > 0
  };
}

/**
 * @param {string} runId
 */
function confirmVariableExtraction(runId) {
  const taskPath = getTaskPath(runId, "variable-extraction");
  if (!existsSync(taskPath)) {
    throw new Error(
      `No variable-extraction task found for run "${runId}". Run \`bf analyze --run-id ${runId}\` first to populate the proposal.`
    );
  }
  const task = /** @type {import("../lib/workflow-status.mjs").TaskUnit} */ (readJson(taskPath));
  if (task.status === TASK_STATUS.PENDING) {
    throw new Error(
      `variable-extraction task is still pending — analyze hasn't proposed inputs yet. Run \`bf analyze --run-id ${runId}\` to advance.`
    );
  }
  if (task.status === TASK_STATUS.COMPLETE) {
    return {
      runId,
      kind: "variable-extraction",
      status: task.status,
      message: "Already confirmed — no-op."
    };
  }
  if (task.status !== TASK_STATUS.IN_PROGRESS) {
    throw new Error(
      `Cannot confirm task in state "${task.status}". Resolve broken / failed state first.`
    );
  }
  const confirmed = transitionTask(task, TASK_STATUS.COMPLETE, { confirmed: true });
  writeFileSync(taskPath, JSON.stringify(confirmed, null, 2) + "\n", "utf8");
  return {
    runId,
    kind: "variable-extraction",
    status: confirmed.status,
    message: "Confirmed proposed inputs (rubber-stamp).",
    proposedInputs: task.context?.proposedInputs ?? []
  };
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {{ askFn?: import("../lib/variable-agent-interaction.mjs").AskFn }} hooks
 */
async function interactiveVariableExtraction(runPaths, hooks) {
  const runId = runPaths.runId;
  const taskPath = getTaskPath(runId, "variable-extraction");
  if (!existsSync(taskPath)) {
    throw new Error(
      `No variable-extraction task found for run "${runId}". Run \`bf analyze --run-id ${runId}\` first.`
    );
  }
  const task = /** @type {import("../lib/workflow-status.mjs").TaskUnit} */ (readJson(taskPath));
  if (task.status === TASK_STATUS.PENDING) {
    throw new Error(
      `variable-extraction task is still pending — analyze hasn't proposed inputs yet.`
    );
  }
  if (task.status === TASK_STATUS.COMPLETE) {
    return {
      runId,
      kind: "variable-extraction",
      status: task.status,
      message: "Already confirmed — no-op."
    };
  }
  if (task.status === TASK_STATUS.BROKEN) {
    throw new Error(
      `Task is broken. Use --resume to re-enter interactive flow.`
    );
  }
  if (task.status !== TASK_STATUS.IN_PROGRESS) {
    throw new Error(`Unexpected task status "${task.status}".`);
  }
  return await runInteractive(runPaths, task, hooks);
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {{ askFn?: import("../lib/variable-agent-interaction.mjs").AskFn }} hooks
 */
async function resumeVariableExtraction(runPaths, hooks) {
  const runId = runPaths.runId;
  const taskPath = getTaskPath(runId, "variable-extraction");
  if (!existsSync(taskPath)) {
    throw new Error(`No variable-extraction task for run "${runId}".`);
  }
  let task = /** @type {import("../lib/workflow-status.mjs").TaskUnit} */ (readJson(taskPath));
  if (task.status !== TASK_STATUS.BROKEN) {
    throw new Error(
      `--resume requires broken state, got "${task.status}". For interactive on in-progress task use --interactive.`
    );
  }
  // broken → in-progress
  task = transitionTask(task, TASK_STATUS.IN_PROGRESS, { resumedAt: new Date().toISOString() });
  writeFileSync(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
  return await runInteractive(runPaths, task, hooks);
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {import("../lib/workflow-status.mjs").TaskUnit} task
 * @param {{ askFn?: import("../lib/variable-agent-interaction.mjs").AskFn }} hooks
 */
async function runInteractive(runPaths, task, hooks) {
  const runId = runPaths.runId;
  const taskPath = getTaskPath(runId, "variable-extraction");
  if (!existsSync(runPaths.workflowJsonPath)) {
    throw new Error(`Workflow not found at ${runPaths.workflowJsonPath}. Run \`bf analyze --run-id ${runId}\` first.`);
  }
  const workflow = /** @type {Record<string, unknown>} */ (readJson(runPaths.workflowJsonPath));
  const readline = hooks.askFn ? null : createReadlineAsk();
  const ask = hooks.askFn ?? /** @type {NonNullable<typeof readline>} */ (readline).ask;
  try {
    const decisions = await interactiveConfirm({ workflow, ask });
    applyDecisions(workflow, decisions);
    writeJson(runPaths.workflowJsonPath, workflow);
    const completed = transitionTask(task, TASK_STATUS.COMPLETE, {
      confirmed: true,
      decisions: decisions.map((d) => ({
        originalName: d.originalName,
        decision: d.decision,
        newName: d.newName
      })),
      finalInputCount: Array.isArray(workflow.inputs) ? workflow.inputs.length : 0
    });
    writeFileSync(taskPath, JSON.stringify(completed, null, 2) + "\n", "utf8");
    return {
      runId,
      kind: "variable-extraction",
      status: completed.status,
      decisions: completed.context.decisions,
      finalInputCount: completed.context.finalInputCount
    };
  } catch (error) {
    // Any failure mid-interaction → broken state with partial context.
    const broken = transitionTask(task, TASK_STATUS.BROKEN, {
      brokenAt: new Date().toISOString(),
      reason: error instanceof ZeroProposalRejectedError
        ? "zero-proposal rejected — manual variable specification required"
        : (error instanceof Error ? error.message : String(error))
    });
    writeFileSync(taskPath, JSON.stringify(broken, null, 2) + "\n", "utf8");
    throw error;
  } finally {
    if (readline) readline.close();
  }
}

// Re-export the scripted ask helper so tests can import a single path.
export { createScriptedAsk };
