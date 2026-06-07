import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";

test("bf replay re-runs sanitize/persist without re-driving the browser", async () => {
  const runId = `replay-phase56-${Date.now()}`;

  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "synthetic",
    "--headless"
  ]);

  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "synthetic"
  });

  runCli(["done", "--run-id", runId]);

  const runPaths = getRunPaths(runId);
  // After done, all post-sanitize artifacts exist + raw inputs exist.
  assert.equal(existsSync(runPaths.rawEventsPath), true, "raw-events.jsonl present");
  assert.equal(existsSync(runPaths.rawPageEvidencePath), true, "raw-page-evidence.json present");
  assert.equal(existsSync(runPaths.sanitizedEventsPath), true);
  assert.equal(existsSync(runPaths.pageEvidencePath), true);

  // Capture the sanitized snapshots from the live done before replay.
  const beforeSanitized = readJson(runPaths.sanitizedEventsPath);
  const beforeSelectors = readJson(runPaths.selectorsPath);
  const beforeNetwork = readJson(runPaths.networkSummaryPath);
  const beforePageEvidence = readJson(runPaths.pageEvidencePath);
  const beforeSecurity = readJson(runPaths.securityPath);

  // Delete the sanitized outputs to prove replay regenerates them
  // purely from the raw inputs — no carry-over from the live done.
  unlinkSync(runPaths.sanitizedEventsPath);
  unlinkSync(runPaths.selectorsPath);
  unlinkSync(runPaths.networkSummaryPath);
  unlinkSync(runPaths.pageEvidencePath);
  unlinkSync(runPaths.securityPath);

  const replayed = runCli(["replay", "--run-id", runId]);
  assert.equal(replayed.runId, runId);
  assert.equal(typeof replayed.rawEventCount, "number");
  assert.ok(replayed.rawEventCount >= 1, "replay must process at least one raw event");
  assert.equal(typeof replayed.security, "object");

  // All sanitized artifacts must be regenerated.
  assert.equal(existsSync(runPaths.sanitizedEventsPath), true);
  assert.equal(existsSync(runPaths.selectorsPath), true);
  assert.equal(existsSync(runPaths.networkSummaryPath), true);
  assert.equal(existsSync(runPaths.pageEvidencePath), true);
  assert.equal(existsSync(runPaths.securityPath), true);

  // Replay output must match the live done output byte-for-content.
  // Same sanitize implementation → same result → no drift.
  assert.deepEqual(readJson(runPaths.sanitizedEventsPath), beforeSanitized);
  assert.deepEqual(readJson(runPaths.selectorsPath), beforeSelectors);
  assert.deepEqual(readJson(runPaths.networkSummaryPath), beforeNetwork);
  assert.deepEqual(readJson(runPaths.pageEvidencePath), beforePageEvidence);
  assert.deepEqual(readJson(runPaths.securityPath), beforeSecurity);
});

test("replay refuses runs without raw-events.jsonl", () => {
  const runId = `replay-phase56-missing-${Date.now()}`;

  // Synthesize a run dir with manifest but no raw-events.jsonl —
  // simulates a capture without raw streaming or a manually wiped run.
  const runPaths = getRunPaths(runId);
  mkdirSync(runPaths.runRoot, { recursive: true });
  writeFileSync(runPaths.manifestPath, JSON.stringify({ runId, fixture: "none" }));

  let threw = false;
  try {
    runCli(["replay", "--run-id", runId]);
  } catch (error) {
    threw = true;
    assert.match(String(error), /raw-events\.jsonl/);
  }
  assert.equal(threw, true, "replay must throw when raw-events.jsonl is absent");
});
