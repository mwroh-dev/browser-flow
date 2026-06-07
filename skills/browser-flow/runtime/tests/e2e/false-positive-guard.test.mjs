import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPaths, getRunPaths } from "../../scripts/lib/config.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { readJson, writeJson, writeText } from "../../scripts/lib/fs.mjs";
import { runCli } from "../helpers/cli.mjs";
import { driveObservedWorkflow } from "../helpers/demo-driver.mjs";
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../scripts/cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../../scripts/cdp/watchdogs/action.mjs";
import { getFreePort } from "../../scripts/lib/net.mjs";

/**
 * @param {string} runId
 */
async function capturedSyntheticRun(runId) {
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
  runCli(["analyze", "--run-id", runId]);
}

/**
 * @param {string} runId
 */
async function capturedDocsRun(runId) {
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "docs",
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "docs"
  });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);
}

/**
 * @param {string} runId
 */
async function capturedStatefulRun(runId) {
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "stateful",
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "stateful"
  });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);
}

/**
 * @param {string} runId
 */
async function capturedSubmitRun(runId) {
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "submit",
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "submit"
  });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);
}

/**
 * @param {string} runId
 */
async function capturedSecretRun(runId) {
  const prepared = runCli([
    "prepare",
    "--run-id", runId,
    "--fixture", "secret",
    "--headless"
  ]);
  await driveObservedWorkflow({
    debugPort: prepared.debugPort,
    workflow: "secret"
  });
  runCli(["done", "--run-id", runId]);
  runCli(["analyze", "--run-id", runId]);
  runCli(["generate", "--run-id", runId]);
}

// Use CDP-direct to seed the stale profile so cookie storage
// is compatible with the CDP runner (avoids Playwright ↔ CDP encryption mismatch).
async function seedStatefulCookieProfile() {
  const profileDir = mkdtempSync(join(tmpdir(), "browser-flow-stale-profile-"));
  const server = await startFixtureServer();
  const debugPort = await getFreePort();
  const bs = await createBrowserSession({ profileDir, debugPort, headless: true });
  const lifecycle = await installLifecycleWatchdog(bs);
  const action = await installActionWatchdog(bs);
  try {
    const [target] = bs.sessionManager.listPageTargets();
    const targetId = target.targetId;
    await lifecycle.navigateAndWait(targetId, `${server.baseUrl}/stateful`, { waitUntil: "domcontentloaded" });
    await action.clickBySelector(targetId, '[data-bf="stateful-launch"]');
    // Wait for the redirect to /stateful/result
    const deadline = Date.now() + 10_000;
    const sid = bs.sessionManager.getSessionId(targetId);
    while (Date.now() < deadline) {
      const res = /** @type {any} */ (await bs.client.send("Runtime.evaluate", { expression: "location.pathname", returnByValue: true }, sid));
      if (String(res.result.value).includes("/stateful/result")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    await action.dispose();
    await lifecycle.dispose();
    await bs.dispose();
    await server.close();
    // Brief delay for Chrome to release file handles.
    await new Promise((r) => setTimeout(r, 200));
  }
  return profileDir;
}

test("verification fails when the expected network transition is wrong", async () => {
  const runId = `guard-network-${Date.now()}`;
  await capturedSyntheticRun(runId);
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ verification: { expectedNetwork: { url: string, method: string, status: number } | null } }} */ (readJson(runPaths.workflowJsonPath));
  if (!workflow.verification.expectedNetwork) {
    throw new Error("Synthetic workflow should derive a network expectation.");
  }
  workflow.verification.expectedNetwork.url = "/api/missing";
  writeJson(runPaths.workflowJsonPath, workflow);
  runCli(["generate", "--run-id", runId]);

  const result = runCli(["verify", "--run-id", runId, "--headless"]);

  assert.equal(result.ok, false);
  assert.equal(result.report.transitionChecks.some(
    /** @param {{ name: string, passed: boolean }} check */ (check) => check.name === "network" && check.passed === false
  ), true);
});

