import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, writeText } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { readRegistry } from "../../scripts/registry/workflow-registry.mjs";

test("verify fallback writes a sanitized verification report before scanning", async () => {
  const runId = `verify-fallback-${Date.now()}`;
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
    }
  });
  // CLI-compatible runner stub: throws, so subprocess exits non-zero with the
  // error message on stderr (which contains the secret that must be redacted).
  writeText(runPaths.runnerPath, `
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write("password=letmein\\n");
  process.exit(1);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationText = readFileSync(runPaths.verificationPath, "utf8");

  assert.equal(result.ok, false);
  assert.equal(verificationText.includes("letmein"), false);
  assert.equal(verificationText.includes("<redacted-secret-text>"), true);
});

test("verify returned reports are sanitized before the final security scan", async () => {
  const runId = `verify-report-${Date.now()}`;
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
      transitionTimeoutMs: 30_000,
      expectedNetwork: null,
      expectedEvidence: null
    }
  });
  // CLI-compatible runner stub: writes a report with unsanitized secrets to
  // verificationPath, then emits the same report on stdout and exits 0.
  // verify-run must sanitize both the disk artifact and the final report.
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: [],
    stepCount: 0,
    transitionChecks: [
      { name: "final-url", expected: "/synthetic?token=abc123", actual: "/synthetic?token=abc123", passed: false }
    ],
    resultEvidence: {
      passed: false,
      selector: "[data-bf-evidence=\\"result\\"]",
      actualText: "password=letmein",
      expectedText: "password=letmein"
    },
    error: "password=letmein"
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationText = readFileSync(runPaths.verificationPath, "utf8");
  const securityText = readFileSync(runPaths.securityPath, "utf8");

  assert.equal(result.ok, false);
  assert.equal(verificationText.includes("letmein"), false);
  assert.equal(securityText.includes("letmein"), false);
});

test("verify surfaces excludedSteps and consentRequired from workflow.safety into verification.json", async () => {
  const runId = `verify-phase76-safety-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // Workflow has safety.irreversibleStepIndexes:[1] and consentRequired:true
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [
      { action: "goto" },
      { action: "click", text: "결제하기" },
      { action: "goto" }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      transitionTimeoutMs: 30_000,
      expectedNetwork: null,
      expectedEvidence: null
    },
    safety: {
      irreversibleStepIndexes: [1],
      consentRequired: true,
      sandbox: { available: false, location: null }
    }
  });

  // Runner stub: returns a report that includes excludedSteps (as the real runner would)
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: ["goto", "goto"],
    stepCount: 3,
    excludedSteps: [{ index: 1, action: "click", reason: "irreversible" }],
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  // excludedSteps must appear in verification.json
  assert.ok(Array.isArray(verificationJson.excludedSteps), "excludedSteps must be in verification.json");
  assert.equal(verificationJson.excludedSteps.length, 1, "one step was excluded");
  assert.equal(verificationJson.excludedSteps[0].index, 1);
  assert.equal(verificationJson.excludedSteps[0].reason, "irreversible");

  // consentRequired must appear in verification.json (propagated from workflow.safety)
  assert.equal(verificationJson.consentRequired, true, "consentRequired must be in verification.json");
});

test("verify surfaces teardownSteps + derives teardownComplete from runner report", async () => {
  const runId = `verify-phase77-teardown-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    },
    teardown: {
      strategy: "record",
      steps: [{ action: "goto", url: "/synthetic/teardown" }],
      dummyNaming: { prefix: "test", hashLen: 8 }
    }
  });

  // Runner stub: writes a report that includes teardownSteps (as the real runner would)
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" },
    teardownSteps: [
      { action: "goto", ok: true }
    ]
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  // teardownSteps must appear in verification.json
  assert.ok(Array.isArray(verificationJson.teardownSteps), "teardownSteps must be in verification.json");
  assert.equal(verificationJson.teardownSteps.length, 1, "one teardown step recorded");
  assert.equal(verificationJson.teardownSteps[0].action, "goto");
  assert.equal(verificationJson.teardownSteps[0].ok, true);

  // teardownComplete must be derived as true (all steps ok)
  assert.equal(verificationJson.teardownComplete, true, "teardownComplete must be true when all teardownSteps ok");

  // result must also carry the same values
  assert.ok(Array.isArray(/** @type {any} */ (result.report).teardownSteps), "result.report.teardownSteps must be present");
  assert.equal(/** @type {any} */ (result.report).teardownComplete, true, "result.report.teardownComplete must be true");
});

test("teardownComplete is false when any teardownStep has ok===false", async () => {
  const runId = `verify-phase77-teardown-fail-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });

  // Runner stub: teardownSteps has one failed step
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" },
    teardownSteps: [
      { action: "click", ok: true },
      { action: "goto", ok: false, error: "navigation failed" }
    ]
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.teardownSteps.length, 2);
  assert.equal(verificationJson.teardownComplete, false, "teardownComplete must be false when a step has ok===false");
});

