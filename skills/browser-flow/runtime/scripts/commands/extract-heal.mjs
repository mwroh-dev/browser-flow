import { getStringOption } from "../lib/args.mjs";
import { runExtractHealCommand } from "../extract/extract-heal.mjs";

export { runExtractHealCommand };

/** @param {Record<string, string | boolean>} options */
export function extractHealCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf extract-heal requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  return runExtractHealCommand({ runId, applyPath });
}