test("verification fails when expected result evidence is wrong", async () => {
  const runId = `guard-evidence-${Date.now()}`;
  await capturedSyntheticRun(runId);
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ verification: { expectedEvidence: { textIncludes: string } | null } }} */ (readJson(runPaths.workflowJsonPath));
  if (!workflow.verification.expectedEvidence) {
    throw new Error("Synthetic workflow should derive result evidence.");
  }
  workflow.verification.expectedEvidence.textIncludes = "Definitely Not Here";
  writeJson(runPaths.workflowJsonPath, workflow);
  runCli(["generate", "--run-id", runId]);

  const result = runCli(["verify", "--run-id", runId, "--headless"]);

  assert.equal(result.ok, false);
  assert.equal(result.report.resultEvidence.passed, false);
});

test("verification fails when a broad selector reaches the right route via the wrong element", async () => {
  const runId = `guard-action-${Date.now()}`;
  await capturedDocsRun(runId);
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{
   *   steps: Array<{ action: string, selector: string, text?: string, href?: string }>,
   *   verification: {
   *     expectedFinalUrl: string,
   *     expectedNetwork: { url: string, method: string, status: number } | null,
   *     expectedEvidence: { selector: string, textIncludes: string } | null
   *   }
   * }} */ (readJson(runPaths.workflowJsonPath));

  workflow.steps[3].selector = "a";
  // Also strip the multi-signal locator (+ any atomic-fp) so resolution genuinely
  // falls back to the broadened selector and reaches the WRONG element — otherwise
  // resolveLocator would correctly pin the right element via the locator (that
  // robustness is intended; this guard tests the path-mismatch safety check).
  delete /** @type {any} */ (workflow.steps[3]).locator;
  delete /** @type {any} */ (workflow.steps[3]).atomicFp;
  writeJson(runPaths.workflowJsonPath, workflow);
  runCli(["generate", "--run-id", runId]);

  const result = runCli(["verify", "--run-id", runId, "--headless"]);

  assert.equal(result.ok, false);
  assert.match(result.report.error ?? "", /Action-path mismatch/);
});

test("verification fails when the chosen element matches text but has no href", async () => {
  const runId = `guard-no-href-${Date.now()}`;
  await capturedDocsRun(runId);
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ steps: Array<{ selector: string }> }} */ (readJson(runPaths.workflowJsonPath));

  workflow.steps[3].selector = ".card button, .card a";
  // Strip the locator (+ atomic-fp) so the broad selector resolves the wrong
  // element instead of being corrected by the captured fingerprint.
  delete /** @type {any} */ (workflow.steps[3]).locator;
  delete /** @type {any} */ (workflow.steps[3]).atomicFp;
  writeJson(runPaths.workflowJsonPath, workflow);
  runCli(["generate", "--run-id", runId]);

  const result = runCli(["verify", "--run-id", runId, "--headless"]);

  assert.equal(result.ok, false);
  assert.match(result.report.error ?? "", /expected href/);
});

test("verification ignores stale profile state by using a fresh replay profile", async () => {
  const runId = `guard-stale-profile-${Date.now()}`;
  await capturedStatefulRun(runId);
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ fixture: string, startUrl: string, finalUrl: string, steps: Array<{ action: string, url?: string }>, verification: { expectedFinalUrl: string, expectedNetwork: { url: string, method: string, status: number } | null } }} */ (readJson(runPaths.workflowJsonPath));

  workflow.fixture = "stateful";
  workflow.startUrl = "/stateful";
  workflow.finalUrl = "/stateful/result";
  workflow.steps = [{ action: "goto", url: "/stateful" }];
  workflow.verification.expectedFinalUrl = "/stateful/result";
  workflow.verification.expectedNetwork = null;
  writeJson(runPaths.workflowJsonPath, workflow);
  runCli(["generate", "--run-id", runId]);

  const staleProfileDir = await seedStatefulCookieProfile();
  try {
    const runner = /** @type {{ runWorkflow: (options: Record<string, unknown>) => Promise<{ success: boolean }> }} */ (
      await import(`${pathToFileURL(runPaths.runnerPath).href}?t=${Date.now()}`)
    );
    const staleReport = await runner.runWorkflow({
      headless: true,
      replayProfileDir: staleProfileDir,
      reportPath: `${runPaths.verificationPath}.stale.json`
    });

    assert.equal(staleReport.success, true);

    const result = runCli(["verify", "--run-id", runId, "--headless"]);

    assert.equal(result.ok, false);
  } finally {
    rmSync(staleProfileDir, { recursive: true, force: true });
  }
});

