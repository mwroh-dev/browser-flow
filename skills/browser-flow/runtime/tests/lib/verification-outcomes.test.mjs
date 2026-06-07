import test from "node:test";
import assert from "node:assert/strict";
import { deriveVerificationOutcomes } from "../../scripts/lib/verification-outcomes.mjs";

test("deriveVerificationOutcomes separates successful replay from blocked real-site promotion", () => {
  const out = deriveVerificationOutcomes({
    report: {
      success: true,
      pathComplete: true,
      transitionChecks: [],
      resultEvidence: { passed: true }
    },
    security: {
      ok: true,
      warningOnly: true,
      findings: [{ file: "x", reason: "high entropy", match: "<redacted>" }]
    },
    workflowUnmasked: true,
    securityClean: false
  });

  assert.equal(out.replayOutcome, "passed");
  assert.equal(out.promotionOutcome, "not_promoted");
  assert.equal(out.securityScanOk, true);
  assert.equal(out.securityPromotionClean, false);
  assert.deepEqual(out.promotionBlockers, [
    { gate: "security", reason: "warning_only_findings" },
    { gate: "registry", reason: "external_requires_operator_approval" }
  ]);
  assert.deepEqual(out.promotionCandidate, {
    scope: "external",
    status: "external_replay_candidate"
  });
});

test("deriveVerificationOutcomes marks passed external replay as a promotion candidate", () => {
  const out = deriveVerificationOutcomes({
    report: { success: true, pathComplete: true, transitionChecks: [], resultEvidence: { passed: true } },
    security: { ok: true, warningOnly: false, findings: [] },
    workflowUnmasked: true,
    securityClean: true
  });

  assert.equal(out.replayOutcome, "passed");
  assert.equal(out.promotionOutcome, "not_promoted");
  assert.deepEqual(out.promotionBlockers, [
    { gate: "registry", reason: "external_requires_operator_approval" }
  ]);
  assert.ok(out.promotionCandidate);
  assert.equal(out.promotionCandidate.status, "external_replay_candidate");
});

test("deriveVerificationOutcomes promotes eligible public-read external replay", () => {
  const out = deriveVerificationOutcomes({
    report: { success: true, pathComplete: true, transitionChecks: [], resultEvidence: { passed: true } },
    security: { ok: true, warningOnly: false, findings: [] },
    workflowUnmasked: true,
    securityClean: true,
    externalPublicReadPromoted: true
  });

  assert.equal(out.replayOutcome, "passed");
  assert.equal(out.promotionOutcome, "promoted");
  assert.deepEqual(out.promotionBlockers, []);
  assert.equal(Object.hasOwn(out, "promotionCandidate"), false);
});

test("deriveVerificationOutcomes preserves replay holds as the primary outcome", () => {
  const out = deriveVerificationOutcomes({
    report: {
      success: false,
      pathComplete: false,
      transitionChecks: [],
      resultEvidence: { passed: false },
      failureReason: "replay-error",
      error: "ambiguous locator"
    },
    security: { ok: true, warningOnly: true, findings: [] },
    workflowUnmasked: true,
    securityClean: false
  });

  assert.equal(out.replayOutcome, "held");
  assert.equal(out.promotionOutcome, "not_promoted");
  assert.equal(out.promotionBlockers.some((blocker) => blocker.gate === "replay"), true);
});

test("deriveVerificationOutcomes marks clean local replay as promoted", () => {
  const out = deriveVerificationOutcomes({
    report: {
      success: true,
      pathComplete: true,
      transitionChecks: [],
      resultEvidence: { passed: true }
    },
    security: { ok: true, warningOnly: false, findings: [] },
    workflowUnmasked: false,
    securityClean: true
  });

  assert.equal(out.replayOutcome, "passed");
  assert.equal(out.promotionOutcome, "promoted");
  assert.deepEqual(out.promotionBlockers, []);
  assert.equal(out.securityScanOk, true);
  assert.equal(out.securityPromotionClean, true);
});