test("verify dummy-substitutes text inputs when no sandbox (BROWSER_FLOW_DUMMY_BINDINGS env set)", async () => {
  const runId = `verify-phase78-dummy-sub-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // Workflow with text input + sandbox.available=false
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    inputs: [
      { name: "itemName", label: "Item Name", suggestedFrom: 0, type: "text" }
    ],
    steps: [
      { action: "goto" },
      { action: "fill", selector: "#name", valueRef: "{{input.itemName}}" }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: false, location: null }
    },
    teardown: {
      strategy: "record",
      steps: [],
      dummyNaming: { prefix: "__bf_test__", hashLen: 8 }
    }
  });

  // Runner stub: writes the BROWSER_FLOW_DUMMY_BINDINGS env value into the report
  // so the test can inspect what bindings were passed.
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dummyBindingsRaw = process.env.BROWSER_FLOW_DUMMY_BINDINGS ?? null;
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: ["goto", "fill"],
    stepCount: 2,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" },
    _testDummyBindingsReceived: dummyBindingsRaw
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  // The runner must have received BROWSER_FLOW_DUMMY_BINDINGS
  assert.ok(
    /** @type {any} */ (verificationJson)._testDummyBindingsReceived !== null,
    "BROWSER_FLOW_DUMMY_BINDINGS must be set for no-sandbox text inputs"
  );
  const receivedBindings = JSON.parse(/** @type {any} */ (verificationJson)._testDummyBindingsReceived);
  assert.ok("itemName" in receivedBindings, "itemName must be in dummy bindings");
  assert.match(receivedBindings.itemName, /^__bf_test__[0-9a-f]{8}$/, "dummy value must match prefix+hash pattern");

  // dummyBindingNames must be in the final verification report (for teardown/orphan-sweep)
  assert.ok(
    Array.isArray(/** @type {any} */ (verificationJson).dummyBindingNames),
    "dummyBindingNames must be in verification.json"
  );
  assert.ok(
    /** @type {any} */ (verificationJson).dummyBindingNames.includes("itemName"),
    "dummyBindingNames must include itemName"
  );
});

test("verify does NOT dummy-substitute when sandbox.available=true", async () => {
  const runId = `verify-phase78-sandbox-skip-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // Workflow with text input + sandbox.available=true — no dummy substitution
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    inputs: [
      { name: "itemName", label: "Item Name", suggestedFrom: 0, type: "text" }
    ],
    steps: [
      { action: "goto" },
      { action: "fill", selector: "#name", valueRef: "{{input.itemName}}" }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    },
    safety: {
      irreversibleStepIndexes: [],
      consentRequired: false,
      sandbox: { available: true, location: "/tmp/sandbox" }
    }
  });

  // Runner stub: captures whether BROWSER_FLOW_DUMMY_BINDINGS was set
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dummyBindingsRaw = process.env.BROWSER_FLOW_DUMMY_BINDINGS ?? null;
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: ["goto", "fill"],
    stepCount: 2,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" },
    _testDummyBindingsReceived: dummyBindingsRaw
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  // When sandbox is available, BROWSER_FLOW_DUMMY_BINDINGS must NOT be set
  assert.equal(
    /** @type {any} */ (verificationJson)._testDummyBindingsReceived,
    null,
    "BROWSER_FLOW_DUMMY_BINDINGS must NOT be set when sandbox.available=true"
  );

  // dummyBindingNames must NOT appear in verification.json when sandbox is available
  assert.ok(
    !Array.isArray(/** @type {any} */ (verificationJson).dummyBindingNames) ||
    /** @type {any} */ (verificationJson).dummyBindingNames.length === 0,
    "dummyBindingNames must be absent or empty when sandbox.available=true"
  );
});