test("verification fails closed when a forbidden artifact is injected after generate", async () => {
  const runId = `guard-security-${Date.now()}`;
  await capturedSyntheticRun(runId);
  const runPaths = getRunPaths(runId);
  runCli(["generate", "--run-id", runId]);
  writeText(join(runPaths.runRoot, "forbidden.txt"), "authorization: x");

  const result = runCli(["verify", "--run-id", runId, "--headless"]);
  const registry = /** @type {Array<{ id: string, status: string }>} */ (readJson(getPaths().registryPath));

  assert.equal(result.ok, false);
  assert.equal(result.security.ok, false);
  assert.equal(result.security.findings.some(
    /** @param {{ reason: string }} finding */ (finding) => finding.reason === "secret header name"
  ), true);
  assert.equal(registry.some((entry) => entry.id === runId && entry.status === "failed"), true);
});

test("verification fails when submit replay targets the wrong form", async () => {
  const runId = `guard-submit-form-${Date.now()}`;
  await capturedSubmitRun(runId);
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ steps: Array<{ action: string, selector: string, submitterSelector?: string }> }} */ (readJson(runPaths.workflowJsonPath));
  const submitStep = workflow.steps.find((step) => step.action === "submit");
  if (!submitStep) {
    throw new Error("Submit workflow should include a submit step.");
  }
  submitStep.selector = "form";
  submitStep.submitterSelector = "";
  writeJson(runPaths.workflowJsonPath, workflow);
  runCli(["generate", "--run-id", runId]);

  const result = runCli(["verify", "--run-id", runId, "--headless"]);

  assert.equal(result.ok, false);
  assert.match(result.report.error ?? "", /Submit-path mismatch/);
});

test("verification fails when fill replay targets the wrong field", async () => {
  const runId = `guard-fill-field-${Date.now()}`;
  await capturedSubmitRun(runId);
  const runPaths = getRunPaths(runId);
  const workflow = /** @type {{ steps: Array<{ action: string, selector: string, fieldName?: string }> }} */ (readJson(runPaths.workflowJsonPath));
  const fillStep = workflow.steps.find((step) => step.action === "fill");
  if (!fillStep) {
    throw new Error("Submit workflow should include a fill step.");
  }
  fillStep.selector = "input";
  // Strip the locator (+ atomic-fp) so the broad selector resolves the wrong
  // field instead of being corrected by the captured fingerprint.
  delete /** @type {any} */ (fillStep).locator;
  delete /** @type {any} */ (fillStep).atomicFp;
  writeJson(runPaths.workflowJsonPath, workflow);
  runCli(["generate", "--run-id", runId]);

  const result = runCli(["verify", "--run-id", runId, "--headless"]);

  assert.equal(result.ok, false);
  assert.match(result.report.error ?? "", /Fill-path mismatch/);
});

test("verification fails when the replay secret is missing", async () => {
  const runId = `guard-secret-missing-${Date.now()}`;
  await capturedSecretRun(runId);
  delete process.env.BROWSER_FLOW_SECRET_0;

  const result = runCli(["verify", "--run-id", runId, "--headless"]);

  assert.equal(result.ok, false);
  assert.match(result.report.error ?? "", /BROWSER_FLOW_SECRET_0/);
});

test("verification fails when the replay secret is wrong", async () => {
  const runId = `guard-secret-wrong-${Date.now()}`;
  await capturedSecretRun(runId);
  process.env.BROWSER_FLOW_SECRET_0 = "wrong-secret";
  try {
    const runPaths = getRunPaths(runId);
    const workflow = /** @type {{ verification: { transitionTimeoutMs?: number } }} */ (readJson(runPaths.workflowJsonPath));
    workflow.verification.transitionTimeoutMs = 5_000;
    writeJson(runPaths.workflowJsonPath, workflow);
    runCli(["generate", "--run-id", runId]);
    const result = runCli(["verify", "--run-id", runId, "--headless"]);

    assert.equal(result.ok, false);
    assert.equal(result.report.failureReason, "expected-url-timeout");
    assert.equal(Array.isArray(result.report.executedSteps), true);
    assert.equal(result.report.executedSteps.includes("click"), true);
  } finally {
    delete process.env.BROWSER_FLOW_SECRET_0;
  }
});
