import { existsSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths, getScoringPatternsPath } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseScoringResult } from "../lib/schemas.mjs";
import { applyScoringResult } from "../analyze/compile.mjs";
import { loadPatterns } from "../lib/pattern-match.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";
import { runCleanupCommand } from "./cleanup.mjs";
import { verifyRun } from "../verify/verify-run.mjs";

/**
 * bf score — deterministic half of the reactive scoring loop. Mirror of bf heal.
 * Reads a held run's scoring-request.json; on --apply applies the scoring-agent's
 * weightOverride to the workflow (self-tune cache), appends any generalizable pattern
 * to learned scoring knowledge, regenerates, cleans up, and does exactly ONE re-run (bounded).
 * @param {{ runId: string, applyPath?: string, headless?: boolean }} input
 * @param {{ regenerate?: Function, cleanup?: Function, rerun?: Function }} [deps]
 */
export async function runScoreCommand(input, deps = {}) {
  const regenerate = deps.regenerate ?? generateRunner;
  const cleanup = deps.cleanup ?? runCleanupCommand;
  const rerun = deps.rerun ?? verifyRun;
  const runPaths = getRunPaths(input.runId);
  if (!existsSync(runPaths.scoringRequestPath)) {
    throw new Error("no scoring-request for run " + input.runId + " — it did not ambiguous-drift-hold");
  }
  const scoringRequest = /** @type {Record<string, any>} */ (readJson(runPaths.scoringRequestPath));
  if (!input.applyPath) {
    return { runId: input.runId, scoringRequest };
  }
  const scoringResult = parseScoringResult(readJson(input.applyPath), input.applyPath);
  const workflow = /** @type {{ steps: Record<string, any>[] } & Record<string, any>} */ (readJson(runPaths.workflowJsonPath));
  applyScoringResult(workflow.steps, scoringResult);
  if (scoringResult.generalizable) {
    appendPattern(scoringResult.generalizable);
  }
  writeJson(runPaths.workflowJsonPath, workflow);
  await regenerate(input.runId);
  const cleanupResult = await cleanup({ runId: input.runId, headless: input.headless !== false });
  const rerunResult = await rerun(input.runId, { headless: input.headless !== false });
  return { runId: input.runId, status: "scored", stepIndex: scoringResult.stepIndex, cleanup: cleanupResult, rerun: rerunResult };
}

/** Append a generalizable pattern to learned scoring knowledge if not a duplicate id. @param {any} pattern */
function appendPattern(pattern) {
  if (loadPatterns().some((p) => p.id === pattern.id)) return;
  const learnedPath = getScoringPatternsPath();
  const learned = loadPatterns(learnedPath);
  writeJson(learnedPath, [...learned, pattern]);
}

/** @param {Record<string, string | boolean>} options */
export function scoreCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf score requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  return runScoreCommand({ runId, applyPath, headless: options.headless !== false });
}