test("unmasked verify with findings: diagnosticMode:true and securityOk:false (not green)", async () => {
  const runId = `verify-diag-mode-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  // An unmasked workflow (security.localOnly=false triggers workflowUnmasked=true).
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [],
    // localOnly:false → unmasked/diagnostic mode
    security: { localOnly: false, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });

  // Plant a secret header file in the run dir BEFORE verifyRun so scanArtifacts
  // produces a finding (warningOnly under --unmasked) → securityOk:false via isSecurityClean.
  writeText(resolve(runPaths.runRoot, "trigger.txt"), "Authorization: eyJhbGciOiJIUzI1NiJ9.AAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBB");

  // Runner stub: success report — the finding comes from trigger.txt, not the runner output.
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
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));
  const summaryJson = JSON.parse(readFileSync(resolve(runPaths.reportsDir, "verification-summary.json"), "utf8"));

  // diagnosticMode must be true for unmasked workflows
  assert.equal(verificationJson.diagnosticMode, true, "unmasked verify must set diagnosticMode:true in the report");
  // securityOk must be false: findings exist → warningOnly:true → isSecurityClean returns false
  assert.equal(verificationJson.securityOk, false, "unmasked verify with findings must set securityOk:false (not green)");
  assert.equal(verificationJson.replayOutcome, "passed");
  assert.equal(verificationJson.promotionOutcome, "not_promoted");
  assert.equal(verificationJson.securityScanOk, true);
  assert.equal(verificationJson.securityPromotionClean, false);
  assert.deepEqual(verificationJson.promotionBlockers, [
    { gate: "security", reason: "warning_only_findings" },
    { gate: "registry", reason: "external_requires_operator_approval" }
  ]);
  assert.equal(verificationJson.promotionCandidate.status, "external_replay_candidate");
  assert.ok(result.summary);
  const summary = result.summary;
  assert.equal(summary.headline, "External replay succeeded; save it with explicit promotion approval.");
  assert.equal(summaryJson.headline, summary.headline);
  assert.equal(JSON.stringify(summaryJson).includes("eyJhbGci"), false);
  // Pipeline ok is still true (raw security.ok=true under --unmasked; runner succeeded)
  assert.equal(result.ok, true, "unmasked verify pipeline proceeds when runner succeeds (security is warn-not-block)");
});

test("unmasked public-read verify auto-promotes replay-verified registry entry", async () => {
  const runId = `verify-public-read-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "https://news.example/",
    finalUrl: "https://news.example/economy",
    steps: [{ action: "goto", url: "https://news.example/" }],
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    },
    safety: { irreversibleStepIndexes: [], consentRequired: false, sandbox: { available: false, location: null } },
    verification: {
      expectedFinalUrl: "https://news.example/economy",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "body", actualText: "Economy", expectedText: "Economy" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));
  const saved = /** @type {Record<string, any> | undefined} */ (readRegistry().find((entry) => entry.id === runId));

  assert.equal(result.ok, true);
  assert.equal(verificationJson.promotionOutcome, "promoted");
  assert.deepEqual(verificationJson.promotionBlockers, []);
  assert.equal(saved?.status, "replay_verified");
  assert.equal(saved?.promotion?.approvalSource, "auto-public-read");
  assert.equal(saved?.promotion?.authMode, "none");
  assert.equal(saved?.promotion?.dataMode, "route");
});

test("unmasked verify preserves locator drift as the primary replay outcome when findings are warning-only", async () => {
  const runId = `verify-diag-locator-drift-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [],
    security: { localOnly: false, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });

  writeText(resolve(runPaths.runRoot, "trigger.txt"), "Authorization: eyJhbGciOiJIUzI1NiJ9.AAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBB");

  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: ["goto", "click", "click"],
    stepCount: 5,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" },
    failureReason: "replay-error",
    error: "ambiguous locator: low-confidence resolution (winner=0.95 margin=0.18 mass=0.00)"
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(result.ok, false);
  assert.equal(verificationJson.diagnosticMode, true);
  assert.equal(verificationJson.securityOk, false);
  assert.equal(verificationJson.verificationOutcome, "not_verified");
  assert.equal(verificationJson.reasonCategory, "locator_drift");
  assert.equal(verificationJson.blockingGate, "locator");
  assert.equal(verificationJson.userFault, false);
  assert.equal(verificationJson.replayOutcome, "held");
  assert.equal(verificationJson.promotionOutcome, "not_promoted");
  const promotionBlockers = /** @type {Array<{ gate: string }>} */ (verificationJson.promotionBlockers);
  assert.equal(promotionBlockers.some((blocker) => blocker.gate === "replay"), true);
});

test("teardownComplete is true when teardownSteps is absent (no teardown)", async () => {
  const runId = `verify-phase77-no-teardown-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });

  // Runner stub: no teardownSteps in report (no teardown in workflow)
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: true,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  // teardownSteps absent → teardownComplete should be true
  assert.equal(verificationJson.teardownComplete, true, "teardownComplete must be true when teardownSteps is absent");
});

