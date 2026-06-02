import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { withTrace } from "../lib/trace.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export function generateCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) {
    throw new Error("generate requires --run-id.");
  }
  const runPaths = getRunPaths(runId);
  return withTrace(runPaths, "generate", () => generateRunner(runId));
}
