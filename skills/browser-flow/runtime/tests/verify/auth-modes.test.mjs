import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, writeText } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { readRegistry } from "../../scripts/registry/workflow-registry.mjs";

const SECRET_COOKIE_VALUE = "SECRET-COOKIE-VALUE-XYZ";

/**
 * Build a minimal workflow.json with a precondition (sessionRef).
 * @param {string} runId
 */
function makeWorkflow(runId) {
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    },
    preconditions: [
      {
        kind: "login",
        site: "x",
        authMode: "human-bootstrap+keychain-session",
        sessionRef: "verify:x"
      }
    ]
  };
}

/**
 * A runner stub that:
 * - reads BROWSER_FLOW_SESSION_STATE from env
 * - records the parsed sessionState into a side-channel file (<runnerPath>.state.json)
 *   so the test can assert it was received
 * - writes a minimal success report to verificationPath
 * - emits the report on stdout and exits 0
 *
 * Critically: the stub does NOT write the cookie VALUE into the report.
 * @param {{ runnerPath: string, verificationPath: string }} runPaths
 */
function makeRunnerStub(runPaths) {
  const stateCapturePath = runPaths.runnerPath + ".state.json";
  return `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Capture the sessionState from env (agent-blind channel)
  const raw = process.env.BROWSER_FLOW_SESSION_STATE;
  const sessionState = raw ? JSON.parse(raw) : null;
  writeFileSync(${JSON.stringify(stateCapturePath)}, JSON.stringify(sessionState, null, 2), "utf8");

  const report = {
    success: true,
    pathComplete: true,
    executedSteps: [],
    stepCount: 0,
    transitionChecks: [],
    resultEvidence: {
      passed: true,
      selector: "[data-bf-evidence=\\"result\\"]",
      actualText: "ok",
      expectedText: "ok"
    }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`;
}

test("verifyRun repeat mode reads keychain session and passes it to runner via env var", async () => {
  const runId = `auth-modes-repeat-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, makeWorkflow(runId));
  writeText(runPaths.runnerPath, makeRunnerStub(runPaths));

  const sessionJson = JSON.stringify({
    cookies: [{ name: "SID", value: SECRET_COOKIE_VALUE, domain: "x" }]
  });

  // Inject fake readSession so no real keychain is touched
  const fakeReadSession = (/** @type {string} */ ref) => {
    if (ref === "verify:x") return sessionJson;
    return null;
  };

  const result = await verifyRun(runId, {
    headless: true,
    mode: "repeat",
    readSession: fakeReadSession
  });

  // 1. Overall verify run must succeed (runner returned success)
  assert.equal(result.ok, true, "verifyRun should succeed when runner succeeds");

  // 2. Runner must have received the sessionState via env var
  const stateCapturePath = runPaths.runnerPath + ".state.json";
  const captured = JSON.parse(readFileSync(stateCapturePath, "utf8"));
  assert.ok(captured !== null, "runner must have received sessionState (not null)");
  assert.ok(Array.isArray(captured.cookies), "sessionState.cookies must be an array");
  assert.equal(captured.cookies[0].value, SECRET_COOKIE_VALUE, "runner received the correct cookie value");

  // 3. AGENT-BLIND: the secret must NOT appear in the written verification.json
  const verificationText = readFileSync(runPaths.verificationPath, "utf8");
  assert.equal(
    verificationText.includes(SECRET_COOKIE_VALUE),
    false,
    "verification.json must NOT contain the secret cookie value"
  );

  // 4. AGENT-BLIND: the secret must NOT appear in the security.json scan result
  const securityText = readFileSync(runPaths.securityPath, "utf8");
  assert.equal(
    securityText.includes(SECRET_COOKIE_VALUE),
    false,
    "security.json must NOT contain the secret cookie value"
  );
});

test("verifyRun repeat mode reports needs-first-bootstrap when session is absent", async () => {
  const runId = `auth-modes-no-session-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, makeWorkflow(runId));
  // Runner stub that exits success — but we expect verifyRun to NOT call it at all
  // (or to return a failure before invoking the runner).
  writeText(runPaths.runnerPath, `
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(0);
}
`);

  // fake readSession always returns null (session absent)
  const fakeReadSession = (/** @type {string} */ _ref) => null;

  const result = await verifyRun(runId, {
    headless: true,
    mode: "repeat",
    readSession: fakeReadSession
  });

  // Must fail (not silently proceed)
  assert.equal(result.ok, false, "verifyRun must fail when session is absent in repeat mode");

  // The report must explain what happened
  const verificationText = readFileSync(runPaths.verificationPath, "utf8");
  assert.ok(
    verificationText.includes("first-bootstrap") || verificationText.includes("needs-first"),
    "verification.json must mention that a first-bootstrap is needed"
  );
});

