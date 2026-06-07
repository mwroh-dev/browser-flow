import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { readJson, writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

test("getRunPaths exposes compose artifact paths and ensureRunDirs creates composeDir", () => {
  const runId = `compose-paths-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  assert.equal(basename(runPaths.composeDir), "compose");
  assert.equal(dirname(runPaths.composeDir), runPaths.runRoot);
  assert.equal(runPaths.composeRequestPath, `${runPaths.composeDir}/compose-request.json`);
  assert.equal(runPaths.composePlanPath, `${runPaths.composeDir}/compose-plan.json`);
  assert.equal(runPaths.composeSessionPath, `${runPaths.composeDir}/compose-session.json`);
  assert.equal(runPaths.composeJournalPath, `${runPaths.composeDir}/compose-journal.jsonl`);
  assert.equal(runPaths.composeSummaryPath, `${runPaths.reportsDir}/compose-summary.json`);
  assert.equal(existsSync(runPaths.composeDir), true);
});

test("composeCommand rejects missing required options", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");

  await assert.rejects(() => composeCommand({}), /bf compose requires --run-id/);
  await assert.rejects(
    () => composeCommand({ "run-id": `compose-validation-${Date.now()}` }),
    /bf compose requires --request/
  );
});

test("composeCommand writes a derived run for reuse-only composition", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-source-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic"
  });
  const sourceWorkflow = {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [
      { action: "goto", url: "/synthetic", pageKey: "synthetic/root" },
      { action: "click", selector: "[data-bf=\"run\"]", pageKey: "synthetic/root" }
    ],
    segments: [{ range: [0, 1], startPageKey: "synthetic/root", endPageKey: "synthetic/root", name: "root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  };
  writeJson(sourcePaths.workflowJsonPath, sourceWorkflow);

  let learnGapCalls = 0;
  let verifyDerivedCalls = 0;
  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: {},
        notes: []
      }),
      learnGap: async () => {
        learnGapCalls += 1;
        return { status: "not-needed", learnedSteps: [] };
      },
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => {
        verifyDerivedCalls += 1;
        return { ok: true, verification: { success: true }, security: { ok: true } };
      }
    }
  );

  const derivedPaths = getRunPaths(result.derivedRunId);
  const derivedWorkflow = readJson(result.derivedWorkflowPath);
  const composeSummary = readJson(result.composeSummaryPath);

  assert.equal(result.ok, true);
  assert.equal(result.derivedWorkflowPath, derivedPaths.workflowJsonPath);
  assert.equal(result.composeSummaryPath, derivedPaths.composeSummaryPath);
  assert.match(result.derivedRunId, /^compose-[A-Za-z0-9._-]+$/);
  assert.equal(derivedWorkflow.id, result.derivedRunId);
  assert.equal(derivedWorkflow.primaryRunId, sourceRunId);
  assert.deepEqual(derivedWorkflow.sourceRuns, [sourceRunId]);
  assert.deepEqual(derivedWorkflow.steps, sourceWorkflow.steps);
  assert.deepEqual(readJson(sourcePaths.workflowJsonPath), sourceWorkflow);
  assert.equal(existsSync(derivedPaths.composeRequestPath), true);
  assert.equal(existsSync(derivedPaths.composePlanPath), true);
  assert.equal(existsSync(derivedPaths.composeSessionPath), true);
  assert.equal(existsSync(derivedPaths.composeSummaryPath), true);
  assert.equal(existsSync(derivedPaths.verificationPath), false);
  assert.equal(existsSync(derivedPaths.securityPath), false);
  assert.equal(composeSummary.primaryRunId, sourceRunId);
  assert.deepEqual(composeSummary.sourceRuns, [sourceRunId]);
  assert.equal(composeSummary.status, "composed");
  assert.equal(composeSummary.blockedReason, "none");
  assert.equal(learnGapCalls, 0);
  assert.equal(verifyDerivedCalls, 1);
});

test("composeCommand drops the last segment when the request asks to omit one item", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-omit-last-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "manual",
    startUrl: "https://example.com/start",
    finalUrl: "https://example.com/final",
    steps: [
      { action: "goto", url: "https://example.com/start", pageKey: "manual/example.com/start" },
      { action: "click", href: "https://example.com/one", text: "one", pageKey: "manual/example.com/start" },
      { action: "click", href: "https://example.com/two", text: "two", pageKey: "manual/example.com/one" },
      { action: "click", href: "https://example.com/three", text: "three", pageKey: "manual/example.com/start" }
    ],
    segments: [
      {
        range: [0, 1],
        startPageKey: "manual/example.com/start",
        endPageKey: "manual/example.com/start"
      },
      {
        range: [2, 2],
        startPageKey: "manual/example.com/one",
        endPageKey: "manual/example.com/one"
      },
      {
        range: [3, 3],
        startPageKey: "manual/example.com/start",
        endPageKey: "manual/example.com/start"
      }
    ],
    verification: {
      expectedFinalUrl: "https://example.com/final",
      expectedNetwork: { url: "https://example.com/final", method: "GET", status: 200 }
    },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "마지막 1개를 빼고 다시 구성해" },
    {
      learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({ ok: true, verification: { success: true }, security: { ok: true } })
    }
  );

  const derivedWorkflow = readJson(result.derivedWorkflowPath);
  const composeSummary = readJson(result.composeSummaryPath);

  assert.equal(result.ok, true);
  assert.deepEqual(derivedWorkflow.steps.map((step) => step.text ?? step.url ?? step.href), [
    "https://example.com/start",
    "one",
    "two"
  ]);
  assert.deepEqual(derivedWorkflow.segments, [
    {
      range: [0, 1],
      startPageKey: "manual/example.com/start",
      endPageKey: "manual/example.com/start"
    },
    {
      range: [2, 2],
      startPageKey: "manual/example.com/one",
      endPageKey: "manual/example.com/one"
    }
  ]);
  assert.equal(derivedWorkflow.finalUrl, "https://example.com/two");
  assert.equal(derivedWorkflow.verification.expectedFinalUrl, "https://example.com/two");
  assert.equal(derivedWorkflow.verification.expectedNetwork.url, "https://example.com/two");
  assert.deepEqual(composeSummary.reusedSegments, [0, 1]);
});

test("composeCommand appends learned fill and submit steps when bridging a learning gap", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-learn-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic/signup"
  });
  const sourceWorkflow = {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic/signup",
    finalUrl: "/synthetic/review",
    steps: [
      { action: "goto", url: "/synthetic/signup", pageKey: "synthetic/signup" },
      { action: "click", selector: "[data-bf=\"start\"]", pageKey: "synthetic/signup" }
    ],
    segments: [{ range: [0, 1], startPageKey: "synthetic/signup", endPageKey: "synthetic/form", name: "start" }],
    verification: { expectedFinalUrl: "/synthetic/review" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  };
  writeJson(sourcePaths.workflowJsonPath, sourceWorkflow);

  const learnedSteps = [
    { action: "fill", selector: "[name=\"email\"]", value: "person@example.test", pageKey: "synthetic/form" },
    { action: "submit", selector: "form", pageKey: "synthetic/form" }
  ];
  let learnGapInput;
  const result = await composeCommand(
    { "run-id": sourceRunId, request: "complete signup before review" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "review", mustKeep: ["start"], maySkip: [], requiresData: false },
        candidateHints: { stopAfterSegment: 0 },
        notes: ["Learn the missing form bridge."]
      }),
      learnGap: async (input) => {
        learnGapInput = input;
        return { status: "resolved", reconnectPageKey: "synthetic/review", learnedSteps };
      },
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({ ok: true, verification: { success: true }, security: { ok: true } })
    }
  );

  const derivedPaths = getRunPaths(result.derivedRunId);
  const derivedWorkflow = readJson(result.derivedWorkflowPath);
  const journalEntries = readFileSync(derivedPaths.composeJournalPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(result.ok, true);
  assert.equal(learnGapInput.request, "complete signup before review");
  assert.deepEqual(learnGapInput.decision.candidateHints, { stopAfterSegment: 0 });
  assert.deepEqual(learnGapInput.sourceWorkflow, sourceWorkflow);
  assert.equal(learnGapInput.composePaths.composeJournalPath, derivedPaths.composeJournalPath);
  assert.deepEqual(derivedWorkflow.steps.slice(-2), learnedSteps);
  assert.deepEqual(journalEntries.map((entry) => entry.step.action), ["fill", "submit"]);
  assert.deepEqual(journalEntries.map((entry) => entry.step), learnedSteps);
});

test("composeCommand writes a broken learning checkpoint when learning is blocked", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-blocked-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic/signup"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic/signup",
    finalUrl: "/synthetic/review",
    steps: [{ action: "goto", url: "/synthetic/signup", pageKey: "synthetic/signup" }],
    verification: { expectedFinalUrl: "/synthetic/review" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "complete signup before review" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "review", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: { stopAfterSegment: 0 },
        notes: []
      }),
      learnGap: async () => ({ status: "blocked", blockedReason: "unexpected_reason", learnedSteps: [] }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({ ok: true, verification: { success: true }, security: { ok: true } })
    }
  );

  const derivedPaths = getRunPaths(result.derivedRunId);

  assert.deepEqual(result, {
    ok: false,
    blockedReason: "unreachable_goal",
    derivedRunId: result.derivedRunId
  });
  assert.equal(existsSync(derivedPaths.workflowJsonPath), false);
  assert.deepEqual(readJson(derivedPaths.composeSessionPath), {
    checkpoint: "learning_gap_resolved",
    status: "broken",
    blockedReason: "unreachable_goal"
  });
  assert.equal(readJson(derivedPaths.composeSummaryPath).status, "broken");
  assert.equal(readJson(derivedPaths.composeSummaryPath).blockedReason, "unreachable_goal");
});

test("composeCommand policy-blocks irreversible injected learned steps before journaling", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-policy-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic/settings"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic/settings",
    finalUrl: "/synthetic/settings",
    steps: [{ action: "goto", url: "/synthetic/settings", pageKey: "synthetic/settings" }],
    verification: { expectedFinalUrl: "/synthetic/settings" },
    security: { localOnly: false, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "inspect settings" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "settings", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: { stopAfterSegment: 0 },
        notes: []
      }),
      learnGap: async () => ({
        status: "resolved",
        reconnectPageKey: "synthetic/settings",
        learnedSteps: [{ action: "click", text: "Delete project", selector: "[data-danger]", pageKey: "synthetic/settings" }]
      }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({ ok: true, verification: { success: true }, security: { ok: true } })
    }
  );

  const derivedPaths = getRunPaths(result.derivedRunId);
  const composeSummary = readJson(derivedPaths.composeSummaryPath);

  assert.deepEqual(result, {
    ok: false,
    blockedReason: "policy_blocked",
    derivedRunId: result.derivedRunId
  });
  assert.equal(existsSync(derivedPaths.workflowJsonPath), false);
  assert.equal(existsSync(derivedPaths.composeJournalPath), false);
  assert.equal(composeSummary.status, "broken");
  assert.equal(composeSummary.blockedReason, "policy_blocked");
});

test("composeCommand creates a fresh derived run for repeated compose calls", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-repeat-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto", url: "/synthetic", pageKey: "synthetic/root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const deps = {
    decide: async () => ({
      schemaVersion: 1,
      requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false },
      candidateHints: {},
      notes: []
    }),
    learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
    generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
    verifyDerived: async () => ({ ok: true, verification: { success: true }, security: { ok: true } })
  };

  const first = await composeCommand({ "run-id": sourceRunId, request: "reuse the flow as-is" }, deps);
  const second = await composeCommand({ "run-id": sourceRunId, request: "reuse the flow as-is" }, deps);

  assert.notEqual(first.derivedRunId, second.derivedRunId);
  assert.notEqual(first.derivedWorkflowPath, second.derivedWorkflowPath);
  assert.notEqual(dirname(first.derivedWorkflowPath), dirname(second.derivedWorkflowPath));
  assert.equal(readJson(first.derivedWorkflowPath).id, first.derivedRunId);
  assert.equal(readJson(second.derivedWorkflowPath).id, second.derivedRunId);
  assert.equal(existsSync(first.composeSummaryPath), true);
  assert.equal(existsSync(second.composeSummaryPath), true);
});

test("composeCommand derives a validation-safe run id from a long source run id", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `r${"a".repeat(79)}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto", url: "/synthetic", pageKey: "synthetic/root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: {},
        notes: []
      }),
      learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({ ok: true, verification: { success: true }, security: { ok: true } })
    }
  );

  assert.match(result.derivedRunId, /^compose-[A-Za-z0-9._-]+$/);
  assert.ok(result.derivedRunId.length <= 80);
  assert.equal(readJson(result.derivedWorkflowPath).id, result.derivedRunId);
});

