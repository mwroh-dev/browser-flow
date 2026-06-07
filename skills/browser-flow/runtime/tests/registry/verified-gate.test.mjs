import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import {
  registryPromotionRefusal,
  upsertRegistryEntry,
  readRegistry
} from "../../scripts/registry/workflow-registry.mjs";

/**
 * @param {boolean} ok
 * @param {boolean} warningOnly
 * @param {{ replayOutcome?: string, success?: boolean, pathComplete?: boolean }} [options]
 */
function writeArtifacts(ok, warningOnly, options = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), "bf-vgate-"));
  mkdirSync(resolve(dir, "reports"), { recursive: true });
  const vPath = resolve(dir, "reports", "verification.json");
  const sPath = resolve(dir, "reports", "security.json");
  writeFileSync(vPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.verification,
    replayOutcome: options.replayOutcome ?? "passed",
    success: options.success ?? true,
    pathComplete: options.pathComplete ?? true,
    executedSteps: [], stepCount: 0, transitionChecks: [], securityOk: ok && !warningOnly,
    verifiedAt: new Date().toISOString()
  }));
  writeFileSync(sPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.security, ok, findings: warningOnly ? [{ file: "x", reason: "y", match: "z" }] : [], warningOnly
  }));
  return { vPath, sPath };
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} fields
 */