test("verify classifies action-path mismatch as dynamic content drift without operator message", async () => {
  const runId = `verify-action-path-drift-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "click" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });

  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: [],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
    failureReason: "action-path-mismatch",
    error: "Action-path mismatch for [data-bf=\\"launch\\"]: expected text \\"Run Demo\\" but saw \\"Start Demo\\""
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  const result = await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(result.ok, false);
  assert.equal(verificationJson.success, false);
  assert.equal(verificationJson.verificationOutcome, "not_verified");
  assert.equal(verificationJson.reasonCategory, "dynamic_content_drift");
  assert.equal(verificationJson.blockingGate, "action_path");
  assert.equal(verificationJson.userFault, false);
  assert.ok(!("operatorMessage" in verificationJson));
});

test("verify classifies failed transition checks as transition holds", async () => {
  const runId = `verify-transition-hold-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: { expectedFinalUrl: "/synthetic/result", expectedNetwork: null, expectedEvidence: null }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [{ name: "final-url", passed: false, expected: "/synthetic/result", actual: "/synthetic/other" }],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.verificationOutcome, "not_verified");
  assert.equal(verificationJson.reasonCategory, "transition_timeout");
  assert.equal(verificationJson.blockingGate, "transition");
});

test("verify classifies failed proof checks as dynamic content drift at proof gate", async () => {
  const runId = `verify-proof-hold-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic?mode=rain",
    finalUrl: "/synthetic?mode=rain",
    steps: [{ action: "goto" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic?mode=rain",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [
        { kind: "final-url", expectedUrl: "/synthetic?mode=rain", required: true },
        {
          kind: "url-state",
          expectedUrl: "/synthetic?mode=rain",
          params: [{ key: "mode", value: "rain" }],
          required: true
        }
      ]
    }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [{ name: "final-url", passed: true }],
    proofChecks: [
      { kind: "final-url", name: "final-url", expected: "/synthetic?mode=rain", actual: "/synthetic?mode=rain", passed: true },
      {
        kind: "url-state",
        name: "url-state",
        expected: { params: [{ key: "mode", value: "rain" }] },
        actual: { params: [{ key: "mode", value: "snow" }] },
        passed: false
      }
    ],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.verificationOutcome, "not_verified");
  assert.equal(verificationJson.reasonCategory, "dynamic_content_drift");
  assert.equal(verificationJson.blockingGate, "proof");
});

test("verify classifies failed state-control proof checks as state drift", async () => {
  const runId = `verify-state-control-proof-hold-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic",
    steps: [{ action: "goto" }, { action: "click", text: "Rain", replayIntent: "state_action" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic",
      expectedNetwork: null,
      expectedEvidence: null,
      proofs: [
        { kind: "final-url", expectedUrl: "/synthetic", required: true },
        {
          kind: "state-control",
          stepIndex: 1,
          controlText: "Rain",
          controlRole: "button",
          domEvidence: { selector: "[data-mode]", textIncludes: "Rain selected" },
          required: true
        }
      ]
    }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: true,
    executedSteps: ["goto", "click"],
    stepCount: 2,
    transitionChecks: [{ name: "final-url", passed: true }],
    proofChecks: [
      { kind: "final-url", name: "final-url", expected: "/synthetic", actual: "/synthetic", passed: true },
      { kind: "state-control", name: "state-control", expected: { controlText: "Rain" }, actual: { domEvidence: { text: "Satellite selected" } }, passed: false }
    ],
    resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.verificationOutcome, "not_verified");
  assert.equal(verificationJson.reasonCategory, "state_drift");
  assert.equal(verificationJson.blockingGate, "proof");
});

