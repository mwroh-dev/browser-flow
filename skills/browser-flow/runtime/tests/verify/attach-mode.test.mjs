import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, writeText } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";

/**
 * @param {string} runId
 */
function makeWorkflowWithLogin(runId) {
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: { expectedFinalUrl: "/synthetic/result", expectedNetwork: null, expectedEvidence: null },
    preconditions: [
      { kind: "login", site: "x", authMode: "human-bootstrap+keychain-session", sessionRef: "verify:x" }
    ]
  };
}

/**
 * Runner stub that records the attach port + session state it received (env channel)
 * into a side file, then emits a minimal success report.
 * @param {{ runnerPath: string, verificationPath: string }} runPaths
 */
function makeEnvCaptureRunnerStub(runPaths) {
  const capturePath = runPaths.runnerPath + ".env.json";
  return `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
    attachPort: process.env.BROWSER_FLOW_ATTACH_PORT ?? null,
    sessionState: process.env.BROWSER_FLOW_SESSION_STATE ?? null
  }, null, 2), "utf8");
  const report = {
    success: true, pathComplete: true, executedSteps: [], stepCount: 0,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "s", actualText: "ok", expectedText: "ok" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`;
}

test("attach mode skips keychain and passes BROWSER_FLOW_ATTACH_PORT to the runner", async () => {
  const runId = `attach-mode-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, makeWorkflowWithLogin(runId));
  writeText(runPaths.runnerPath, makeEnvCaptureRunnerStub(runPaths));

  // readSession spy — MUST NOT be called in attach mode (keychain bypassed).
  let readSessionCalled = false;
  const spyReadSession = (/** @type {string} */ _ref) => {
    readSessionCalled = true;
    return JSON.stringify({ cookies: [{ name: "SID", value: "SHOULD-NOT-BE-USED", domain: "x" }] });
  };

  const result = await verifyRun(runId, {
    headless: true,
    attachPort: 9333,
    readSession: spyReadSession
  });

  assert.equal(result.ok, true, "attach-mode verifyRun should succeed");
  assert.equal(readSessionCalled, false, "keychain readSession must NOT be called in attach mode");

  const captured = JSON.parse(readFileSync(runPaths.runnerPath + ".env.json", "utf8"));
  assert.equal(captured.attachPort, "9333", "runner must receive BROWSER_FLOW_ATTACH_PORT=9333");
  assert.equal(captured.sessionState, null, "no cookie session state must be injected in attach mode");
});

test("attach mode proceeds even when no keychain session exists (no needs-first-bootstrap)", async () => {
  const runId = `attach-no-session-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, makeWorkflowWithLogin(runId));
  writeText(runPaths.runnerPath, makeEnvCaptureRunnerStub(runPaths));

  // Session absent — in repeat mode this would report needs-first-bootstrap and
  // never run the runner. Attach mode must bypass that and run the runner.
  const result = await verifyRun(runId, {
    headless: true,
    attachPort: 9444,
    readSession: (/** @type {string} */ _ref) => null
  });

  assert.equal(result.ok, true, "attach mode must proceed without a keychain session");
  assert.equal(
    existsSync(runPaths.runnerPath + ".env.json"),
    true,
    "runner must have been invoked (not short-circuited by needs-first-bootstrap)"
  );
  const verificationText = readFileSync(runPaths.verificationPath, "utf8");
  assert.equal(
    verificationText.includes("needs-first"),
    false,
    "attach mode must NOT report needs-first-bootstrap"
  );
});
