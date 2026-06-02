import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseScopeResult } from "../lib/schemas.mjs";
import { applyScope } from "../scope/scope-apply.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";

/**
 * bf scope — the scope-agent's deterministic application command.
 * Unlike bf heal / bf score (reactive: cleanup + bounded re-run after a drift-hold),
 * scope is PROACTIVE established at analyze: it runs BEFORE the first verify, so it
 * only enriches the signal-poor step's locator + regenerates the runner — the
 * normal generate→verify continues. The model (scope-agent) runs out-of-band
 * (Task tool); this command stays LLM-free.
 *
 * - no `--apply`: emit scope-request.json (the signal-poor candidates + snapshot
 *   pointers) for the orchestrator to dispatch the scope-agent against.
 * - `--apply <scope-result.json>`: validate + applyScope onto the workflow, regenerate.
 *
 * @param {{ runId: string, applyPath?: string }} input
 * @param {{ regenerate?: Function }} [deps]
 */
export async function runScopeCommand(input, deps = {}) {
  const regenerate = deps.regenerate ?? generateRunner;
  const runPaths = getRunPaths(input.runId);
  const workflow = /** @type {{ steps: Record<string, any>[], scopeCandidates?: number[] } & Record<string, any>} */ (
    readJson(runPaths.workflowJsonPath)
  );

  if (!input.applyPath) {
    const candidates = (workflow.scopeCandidates || []).map((i) => ({
      stepIndex: i,
      locator: workflow.steps[i] ? workflow.steps[i].locator : undefined
    }));
    const request = {
      runId: input.runId,
      candidates,
      snapshotsManifestPath: runPaths.snapshotsManifestPath,
      snapshotsDir: runPaths.snapshotsDir
    };
    writeJson(runPaths.scopeRequestPath, request);
    return request;
  }

  const scopeResult = parseScopeResult(readJson(input.applyPath), input.applyPath);
  const applied = applyScope(workflow.steps, scopeResult);
  if (applied.applied) {
    writeJson(runPaths.workflowJsonPath, workflow);
    await regenerate(input.runId);
  }
  return { runId: input.runId, status: scopeResult.status, applied: applied.applied, stepIndex: applied.stepIndex };
}

/** @param {Record<string, string | boolean>} options */
export function scopeCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf scope requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  return runScopeCommand({ runId, applyPath });
}
