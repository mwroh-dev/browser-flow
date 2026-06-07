import test from "node:test";
import assert from "node:assert/strict";
import { buildVerificationSummary } from "../../scripts/lib/report-summary.mjs";

test("buildVerificationSummary renders diagnostic replay success without network detail", () => {
  const summary = buildVerificationSummary({
    runId: "r1",
    verificationPath: "artifacts/runs/r1/reports/verification.json",
    securityPath: "artifacts/runs/r1/reports/security.json",
    report: {
      success: true,
      pathComplete: true,
      executedSteps: ["goto", "click"],
      stepCount: 2,
      replayOutcome: "passed",
      promotionOutcome: "not_promoted",
      promotionCandidate: { scope: "external", status: "external_replay_candidate" },
      promotionBlockers: [{ gate: "security", reason: "warning_only_findings" }],
      resultEvidence: {
        passed: true,
        selector: "body",
        expectedText: "뉴스",
        actualText: "<redacted-secret>"
      },
      transitionChecks: [
        { name: "network", actual: new Array(200).fill({ url: "<non-local-url>" }) }
      ]
    }
  });

  assert.equal(summary.headline, "External replay succeeded; save it with explicit promotion approval.");
  assert.equal(
    summary.nextAction,
    "Run browser-flow promote --run-id r1 --scope external ... after confirming origins, auth, privacy, screenshots, and data mode."
  );
  assert.equal(summary.route.executedSteps, 2);
  assert.deepEqual(summary.blockers, [{ gate: "security", reason: "warning_only_findings" }]);
  assert.equal(JSON.stringify(summary).includes("non-local-url"), false);
});

test("buildVerificationSummary renders promoted local replay", () => {
  const summary = buildVerificationSummary({
    runId: "r2",
    verificationPath: "artifacts/runs/r2/reports/verification.json",
    securityPath: "artifacts/runs/r2/reports/security.json",
    report: {
      success: true,
      pathComplete: true,
      executedSteps: ["goto"],
      stepCount: 1,
      replayOutcome: "passed",
      promotionOutcome: "promoted",
      promotionBlockers: [],
      resultEvidence: { passed: true, selector: "h1", expectedText: "Done" }
    }
  });

  assert.equal(summary.headline, "Replay verified and promotion gates are green.");
  assert.equal(summary.promotionOutcome, "promoted");
  assert.deepEqual(summary.blockers, []);
});

test("buildVerificationSummary includes screenshot artifact metadata when present", () => {
  const summary = buildVerificationSummary({
    runId: "r3",
    verificationPath: "artifacts/runs/r3/reports/verification.json",
    securityPath: "artifacts/runs/r3/reports/security.json",
    report: {
      success: true,
      pathComplete: true,
      executedSteps: ["goto", "click"],
      stepCount: 2,
      replayOutcome: "passed",
      promotionOutcome: "promoted",
      promotionBlockers: [],
      resultEvidence: { passed: true, selector: "h1", expectedText: "Done" },
      screenshotArtifacts: {
        mode: "both",
        count: 3,
        manifestPath: "artifacts/runs/r3/reports/screenshots-manifest.json"
      }
    }
  });

  assert.deepEqual(summary.screenshots, { mode: "both", count: 3 });
  assert.equal(summary.reports.screenshotsManifest, "artifacts/runs/r3/reports/screenshots-manifest.json");
});
