/**
 * Build a compact, user-facing verification summary. Raw verification and
 * security reports remain the debug artifacts.
 *
 * @param {{
 *   runId: string,
 *   verificationPath: string,
 *   securityPath: string,
 *   report: Record<string, any>
 * }} input
 */
export function buildVerificationSummary(input) {
  const report = input.report ?? {};
  const replayOutcome = report.replayOutcome ?? (report.success ? "passed" : "failed");
  const promotionOutcome = report.promotionOutcome ?? (report.securityOk ? "promoted" : "not_promoted");
  const blockers = Array.isArray(report.promotionBlockers) ? report.promotionBlockers : [];
  const externalCandidate =
    replayOutcome === "passed" && report.promotionCandidate?.status === "external_replay_candidate";
  const headline =
    externalCandidate
      ? "External replay succeeded; save it with explicit promotion approval."
      : replayOutcome === "passed" && promotionOutcome === "not_promoted"
      ? "Diagnostic replay succeeded; registry promotion is blocked."
      : replayOutcome === "passed"
        ? "Replay verified and promotion gates are green."
        : replayOutcome === "held"
          ? "Replay held at a guarded step; the workflow was not promoted."
          : "Replay failed before verification could be promoted.";

  return {
    schemaVersion: 1,
    runId: input.runId,
    headline,
    replayOutcome,
    promotionOutcome,
    route: {
      pathComplete: report.pathComplete === true,
      executedSteps: Array.isArray(report.executedSteps) ? report.executedSteps.length : 0,
      stepCount: typeof report.stepCount === "number" ? report.stepCount : 0
    },
    evidence: report.resultEvidence
      ? {
          passed: report.resultEvidence.passed === true,
          selector: String(report.resultEvidence.selector ?? ""),
          expectedText: String(report.resultEvidence.expectedText ?? "")
        }
      : undefined,
    blockers,
    reports: {
      verification: input.verificationPath,
      security: input.securityPath,
      ...(report.screenshotArtifacts?.manifestPath
        ? { screenshotsManifest: String(report.screenshotArtifacts.manifestPath) }
        : {})
    },
    ...(report.screenshotArtifacts
      ? {
          screenshots: {
            mode: String(report.screenshotArtifacts.mode ?? "off"),
            count: typeof report.screenshotArtifacts.count === "number" ? report.screenshotArtifacts.count : 0
          }
        }
      : {}),
    ...(externalCandidate
      ? {
          nextAction: `Run browser-flow promote --run-id ${input.runId} --scope external ... after confirming origins, auth, privacy, screenshots, and data mode.`
        }
      : {})
  };
}
