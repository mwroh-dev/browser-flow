import { test } from "node:test";
import assert from "node:assert/strict";
import { getVerifySpecPaths, getRunPaths } from "../../scripts/lib/config.mjs";

test("getRunPaths exposes scoringRequestPath under the run root", () => {
  const p = getRunPaths("phase93-cfg");
  assert.ok(p.scoringRequestPath.endsWith("/scoring-request.json"), `got ${p.scoringRequestPath}`);
  assert.equal(p.scoringRequestPath.replace("scoring-request.json", "heal-request.json"), p.healRequestPath);
});

test("getRunPaths exposes screenshot artifact paths under reports", () => {
  const p = getRunPaths("phase-s1-screens");
  assert.ok(p.screenshotsDir.endsWith("/reports/screenshots"), `got ${p.screenshotsDir}`);
  assert.ok(p.screenshotsManifestPath.endsWith("/reports/screenshots-manifest.json"), `got ${p.screenshotsManifestPath}`);
});

test("getRunPaths separates capture journal from replay state journal", () => {
  const p = getRunPaths("ledger-paths");
  assert.ok(p.captureJournalPath.endsWith("/events/journal.jsonl"), `got ${p.captureJournalPath}`);
  assert.ok(p.stepLedgerPath.endsWith("/analysis/step-ledger.json"), `got ${p.stepLedgerPath}`);
  assert.ok(p.journalPath.endsWith("/state-journal.jsonl"), `got ${p.journalPath}`);
  assert.notEqual(p.captureJournalPath, p.journalPath);
});

test("getVerifySpecPaths returns base + override + per-run paths, override respects env", () => {
  const original = process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
  delete process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
  try {
    const p = getVerifySpecPaths("run-1");
    assert.ok(p.basePath.endsWith("knowledge/verify-spec/questions.base.json"));
    assert.ok(p.overridePath.endsWith("verify-spec/override.json"));
    assert.ok(p.perRunPath.includes("run-1"));
    process.env.BROWSER_FLOW_VERIFY_SPEC_PATH = "/tmp/ov.json";
    assert.equal(getVerifySpecPaths("run-1").overridePath, "/tmp/ov.json");
  } finally {
    if (original === undefined) delete process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
    else process.env.BROWSER_FLOW_VERIFY_SPEC_PATH = original;
  }
});
