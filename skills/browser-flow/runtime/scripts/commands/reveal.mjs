import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseRevealResult } from "../lib/schemas.mjs";
import { applyReveal } from "../reveal/reveal-apply.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";

/**
 * bf reveal — deterministic reveal-agent command.
 *
 * - no `--apply`: emit reveal-request.json for ambiguous reveal candidates.
 * - `--apply <reveal-result.json>`: validate + apply actionSemantics to the
 *   workflow, then regenerate the runner when semantics were accepted.
 *
 * @param {{ runId: string, applyPath?: string }} input
 * @param {{ regenerate?: Function }} [deps]
 */
export async function runRevealCommand(input, deps = {}) {
  const regenerate = deps.regenerate ?? generateRunner;
  const runPaths = getRunPaths(input.runId);
  const workflow = /** @type {{ steps: Record<string, any>[], revealCandidates?: number[] } & Record<string, any>} */ (
    readJson(runPaths.workflowJsonPath)
  );

  if (!input.applyPath) {
    const candidates = (workflow.revealCandidates || []).map((stepIndex) => {
      const step = workflow.steps[stepIndex] ?? {};
      const followupStepIndex = nextClickIndex(workflow.steps, stepIndex);
      return {
        stepIndex,
        locator: step.locator,
        transition: step.transition,
        ...(followupStepIndex == null ? {} : { followupStepIndex })
      };
    });
    const request = {
      runId: input.runId,
      candidates,
      snapshotsManifestPath: runPaths.snapshotsManifestPath,
      snapshotsDir: runPaths.snapshotsDir
    };
    writeJson(runPaths.revealRequestPath, request);
    return request;
  }

  const revealResult = parseRevealResult(readJson(input.applyPath), input.applyPath);
  const result = applyReveal(workflow, revealResult);
  writeJson(runPaths.workflowJsonPath, result.workflow);
  if (result.applied) {
    await regenerate(input.runId);
  }
  return { runId: input.runId, status: result.status, applied: result.applied, stepIndex: result.stepIndex };
}

/**
 * @param {Array<Record<string, any>>} steps
 * @param {number} stepIndex
 * @returns {number | null}
 */
function nextClickIndex(steps, stepIndex) {
  for (let i = stepIndex + 1; i < steps.length; i += 1) {
    if (steps[i]?.action === "click") return i;
  }
  return null;
}

/** @param {Record<string, string | boolean>} options */
export function revealCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf reveal requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  return runRevealCommand({ runId, applyPath });
}