function writeDataResult(path, fields = {}) {
  writeFileSync(path, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.dataResult,
    runId: "run-1",
    dataMode: "extract",
    replayOutcome: "passed",
    dataOutcome: "data",
    extractStatus: "data",
    stepIndex: 1,
    pageKey: "manual/example",
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

function approvedExternalPromotion() {
  return {
    scope: "external",
    approved: true,
    origins: ["https://www.notion.so"],
    authMode: "login-required",
    profileMode: "ephemeral",
    privacyLevel: "minimal",
    screenshots: "off",
    dataMode: "route"
  };
}

test("verified upsert refused when artifacts are missing", () => {
  const id = `vgate-missing-${Date.now()}`;
  assert.throws(() => upsertRegistryEntry({ id, fixture: "synthetic", runId: id, status: "verified" }), /verified/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("verified upsert refused when security scan is warning-only (unmasked)", () => {
  const id = `vgate-warn-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, true);
  assert.throws(() => upsertRegistryEntry({
    id, fixture: "synthetic", runId: id, status: "verified",
    verificationPath: vPath, securityPath: sPath
  }), /verified/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("verified upsert allowed with present + clean artifacts", () => {
  const id = `vgate-clean-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, false);
  upsertRegistryEntry({
    id, fixture: "synthetic", runId: id, status: "verified",
    verificationPath: vPath, securityPath: sPath
  });
  assert.equal(readRegistry().find((e) => e.id === id)?.status, "verified");
});

test("non-verified statuses bypass the gate", () => {
  const id = `vgate-generated-${Date.now()}`;
  upsertRegistryEntry({ id, fixture: "synthetic", runId: id, status: "generated" });
  assert.equal(readRegistry().find((e) => e.id === id)?.status, "generated");
});

test("unapproved external entries are not promoted", () => {
  const entry = {
    id: `vgate-unapproved-external-${Date.now()}`,
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: { scope: "external", approved: false, origins: ["https://www.notion.so"] }
  };

  const refusal = registryPromotionRefusal(entry);

  if (refusal === null) {
    assert.fail("expected external promotion refusal");
  }
  assert.equal(refusal.code, "external_requires_operator_approval");
  assert.match(refusal.message, /not promoted/);
  assert.doesNotMatch(refusal.message, /localhost|local-only/i);
});

test("approved external replay-verified entries are allowed past promotion refusal", () => {
  const entry = {
    id: `vgate-approved-external-${Date.now()}`,
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"],
      authMode: "login-required",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  };

  assert.equal(registryPromotionRefusal(entry), null);
});

test("approved external replay-verified entries require policy metadata at registry boundary", () => {
  const entry = {
    id: `vgate-missing-policy-${Date.now()}`,
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"]
    }
  };

  const refusal = registryPromotionRefusal(entry);

  if (refusal === null) {
    assert.fail("expected external policy metadata refusal");
  }
  assert.equal(refusal.code, "external_requires_policy_metadata");
});

test("replay-verified upsert refused when artifacts are missing", () => {
  const id = `vgate-replay-missing-${Date.now()}`;
  assert.throws(() => upsertRegistryEntry({
    id,
    fixture: "synthetic",
    runId: id,
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: approvedExternalPromotion()
  }), /replay_verified/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("replay-verified upsert refused when replay failed", () => {
  const id = `vgate-replay-failed-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, false, { replayOutcome: "failed", success: false });
  assert.throws(() => upsertRegistryEntry({
    id,
    fixture: "synthetic",
    runId: id,
    status: "replay_verified",
    verificationPath: vPath,
    securityPath: sPath,
    security: { localOnly: false, targetScope: "external" },
    promotion: approvedExternalPromotion()
  }), /replay did not pass/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("replay-verified upsert refuses failed replayOutcome even when legacy booleans passed", () => {
  const id = `vgate-replay-outcome-failed-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, false, {
    replayOutcome: "failed",
    success: true,
    pathComplete: true
  });
  assert.throws(() => upsertRegistryEntry({
    id,
    fixture: "synthetic",
    runId: id,
    status: "replay_verified",
    verificationPath: vPath,
    securityPath: sPath,
    security: { localOnly: false, targetScope: "external" },
    promotion: approvedExternalPromotion()
  }), /replay did not pass/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("replay-verified upsert refused when security scan failed", () => {
  const id = `vgate-replay-security-failed-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(false, false);
  assert.throws(() => upsertRegistryEntry({
    id,
    fixture: "synthetic",
    runId: id,
    status: "replay_verified",
    verificationPath: vPath,
    securityPath: sPath,
    security: { localOnly: false, targetScope: "external" },
    promotion: approvedExternalPromotion()
  }), /security scan failed/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("replay-verified upsert allows warning-only security with approved external promotion", () => {
  const id = `vgate-replay-warning-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, true);
  upsertRegistryEntry({
    id,
    fixture: "synthetic",
    runId: id,
    status: "replay_verified",
    verificationPath: vPath,
    securityPath: sPath,
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"],
      authMode: "login-required",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  });
  assert.equal(readRegistry().find((e) => e.id === id)?.status, "replay_verified");
});

test("replay-verified upsert stores only origin-level external URLs", () => {
  const id = `vgate-replay-url-redact-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, true);
  upsertRegistryEntry({
    id,
    fixture: "manual",
    runId: id,
    status: "replay_verified",
    startUrl: "https://www.notion.so/private/page?workspace=secret",
    finalUrl: "https://www.notion.so/private/page?workspace=secret",
    verificationPath: vPath,
    securityPath: sPath,
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"],
      authMode: "login-required",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  });
  const saved = readRegistry().find((e) => e.id === id);
  assert.equal(saved?.startUrl, "https://www.notion.so");
  assert.equal(saved?.finalUrl, "https://www.notion.so");
});

test("replay-verified upsert redacts non-http external URL fields", () => {
  const id = `vgate-replay-file-url-redact-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, true);
  upsertRegistryEntry({
    id,
    fixture: "manual",
    runId: id,
    status: "replay_verified",
    startUrl: "file:///Users/example/private.html?token=secret",
    finalUrl: "data:text/html,secret",
    verificationPath: vPath,
    securityPath: sPath,
    security: { localOnly: false, targetScope: "external" },
    promotion: approvedExternalPromotion()
  });
  const saved = readRegistry().find((e) => e.id === id);
  assert.equal(saved?.startUrl, "<non-http-url>");
  assert.equal(saved?.finalUrl, "<non-http-url>");
});

test("replay-verified upsert rejects mismatched data-result promotion metadata", () => {
  const id = `vgate-replay-data-mismatch-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, true);
  const dataPath = resolve(mkdtempSync(resolve(tmpdir(), "bf-data-result-")), "data-result.json");
  writeDataResult(dataPath, { runId: id });

  assert.throws(() => upsertRegistryEntry({
    id,
    fixture: "manual",
    runId: id,
    status: "replay_verified",
    verificationPath: vPath,
    securityPath: sPath,
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      ...approvedExternalPromotion(),
      dataMode: "extract",
      dataResultPath: dataPath,
      dataOutcome: "drift",
      rowCount: 999
    }
  }), /data-result metadata does not match/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});
