import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";

const ALLOWED_BLOCKED_REASONS = new Set(["none", "unreachable_goal", "policy_blocked", "graph_disconnect", "iteration_limit"]);

export function normalizeComposeBlockedReason(reason) {
  return ALLOWED_BLOCKED_REASONS.has(reason) ? reason : "unreachable_goal";
}

export function buildComposeSummary({
  primaryRunId,
  sourceRuns,
  status,
  blockedReason = "none",
  reusedSegments = [],
  learnedSteps = 0
}) {
  return {
    schemaVersion: SCHEMA_VERSIONS.composeSummary,
    primaryRunId,
    sourceRuns,
    status,
    blockedReason: normalizeComposeBlockedReason(blockedReason),
    reusedSegments,
    learnedSteps
  };
}