test("verify classifies failed result evidence as evidence holds", async () => {
  const runId = `verify-evidence-hold-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: { expectedFinalUrl: "/synthetic/result", expectedNetwork: null, expectedEvidence: null }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: true,
    executedSteps: ["goto"],
    stepCount: 1,
    transitionChecks: [{ name: "final-url", passed: true }],
    resultEvidence: { passed: false, selector: "[data-bf-evidence=\\"result\\"]", actualText: "Loading", expectedText: "Done" }
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.verificationOutcome, "not_verified");
  assert.equal(verificationJson.reasonCategory, "evidence_mismatch");
  assert.equal(verificationJson.blockingGate, "evidence");
});

test("verify classifies lowercase method-B transition mismatch as locator drift", async () => {
  const runId = `verify-method-b-hold-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "click" }],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: { expectedFinalUrl: "/synthetic/result", expectedNetwork: null, expectedEvidence: null }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: [],
    stepCount: 1,
    transitionChecks: [],
    resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
    failureReason: "replay-error",
    error: "method-B transition mismatch: recorded reaction did not occur (wrong element)"
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.reasonCategory, "locator_drift");
  assert.equal(verificationJson.blockingGate, "locator");
});

test("generateRunner emits structured held-report fields while preserving drift details", () => {
  const runId = `generate-held-report-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [
      { action: "goto" }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "/synthetic/result",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });

  generateRunner(runId);
  const source = readFileSync(runPaths.runnerPath, "utf8");

  assert.match(source, /function classifyReasonCategory\(message\)/);
  assert.match(source, /function classifyBlockingGate\(message\)/);
  assert.match(source, /verificationOutcome: "not_verified"/);
  assert.match(source, /reasonCategory: classifyReasonCategory\(driftReason\)/);
  assert.match(source, /blockingGate: classifyBlockingGate\(driftReason\)/);
  assert.match(source, /userFault: false/);
  assert.match(source, /failureReason: classifyFailure\(driftReason\)/);
  assert.match(source, /driftReason,/);
  assert.match(source, /toLowerCase\(\)\.includes\("method-b transition mismatch"\)/);
});

test("verify action-path fallback surfaces capture_noise_review guidance for interrupted toggle steps", async () => {
  const runId = `verify-capture-noise-hint-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "http://127.0.0.1:59999/reveal/noise",
    finalUrl: "http://127.0.0.1:59999/reveal/weather",
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "a",
        text: "Expand menu",
        href: "http://127.0.0.1:59999/reveal/noise#closed",
        locator: {
          role: "button",
          name: "Expand menu",
          structuralKey: "header>nav>a|role=button||menu-toggle",
          href: "http://127.0.0.1:59999/reveal/noise#closed"
        },
        transition: {
          refType: "click",
          settleStatus: "interrupted",
          appeared: [],
          disappeared: [],
          changed: []
        },
        captureNoise: {
          reviewCandidateId: "cn1",
          reviewStatus: "needs_review"
        }
      }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "http://127.0.0.1:59999/reveal/weather",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: ["goto"],
    stepCount: 2,
    transitionChecks: [],
    resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
    failureReason: "action-path-mismatch",
    error: "Action-path mismatch for a: expected href \\"/\\" but saw \\"#\\""
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.reasonCategory, "dynamic_content_drift");
  assert.equal(verificationJson.blockingGate, "action_path");
  assert.equal(verificationJson.captureNoiseReviewRequired, true);
  assert.equal(verificationJson.checkpointHint, "capture_noise_review");
  assert.equal(verificationJson.captureNoiseCandidateId, "cn1");
});

