import { existsSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseHealResult } from "../lib/schemas.mjs";
import { applyHeal } from "../heal/heal-apply.mjs";
import { affectedByHold } from "../lib/dependency-graph.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";
import { runCleanupCommand } from "./cleanup.mjs";
import { verifyRun } from "../verify/verify-run.mjs";

/**
 * bf heal — deterministic half of the heal loop.
 * Reads a held run's heal-request.json; on --apply applies the healed
 * locators to the workflow (self-heal cache), regenerates the runner,
 * runs cleanup, and does exactly ONE full re-run.
 * The heal is BOUNDED — one re-run, no retry loop.
 *
 * @param {{ runId: string, applyPath?: string, headless?: boolean }} input
 * @param {{ regenerate?: Function, cleanup?: Function, rerun?: Function }} [deps]
 */
export async function runHealCommand(input, deps = {}) {
  const regenerate = deps.regenerate ?? generateRunner;
  const cleanup = deps.cleanup ?? runCleanupCommand;
  const rerun = deps.rerun ?? verifyRun;
  const runPaths = getRunPaths(input.runId);
  if (!existsSync(runPaths.healRequestPath)) {
    throw new Error("no heal-request for run " + input.runId + " — it did not drift-hold");
  }
  const healRequest = /** @type {Record<string, any>} */ (readJson(runPaths.healRequestPath));
  if (!input.applyPath) {
    return { runId: input.runId, healRequest };
  }
  const healResult = parseHealResult(readJson(input.applyPath), input.applyPath);
  const workflow = /** @type {{ steps: Record<string, any>[] } & Record<string, any>} */ (readJson(runPaths.workflowJsonPath));
  const result = applyHeal(workflow, healResult);
  if (result.status === "partial-incomplete") {
    const affectedSegments = affectedByHold(workflow, /** @type {number} */ (healRequest.heldSegment));
    return { runId: input.runId, status: "partial-incomplete", reason: result.reason, affectedSegments };
  }
  if (result.applied.length === 0) {
    throw new Error("heal-result matched no steps (unmatched: " + result.unmatched.join(",") + ")");
  }
  writeJson(runPaths.workflowJsonPath, result.workflow);
  await regenerate(input.runId);
  const cleanupResult = await cleanup({ runId: input.runId, headless: input.headless !== false });
  const rerunResult = await rerun(input.runId, { headless: input.headless !== false });
  return { runId: input.runId, status: "healed", applied: result.applied, unmatched: result.unmatched, cleanup: cleanupResult, rerun: rerunResult };
}

/**
 * @param {Record<string, string | boolean>} options
 */
export function healCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf heal requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  return runHealCommand({ runId, applyPath, headless: options.headless !== false });
}