test("composeCommand writes broken summary when verification is not green", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-verify-broken-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto", url: "/synthetic", pageKey: "synthetic/root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: {},
        notes: []
      }),
      learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({
        ok: true,
        verification: { success: false, failureReason: "action-path-mismatch" },
        security: { ok: true }
      })
    }
  );

  const summary = readJson(result.composeSummaryPath);

  assert.equal(result.ok, false);
  assert.equal(result.blockedReason, "graph_disconnect");
  assert.equal(summary.status, "broken");
  assert.equal(summary.blockedReason, "graph_disconnect");
});

test("composeCommand writes policy blocked summary when security is not green", async () => {
  const { composeCommand } = await import("../../scripts/commands/compose.mjs");
  const sourceRunId = `compose-security-broken-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, {
    runId: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic"
  });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto", url: "/synthetic", pageKey: "synthetic/root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: {},
        notes: []
      }),
      learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({
        ok: true,
        verification: { success: true },
        security: { ok: false }
      })
    }
  );

  const summary = readJson(result.composeSummaryPath);

  assert.equal(result.ok, false);
  assert.equal(result.blockedReason, "policy_blocked");
  assert.equal(summary.status, "broken");
  assert.equal(summary.blockedReason, "policy_blocked");
});

test("compose artifact schemas parse minimal decision and summary documents", async () => {
  const { parseComposeDecision, parseComposeSummary } = await import("../../scripts/lib/schemas.mjs");

  const decision = parseComposeDecision(
    {
      schemaVersion: SCHEMA_VERSIONS.composeDecision,
      requestIntent: {
        targetState: "data exported",
        mustKeep: ["login", "export"],
        maySkip: ["tour"],
        requiresData: true
      },
      candidateHints: {
        preferredSegments: [1, 3],
        stopAfterSegment: 3
      },
      notes: ["Prefer verified export segment."]
    },
    "compose/decision.json"
  );
  assert.equal(decision.requestIntent.requiresData, true);
  assert.equal(decision.candidateHints.stopAfterSegment, 3);

  const summary = parseComposeSummary(
    {
      schemaVersion: SCHEMA_VERSIONS.composeSummary,
      primaryRunId: "compose-1",
      sourceRuns: ["compose-1", "compose-setup"],
      status: "planned",
      blockedReason: "none"
    },
    "compose/summary.json"
  );
  assert.equal(summary.primaryRunId, "compose-1");
  assert.deepEqual(summary.sourceRuns, ["compose-1", "compose-setup"]);
});