test("verify locator fallback surfaces capture_noise_review guidance for hidden layered steps", async () => {
  const runId = `verify-hidden-noise-hint-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "http://127.0.0.1:59999/layered/panel",
    finalUrl: "http://127.0.0.1:59999/layered/final",
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "button",
        text: "Hidden layer A",
        locator: {
          role: "button",
          name: "Hidden layer A",
          structuralKey: "panel>button|role=button||Hidden layer A",
          box: { cx: 0, cy: 0, w: 0, h: 0 }
        },
        transition: {
          refType: "click",
          settleStatus: "interrupted",
          appeared: [],
          disappeared: [],
          changed: []
        },
        visibilityRisk: {
          kind: "hidden-or-layered-target",
          hasVisibleBox: false,
          zeroBox: true,
          visibleTargetDiffers: true,
          visibleSummary: "button Visible proxy [data-testid=\"visible-proxy\"]"
        }
      }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "http://127.0.0.1:59999/layered/final",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: ["goto"],
    stepCount: 2,
    transitionChecks: [],
    resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
    error: "ambiguous locator: low-confidence resolution (winner=0.55 margin=0.00 mass=0.13)"
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.reasonCategory, "locator_drift");
  assert.equal(verificationJson.blockingGate, "locator");
  assert.equal(verificationJson.captureNoiseReviewRequired, true);
  assert.equal(verificationJson.checkpointHint, "capture_noise_review");
});

test("verify locator fallback surfaces capture_noise_review guidance for observation no-op container steps", async () => {
  const runId = `verify-observation-noise-hint-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "http://127.0.0.1:59999/observation/start",
    finalUrl: "http://127.0.0.1:59999/observation/final",
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "#content",
        text: "Forecast content panel",
        actionKind: "observation",
        locator: {
          role: "main",
          name: "Forecast content panel",
          structuralKey: "body>main|main|role=main|content|Forecast content panel",
          cleanId: "content",
          box: { cx: 600, cy: 500, w: 1200, h: 900 }
        },
        observedTextSummary: "Sunrise 05:15 Sunset 19:44",
        transition: {
          refType: "click",
          settleStatus: "settled",
          appeared: [],
          disappeared: [],
          changed: []
        }
      }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "http://127.0.0.1:59999/observation/final",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: ["goto"],
    stepCount: 2,
    transitionChecks: [],
    resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
    error: "ambiguous locator: low-confidence resolution (winner=0.61 margin=0.49 mass=0.54)"
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.reasonCategory, "locator_drift");
  assert.equal(verificationJson.blockingGate, "locator");
  assert.equal(verificationJson.captureNoiseReviewRequired, true);
  assert.equal(verificationJson.checkpointHint, "capture_noise_review");
  assert.equal(verificationJson.candidateKind, "ambiguous-observation-click");
});

test("verify locator fallback surfaces capture_noise_review guidance for implementation-layer steps", async () => {
  const runId = `verify-implementation-layer-noise-hint-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow,
    id: runId,
    fixture: "manual",
    startUrl: "http://127.0.0.1:59999/layered/panel",
    finalUrl: "http://127.0.0.1:59999/layered/final",
    steps: [
      { action: "goto" },
      {
        action: "click",
        selector: "button",
        text: "Internal timeline",
        actionKind: "implementation-layer",
        isTrusted: false,
        locator: {
          role: "button",
          name: "Internal timeline",
          structuralKey: "panel>button|role=button||Internal timeline",
          box: { cx: 320, cy: 220, w: 96, h: 36 }
        },
        transition: {
          refType: "click",
          settleStatus: "interrupted",
          appeared: [],
          disappeared: [],
          changed: []
        },
        replayRisk: {
          kind: "reviewed-implementation-layer",
          actionKind: "implementation-layer",
          isTrusted: false,
          settleStatus: "interrupted"
        }
      }
    ],
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false },
    verification: {
      expectedFinalUrl: "http://127.0.0.1:59999/layered/final",
      expectedNetwork: null,
      expectedEvidence: null
    }
  });
  writeText(runPaths.runnerPath, `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = {
    success: false,
    pathComplete: false,
    executedSteps: ["goto"],
    stepCount: 2,
    transitionChecks: [],
    resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
    error: "ambiguous locator: low-confidence resolution (winner=0.40 margin=0.35 mass=0.00)"
  };
  writeFileSync(${JSON.stringify(runPaths.verificationPath)}, JSON.stringify(report, null, 2) + "\\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\\n");
  process.exit(0);
}
`);

  await verifyRun(runId, { headless: true });
  const verificationJson = JSON.parse(readFileSync(runPaths.verificationPath, "utf8"));

  assert.equal(verificationJson.reasonCategory, "locator_drift");
  assert.equal(verificationJson.blockingGate, "locator");
  assert.equal(verificationJson.captureNoiseReviewRequired, true);
  assert.equal(verificationJson.checkpointHint, "capture_noise_review");
  assert.equal(verificationJson.candidateKind, "ambiguous-implementation-layer-click");
});
