import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths, getTaskPath } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { withTrace } from "../lib/trace.mjs";
import { compileRun } from "../analyze/compile.mjs";
import { judgeNovelty, snapshotKnowledgePageNodes } from "../lib/atomic-fp-novelty.mjs";
import { proposeInputs, applyProposalToWorkflow } from "../lib/variable-proposer.mjs";
import { createTask, transitionTask, TASK_STATUS } from "../lib/workflow-status.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export function analyzeCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("analyze requires --run-id.");
  }
  const runPaths = getRunPaths(runId);
  return withTrace(runPaths, "analyze", () => {
    // Snapshot the pre-compile knowledge state so the novelty judgment
    // compares against the baseline BEFORE compileRun writes new page-nodes.
    // Without the snapshot, the just-written selectors would be visible to
    // the filesystem-based check and judgeNovelty would always return
    // isNewPath=false (regression).
    const preCompileSnapshot = snapshotKnowledgePageNodes();
    const workflow = compileRun(runId);
    activateVariableExtraction(runPaths, workflow, preCompileSnapshot);
    return workflow;
  });
}

/**
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {Record<string, unknown>} workflow
 * @param {Map<string, Set<string>>} preCompileSnapshot
 */
function activateVariableExtraction(runPaths, workflow, preCompileSnapshot) {
  const novelty = judgeNovelty(workflow, preCompileSnapshot);
  if (!novelty.isNewPath) {
    return; // known path — deterministic proposer only runs for new paths
  }
  // Run deterministic proposer (LLM-driven variable-agent sub-skill
  // replaces this in a subsequent chunk; the interface stays the same).
  /** @type {{ steps: Array<Record<string, unknown>>, inputs?: unknown }} */
  const typedWorkflow = /** @type {any} */ (workflow);
  const proposerResult = proposeInputs(typedWorkflow);
  applyProposalToWorkflow(typedWorkflow, proposerResult);

  // Re-persist workflow.json with inputs[] + per-step valueRef.
  // compileRun() already wrote the file once; this overwrites with
  // the proposer-augmented form.
  writeJson(runPaths.workflowJsonPath, workflow);

  // Transition the variable-extraction task pending → in-progress and
  // record the proposal so `bf vars --confirm` can rubber-stamp it.
  // If the task file is missing (e.g. analyze invoked without a prior
  // `bf done` hook firing), create one in pending first to keep the
  // state machine honest.
  const taskPath = getTaskPath(runPaths.runId, "variable-extraction");
  /** @type {import("../lib/workflow-status.mjs").TaskUnit | null} */
  let task = null;
  if (existsSync(taskPath)) {
    try {
      task = /** @type {import("../lib/workflow-status.mjs").TaskUnit} */ (readJson(taskPath));
    } catch {
      task = null;
    }
  }
  if (!task) {
    task = createTask({ kind: "variable-extraction", runId: runPaths.runId });
  }
  if (task.status === TASK_STATUS.PENDING) {
    task = transitionTask(task, TASK_STATUS.IN_PROGRESS, {
      proposedInputs: proposerResult.proposals.map((entry) => entry.name),
      proposedCount: proposerResult.proposals.length,
      confirmed: false,
      noveltyTriggers: {
        newPageKeys: novelty.newPageKeys,
        newAtomicFpCount: novelty.newAtomicFps.length
      }
    });
    mkdirSync(runPaths.tasksDir, { recursive: true });
    writeFileSync(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
  }
  // If task is already in-progress / complete / broken, leave it —
  // re-running analyze is idempotent for the deterministic proposer
  // path (state already advanced previously).
}