test("verifyRun without preconditions still works (no-op mode, existing regression gate)", async () => {
  const runId = `auth-modes-no-precond-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // workflow WITHOUT preconditions — existing synthetic path must pass unchanged
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    }
    // no preconditions field
  });

  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: [],
    stepCount: 0,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "s", actualText: "ok", expectedText: "ok" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  assert.equal(result.ok, true, "verifyRun without preconditions must still succeed");
});

test("verifyRun first mode: interactive session bootstrap — saves session to keychain, never writes it to report", async () => {
  const SECRET = "SECRET-COOKIE-FIRST-MODE-XYZ";
  const SESSION_REF = "verify:x.com";
  const runId = `auth-modes-first-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    },
    preconditions: [
      {
        kind: "login",
        site: "x.com",
        authMode: "human-bootstrap+keychain-session",
        sessionRef: SESSION_REF
      }
    ]
  });

  // fake session objects
  const fakeTargetId = "fake-target-id-001";
  const fakeSessionId = "fake-session-id-001";
  const fakeClient = { send: async () => ({}) };
  const fakeSessionManager = {
    listPageTargets: () => [{ targetId: fakeTargetId }],
    getSessionId: (/** @type {string} */ tid) => tid === fakeTargetId ? fakeSessionId : undefined
  };
  let disposed = false;
  const fakeLaunchSession = /** @type {any} */ (async (/** @type {unknown} */ _opts) => ({
    client: fakeClient,
    sessionManager: fakeSessionManager,
    dispose: async () => { disposed = true; }
  }));

  // ask resolves immediately (human pressed Enter)
  const fakeAsk = async (/** @type {string} */ _prompt) => "";

  // captureSessionState returns known cookies
  const fakeCaptureSessionState = async (/** @type {unknown} */ _client, /** @type {unknown} */ _sid) => ({
    cookies: [{ name: "SID", value: SECRET, domain: "x.com" }]
  });

  // saveSession records what was saved
  /** @type {{ ref: string, value: string } | null} */
  let savedEntry = null;
  const fakeSaveSession = (/** @type {string} */ ref, /** @type {string} */ value) => {
    savedEntry = { ref, value };
  };

  const result = await verifyRun(runId, {
    headless: false,
    mode: "first",
    launchSession: fakeLaunchSession,
    ask: fakeAsk,
    captureSessionState: fakeCaptureSessionState,
    saveSession: fakeSaveSession
  });

  // 1. saveSession called with correct sessionRef
  assert.ok(savedEntry !== null, "saveSession must have been called");
  const entry = /** @type {{ ref: string, value: string }} */ (savedEntry);
  assert.equal(entry.ref, SESSION_REF, "saveSession ref must match precondition.sessionRef");

  // 2. The saved value is a JSON string containing the cookies
  const savedState = JSON.parse(entry.value);
  assert.ok(Array.isArray(savedState.cookies), "saved value must be a SessionState with cookies array");
  assert.equal(savedState.cookies[0].value, SECRET, "saved cookies must contain the captured cookie value");

  // 3. AGENT-BLIND: session value must NOT appear in verification.json
  const verificationText = readFileSync(runPaths.verificationPath, "utf8");
  assert.equal(
    verificationText.includes(SECRET),
    false,
    "verification.json must NOT contain the session secret (agent-blind invariant)"
  );

  // 4. Returned report.bootstrapped must match sessionRef
  assert.equal(
    (/** @type {any} */ (result.report)).bootstrapped,
    SESSION_REF,
    "returned report.bootstrapped must equal the precondition sessionRef"
  );

  // 5. Result ok
  assert.equal(result.ok, true, "verifyRun first mode must return ok:true after bootstrap");

  // 6. session.dispose() was called
  assert.equal(disposed, true, "session.dispose() must have been called");

  // 7. first mode is a bootstrap, never a verified replay
  const fmEntry = readRegistry().find((e) => e.id === runId);
  assert.equal(fmEntry?.status, "bootstrapped", "first mode must register as bootstrapped, not verified");
  assert.notEqual(fmEntry?.status, "verified");
});
