/**
 * Derive user-facing outcome fields without overloading legacy booleans.
 *
 * @param {{
 *   report: Record<string, any>,
 *   security: { ok?: boolean, warningOnly?: boolean, findings?: any[] },
 *   workflowUnmasked: boolean,
 *   securityClean: boolean,
 *   externalPublicReadPromoted?: boolean
 * }} input
 */
export function deriveVerificationOutcomes(input) {
  const report = input.report ?? {};
  const security = input.security ?? {};
  const proofFailed = Array.isArray(report.proofChecks) &&
    report.proofChecks.some((check) => check && typeof check === "object" && check.passed === false);
  const replayPassed =
    report.success === true &&
    report.pathComplete === true &&
    report.resultEvidence?.passed !== false &&
    !proofFailed;
  const replayHeld =
    report.success === false &&
    (
      typeof report.heldAtSegment === "number" ||
      report.resultEvidence?.passed === false ||
      proofFailed ||
      /ambiguous locator|Action-path mismatch|method-B transition mismatch|transition mismatch|Timeout waiting|Provider postcondition failed/i.test(
        `${report.failureReason ?? ""}\n${report.error ?? ""}`
      )
    );

  const replayOutcome = replayPassed ? "passed" : replayHeld ? "held" : "failed";
  const promotionBlockers = [];

  if (replayOutcome !== "passed") {
    promotionBlockers.push({
      gate: "replay",
      reason: replayOutcome === "held" ? "replay_hold" : "replay_failed"
    });
  }
  if (security.ok !== true) {
    promotionBlockers.push({ gate: "security", reason: "scan_failed" });
  } else if (input.securityClean !== true) {
    promotionBlockers.push({
      gate: "security",
      reason: security.warningOnly ? "warning_only_findings" : "not_clean"
    });
  }
  if (input.workflowUnmasked && input.externalPublicReadPromoted !== true) {
    promotionBlockers.push(
      replayOutcome === "passed"
        ? { gate: "registry", reason: "external_requires_operator_approval" }
        : { gate: "registry", reason: "external_replay_not_promotable_until_replay_passes" }
    );
  }

  const promotionCandidate =
    input.workflowUnmasked && input.externalPublicReadPromoted !== true && replayOutcome === "passed"
      ? { scope: "external", status: "external_replay_candidate" }
      : undefined;
  return {
    replayOutcome,
    promotionOutcome: promotionBlockers.length === 0 ? "promoted" : "not_promoted",
    promotionBlockers,
    securityScanOk: security.ok === true,
    securityPromotionClean: input.securityClean === true,
    ...(promotionCandidate ? { promotionCandidate } : {})
  };
}
