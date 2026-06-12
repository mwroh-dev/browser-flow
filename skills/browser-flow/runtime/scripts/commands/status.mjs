import { getStringOption } from "../lib/args.mjs";
import { buildStatusReport } from "../lib/status-report.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export function statusCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("status requires --run-id.");
  return buildStatusReport(runId);
}
