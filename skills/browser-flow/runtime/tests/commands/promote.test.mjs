import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { promoteCommand } from "../../scripts/commands/promote.mjs";
import { readRegistry } from "../../scripts/registry/workflow-registry.mjs";

/**
 * @param {string} runId
 * @param {{ verification?: Record<string, unknown>, security?: Record<string, unknown> }} [overrides]
 */
function writeExternalRun(runId, overrides = {}) {
  const runPaths = ensureRunDirs(runId);
  writeFileSync(runPaths.workflowJsonPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://www.notion.so",
    finalUrl: "https://www.notion.so/page",
    steps: [{ action: "goto", url: "https://www.notion.so" }],
    verification: { expectedFinalUrl: "https://www.notion.so/page" },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  }));
  writeFileSync(runPaths.verificationPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.verification,
    success: true,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: true },
    replayOutcome: "passed",
    promotionOutcome: "not_promoted",
    securityOk: false,
    verifiedAt: new Date().toISOString(),
    ...overrides.verification
  }));
  writeFileSync(runPaths.securityPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.security,
    ok: true,
    warningOnly: true,
    findings: [{ file: "reports/verification.json", reason: "external warning", match: "<redacted>" }],
    ...overrides.security
  }));
  return runPaths;
}

/**
 * @param {string} artifactPath
 * @param {Record<string, unknown>} fields
 */
function writeDataResult(artifactPath, fields = {}) {
  writeFileSync(artifactPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.dataResult,
    runId: "run-1",
    dataMode: "extract",
    replayOutcome: "passed",
    dataOutcome: "data",
    extractStatus: "data",
    stepIndex: 4,
    pageKey: "manual/news.example/section",
    cardinality: 2,
    rowCount: 2,
    rows: [{ title: "A" }, { title: "B" }],
    previewRows: [{ title: "A" }, { title: "B" }],
    summary: {
      headline: "Data extraction produced 2 rows.",
      detail: "Replay passed; data was read from the current page snapshot."
    },
    ...fields
  }));
}

test("promote external requires origins", () => {
  const runId = `promote-missing-origins-${Date.now()}`;
  writeExternalRun(runId);
  assert.throws(
    () => promoteCommand({ "run-id": runId, scope: "external" }),
    /--origins/
  );
});

test("promote external rejects origins that do not cover the workflow", () => {
  const runId = `promote-origin-mismatch-${Date.now()}`;
  writeExternalRun(runId);

  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://example.com",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "minimal",
      screenshots: "off",
      "data-mode": "route"
    }),
    /origins must include workflow origin/
  );
});

test("promote external saves approved replay-verified entry", () => {
  const runId = `promote-approved-${Date.now()}`;
  const runPaths = writeExternalRun(runId);

  const result = promoteCommand({
    "run-id": runId,
    scope: "external",
    origins: "https://www.notion.so,https://notebooklm.google.com",
    "auth-mode": "login-required",
    "profile-mode": "ephemeral",
    "privacy-level": "minimal",
    screenshots: "off",
    "data-mode": "route"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "replay_verified");
  assert.deepEqual(result.promotion.origins, ["https://www.notion.so", "https://notebooklm.google.com"]);
  assert.equal(result.promotion.warningOnly, true);
  assert.equal(result.promotion.findingsCount, 1);
  const saved = /** @type {Record<string, any> | undefined} */ (readRegistry().find((entry) => entry.id === runId));
  assert.equal(saved?.status, "replay_verified");
  assert.equal(saved?.verificationPath, runPaths.verificationPath);
  assert.equal(saved?.securityPath, runPaths.securityPath);
  assert.equal(saved?.startUrl, "https://www.notion.so");
  assert.equal(saved?.finalUrl, "https://www.notion.so");
  assert.equal(saved?.promotion?.warningOnly, true);
  assert.equal(saved?.promotion?.findingsCount, 1);
  assert.equal(JSON.stringify(saved).includes("<redacted>"), false);
  assert.equal(JSON.stringify(saved).includes("/page"), false);
});

test("promote external rejects failed replay", () => {
  const runId = `promote-failed-replay-${Date.now()}`;
  writeExternalRun(runId, { verification: { replayOutcome: "failed", success: false, pathComplete: false } });
  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://www.notion.so",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "minimal",
      screenshots: "off",
      "data-mode": "extract"
    }),
    /passed replay/
  );
});

test("promote external rejects security ok false", () => {
  const runId = `promote-security-fail-${Date.now()}`;
  writeExternalRun(runId, { security: { ok: false, warningOnly: false, findings: [] } });
  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://www.notion.so",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "minimal",
      screenshots: "off",
      "data-mode": "extract"
    }),
    /security scan ok:true/
  );
});

test("promote external with extract data mode requires a data-result artifact", () => {
  const runId = `promote-extract-missing-data-${Date.now()}`;
  writeExternalRun(runId);
  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://www.notion.so",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "minimal",
      screenshots: "off",
      "data-mode": "extract"
    }),
    /reports\/data-result\.json/
  );
});

test("promote external with extract data mode records data-result metadata", () => {
  const runId = `promote-extract-data-${Date.now()}`;
  const runPaths = writeExternalRun(runId);
  writeDataResult(runPaths.dataResultPath, { runId });

  const result = promoteCommand({
    "run-id": runId,
    scope: "external",
    origins: "https://www.notion.so",
    "auth-mode": "login-required",
    "profile-mode": "ephemeral",
    "privacy-level": "minimal",
    screenshots: "off",
    "data-mode": "extract"
  });

  assert.equal(result.promotion.dataResultPath, runPaths.dataResultPath);
  assert.equal(result.promotion.dataOutcome, "data");
  assert.equal(result.promotion.rowCount, 2);
});

test("promote external with extract data mode rejects data-result from another run", () => {
  const runId = `promote-extract-wrong-run-${Date.now()}`;
  const runPaths = writeExternalRun(runId);
  writeDataResult(runPaths.dataResultPath, { runId: `${runId}-other` });

  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://www.notion.so",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "minimal",
      screenshots: "off",
      "data-mode": "extract"
    }),
    /data-result runId/
  );
});

test("promote external with extract data mode rejects data-result with different data mode", () => {
  const runId = `promote-extract-wrong-mode-${Date.now()}`;
  const runPaths = writeExternalRun(runId);
  writeDataResult(runPaths.dataResultPath, { runId, dataMode: "mixed" });

  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://www.notion.so",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "minimal",
      screenshots: "off",
      "data-mode": "extract"
    }),
    /data-result dataMode/
  );
});

test("promote external with extract data mode rejects data-result from failed replay", () => {
  const runId = `promote-extract-failed-data-replay-${Date.now()}`;
  const runPaths = writeExternalRun(runId);
  writeDataResult(runPaths.dataResultPath, { runId, replayOutcome: "failed" });

  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://www.notion.so",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "minimal",
      screenshots: "off",
      "data-mode": "extract"
    }),
    /data-result replayOutcome/
  );
});

test("promote external validates enums", () => {
  const runId = `promote-invalid-enum-${Date.now()}`;
  writeExternalRun(runId);
  assert.throws(
    () => promoteCommand({
      "run-id": runId,
      scope: "external",
      origins: "https://www.notion.so",
      "auth-mode": "login-required",
      "profile-mode": "ephemeral",
      "privacy-level": "full-ish",
      screenshots: "off",
      "data-mode": "extract"
    }),
    /--privacy-level/
  );
});
