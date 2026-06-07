// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { getPaths, getRunPaths, ensureRunDirs } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { appendEntry } from "../../scripts/lib/state-journal.mjs";
import { cleanupCommand } from "../../scripts/commands/cleanup.mjs";
import { composeCommand } from "../../scripts/commands/compose.mjs";
import { doctorCommand } from "../../scripts/commands/doctor.mjs";
import { promoteCommand } from "../../scripts/commands/promote.mjs";
import { runCommand } from "../../scripts/commands/run.mjs";
import { buildCommandSchema } from "../../scripts/lib/cli-metadata.mjs";
import { readRegistry } from "../../scripts/registry/workflow-registry.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/**
 * @param {string} runId
 */
function writeBindableRun(runId) {
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, { runId, fixture: "synthetic", startUrl: "/x" });
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 1,
    id: runId,
    fixture: "synthetic",
    startUrl: "/x",
    finalUrl: "/x",
    steps: [
      { action: "goto", url: "/x", pageKey: "synthetic/x" },
      { action: "fill", selector: "#i", fieldName: "i", value: "", secret: false, pageKey: "synthetic/x", valueRef: "{{input.foo}}" }
    ],
    inputs: [{ name: "foo", type: "text" }],
    verification: {
      expectedFinalUrl: "/x",
      expectedNetwork: { url: "/api/x", method: "POST", status: 200 },
      expectedEvidence: { selector: "h1", textIncludes: "x" }
    },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });
  return runPaths;
}

/**
 * @param {string} runId
 */
function writeExternalRun(runId) {
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
    replayOutcome: "passed",
    promotionOutcome: "not_promoted",
    securityOk: true,
    verifiedAt: new Date().toISOString()
  }));
  writeFileSync(runPaths.securityPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.security,
    ok: true,
    warningOnly: false,
    findings: []
  }));
  return runPaths;
}

test("runCommand --dry-run previews derived artifacts without writing them", () => {
  const sourceRunId = `dry-run-source-${Date.now()}`;
  writeBindableRun(sourceRunId);

  const result = runCommand(
    { "run-id": sourceRunId, "dry-run": true },
    ["node", "bf", "run", "--run-id", sourceRunId, "--bind", "input.foo=A"]
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.sourceRunId, sourceRunId);
  assert.equal(result.bindings.foo, "A");
  const newPaths = getRunPaths(result.newRunId);
  assert.equal(existsSync(newPaths.runRoot), false);
  assert.equal(result.wouldWrite.includes(newPaths.workflowJsonPath), true);
  assert.equal(result.wouldWrite.includes(newPaths.runnerPath), true);
});

test("promoteCommand --dry-run validates gates without mutating the registry", () => {
  const runId = `dry-promote-${Date.now()}`;
  writeExternalRun(runId);

  const before = readRegistry().filter((entry) => entry.id === runId);
  const result = promoteCommand({
    "run-id": runId,
    scope: "external",
    origins: "https://www.notion.so",
    "auth-mode": "login-required",
    "profile-mode": "ephemeral",
    "privacy-level": "minimal",
    screenshots: "off",
    "data-mode": "route",
    "dry-run": true
  });
  const after = readRegistry().filter((entry) => entry.id === runId);

  assert.deepEqual(before, []);
  assert.deepEqual(after, []);
  assert.equal(result.dryRun, true);
  assert.equal(result.registryMutation, "required-upsert");
  assert.equal(result.wouldWrite.includes(getPaths().registryPath), true);
});

test("cleanupCommand --dry-run reports dangling artifacts without executing cleanup", async () => {
  const runId = `dry-cleanup-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  appendEntry(runPaths.journalPath, {
    segmentIndex: 0,
    status: "in-progress",
    created: ["artifact-alpha"]
  });

  const result = await cleanupCommand({ "run-id": runId, "dry-run": true });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.dangling, ["artifact-alpha"]);
  assert.equal(result.wouldRun, false);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.errors, []);
});

test("composeCommand --dry-run previews selection without creating a derived run", async () => {
  const sourceRunId = `dry-compose-${Date.now()}`;
  writeBindableRun(sourceRunId);
  let learnCalls = 0;
  let generateCalls = 0;
  let verifyCalls = 0;

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is", "dry-run": true },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "x", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: {},
        notes: []
      }),
      learnGap: async () => {
        learnCalls += 1;
        return { status: "not-needed", learnedSteps: [] };
      },
      generateDerived: async () => {
        generateCalls += 1;
        return { runnerPath: "/tmp/runner.mjs" };
      },
      verifyDerived: async () => {
        verifyCalls += 1;
        return { ok: true, verification: { success: true }, security: { ok: true } };
      }
    }
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.sourceRunId, sourceRunId);
  assert.equal(result.planned.selectedStepCount, 2);
  assert.equal(result.planned.learningNeeded, false);
  assert.equal(existsSync(getRunPaths(result.derivedRunId).runRoot), false);
  assert.equal(learnCalls, 0);
  assert.equal(generateCalls, 0);
  assert.equal(verifyCalls, 0);
});

test("doctorCommand reports preflight checks alongside page-node diagnostics", () => {
  const report = doctorCommand({});
  const checks = new Map(report.preflight.checks.map((entry) => [entry.name, entry]));

  assert.equal(typeof report.preflight.ok, "boolean");
  assert.equal(checks.has("node"), true);
  assert.equal(checks.has("npm"), true);
  assert.equal(checks.has("runtimeDependencies"), true);
  assert.equal(checks.has("artifactDirectories"), true);
  assert.equal(checks.has("registry"), true);
  assert.equal(checks.has("securityBaseline"), true);
});

test("command schema exposes dry-run and doctor preflight contract", () => {
  for (const name of ["run", "promote", "cleanup", "compose"]) {
    const schema = buildCommandSchema(name);
    assert.ok(schema);
    assert.equal(schema.command.options.some((option) => option.name === "--dry-run" && option.required === false), true, `${name} should expose --dry-run`);
    assert.match(schema.command.sideEffects.join("\n"), /dry-run/i);
  }

  const doctor = buildCommandSchema("doctor");
  assert.ok(doctor);
  assert.equal(doctor.command.options.some((option) => option.name === "--chrome-path" && option.value === "path"), true);
  assert.match(doctor.command.description, /preflight/i);
});
