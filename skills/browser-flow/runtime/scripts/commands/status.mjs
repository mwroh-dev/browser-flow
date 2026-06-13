import { getStringOption } from "../lib/args.mjs";
import { withCliNotices } from "../lib/cli-notices.mjs";
import { buildStatusReport } from "../lib/status-report.mjs";

/**
 * @param {Record<string, string | boolean>} options
 */
export function statusCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("status requires --run-id.");
  const report = buildStatusReport(runId);
  if (report.successClaimable) return report;
  return withCliNotices(report, [
    {
      severity: "warning",
      code: "success_not_claimable",
      message: `Run ${runId} cannot truthfully claim success: ${report.lastFailure?.code ?? "unknown_failure"}.`,
      suggestedCommands: [
        `browser-flow status --run-id ${runId}`,
        `browser-flow verify --run-id ${runId}`
      ]
    }
  ]);
}
