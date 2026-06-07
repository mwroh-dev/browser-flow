import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { SCHEMA_VERSIONS, assertSchemaVersion } from "../../scripts/lib/schema-versions.mjs";
import { compileRun } from "../../scripts/analyze/compile.mjs";
import { scanArtifacts } from "../../scripts/security/scan-artifacts.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";

// Per orchestrator-gated-context-distribution Known Limit: every
// result artifact must declare schemaVersion so downstream consumers
// can detect silent schema drift. This test pins the contract.

test("compiled workflow + path.yaml + recipe.yaml carry schemaVersion", () => {
  const runId = `schema-version-compile-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);

  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "synthetic",
    startUrl: "http://127.0.0.1:59999/synthetic"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic", text: "Synthetic Demo", timestamp: 900 },
    { type: "input", selector: "[data-bf=\"name-input\"]", value: "Codex", secret: false, timestamp: 950 },
    { type: "click", selector: "[data-bf=\"launch\"]", text: "Run Demo", timestamp: 1000 },
    { type: "navigate", url: "http://127.0.0.1:59999/synthetic/result?name=Codex", text: "Synthetic Result", timestamp: 1010 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "http://127.0.0.1:59999/api/complete?mode=synthetic", method: "POST", status: 200, timestamp: 1005 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "[data-bf-evidence=\"result\"]", text: "Workflow Complete", url: "http://127.0.0.1:59999/synthetic/result?name=Codex" }
  ]);

  const workflow = compileRun(runId);
  const workflowJson = JSON.parse(readFileSync(runPaths.workflowJsonPath, "utf8"));
  const pathYamlText = readFileSync(runPaths.pathYamlPath, "utf8");
  const recipeYamlText = readFileSync(runPaths.recipeYamlPath, "utf8");

  assert.equal(workflow.schemaVersion, SCHEMA_VERSIONS.workflow);
  assert.equal(workflowJson.schemaVersion, SCHEMA_VERSIONS.workflow);
  assert.match(pathYamlText, new RegExp(`^schemaVersion: ${SCHEMA_VERSIONS.pathYaml}\\b`, "m"));
  assert.match(recipeYamlText, new RegExp(`^schemaVersion: ${SCHEMA_VERSIONS.recipeYaml}\\b`, "m"));
});

test("security report carries schemaVersion", () => {
  const root = join(tmpdir(), `bf-schema-security-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(join(root, "ok.txt"), "harmless content");
    const outputPath = join(root, "security.json");

    const report = scanArtifacts(root, outputPath);
    const persisted = JSON.parse(readFileSync(outputPath, "utf8"));

    assert.equal(report.schemaVersion, SCHEMA_VERSIONS.security);
    assert.equal(persisted.schemaVersion, SCHEMA_VERSIONS.security);
    assert.equal(report.ok, true);
  } finally {
    // Clean up the per-test fixture even when the assertions throw,
    // so /tmp does not accumulate one bf-schema-security-* dir per failed run.
    rmSync(root, { recursive: true, force: true });
  }
});

// Reader-side schemaVersion guard. Pattern: inline version guard
// (microservice-api-patterns SemanticVersioning; Pact spec version
// assertion at read site). Wrong version must hard-throw.

test("assertSchemaVersion accepts the current version", () => {
  assert.doesNotThrow(() =>
    assertSchemaVersion({ schemaVersion: 1 }, "workflow", "workflow.json")
  );
  assert.doesNotThrow(() =>
    assertSchemaVersion({ schemaVersion: 1 }, "verification", "verification.json")
  );
});

test("assertSchemaVersion throws on missing schemaVersion", () => {
  assert.throws(
    () => assertSchemaVersion({ id: "x" }, "workflow", "workflow.json"),
    /missing schemaVersion/
  );
});

test("assertSchemaVersion throws on unaccepted version", () => {
  assert.throws(
    () => assertSchemaVersion({ schemaVersion: 99 }, "workflow", "workflow.json"),
    /schemaVersion 99 not in accepted set/
  );
});

test("assertSchemaVersion throws on unknown artifact kind", () => {
  assert.throws(
    () => assertSchemaVersion({ schemaVersion: 1 }, /** @type {any} */ ("bogus"), "x"),
    /Unknown artifact kind/
  );
});

test("generateRunner refuses a workflow.json with wrong schemaVersion", () => {
  const runId = `schema-guard-generate-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 99,
    id: runId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [],
    verification: {},
    security: { localOnly: true }
  });
  // Zod discriminated union rejects unknown schemaVersion
  // with "Invalid discriminator value" error message.
  assert.throws(
    () => generateRunner(runId),
    /Invalid (discriminator value|option)/
  );
});

test("parseWorkflowArtifact rejects missing required fields", async () => {
  const { parseWorkflowArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseWorkflowArtifact(
      { schemaVersion: 1, id: "x" /* missing fixture, startUrl, finalUrl, steps, verification, security */ },
      "synthetic.json"
    ),
    /failed schema validation/
  );
});

test("parseWorkflowArtifact rejects wrong field types", async () => {
  const { parseWorkflowArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseWorkflowArtifact(
      {
        schemaVersion: 1,
        id: "x",
        fixture: "synthetic",
        startUrl: "/x",
        finalUrl: "/x",
        steps: "not-an-array",
        verification: {},
        security: { localOnly: true }
      },
      "synthetic.json"
    ),
    /failed schema validation/
  );
});

test("WorkflowArtifact accepts explicit installScope and external targetScope", async () => {
  const { parseWorkflowArtifact } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseWorkflowArtifact({
    schemaVersion: 1,
    id: "external-workflow",
    fixture: "manual",
    startUrl: "https://example.com",
    finalUrl: "https://example.com/done",
    steps: [{ action: "goto", url: "https://example.com" }],
    verification: { expectedFinalUrl: "https://example.com/done" },
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  }, "workflow.json");

  assert.equal(parsed.security.installScope, "project-local");
  assert.equal(parsed.security.targetScope, "external");
});

// VerificationArtifact discriminated union — same pattern as workflow,
// validates the shape that verify-run.mjs writes.

test("parseVerificationArtifact accepts a well-formed verification report", async () => {
  const { parseVerificationArtifact } = await import("../../scripts/lib/schemas.mjs");
  const report = {
    schemaVersion: 1,
    success: false,
    pathComplete: false,
    executedSteps: ["goto", "click"],
    stepCount: 2,
    transitionChecks: [{ name: "final-url", expected: "/x", actual: "/x", passed: true }],
    proofChecks: [
      { kind: "final-url", name: "final-url", expected: "/x", actual: "/x", passed: true },
      {
        kind: "url-state",
        name: "url-state",
        expected: { params: [{ key: "mode", value: "rain" }] },
        actual: { params: [{ key: "mode", value: "rain" }] },
        passed: true
      }
    ],
    resultEvidence: { passed: false, selector: "[data-bf=ok]", actualText: "Done", expectedText: "Done" },
    verificationOutcome: "not_verified",
    reasonCategory: "dynamic_content_drift",
    blockingGate: "action_path",
    userFault: false,
    diagnosticMode: true,
    replayOutcome: "held",
    promotionOutcome: "not_promoted",
    promotionBlockers: [{ gate: "replay", reason: "replay_hold" }],
    securityScanOk: true,
    securityPromotionClean: false,
    securityOk: false,
    verifiedAt: "2026-05-19T01:00:00.000Z"
  };
  const parsed = parseVerificationArtifact(report, "verification.json");
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.success, false);
  assert.equal(parsed.verificationOutcome, "not_verified");
  assert.equal(parsed.proofChecks?.[1]?.kind, "url-state");
  assert.equal(parsed.reasonCategory, "dynamic_content_drift");
  assert.equal(parsed.blockingGate, "action_path");
  assert.equal(parsed.userFault, false);
  assert.equal(parsed.diagnosticMode, true);
  assert.equal(parsed.replayOutcome, "held");
  assert.equal(parsed.promotionOutcome, "not_promoted");
  const promotionBlockers = parsed.promotionBlockers ?? [];
  assert.equal(promotionBlockers[0]?.gate, "replay");
  assert.equal(parsed.securityScanOk, true);
  assert.equal(parsed.securityPromotionClean, false);
});

test("parseVerificationArtifact accepts optional external promotion candidate", async () => {
  const { parseVerificationArtifact } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseVerificationArtifact(
    {
      schemaVersion: 1,
      success: true,
      pathComplete: true,
      executedSteps: [],
      stepCount: 0,
      transitionChecks: [],
      replayOutcome: "passed",
      promotionOutcome: "not_promoted",
      promotionBlockers: [{ gate: "registry", reason: "external_requires_operator_approval" }],
      promotionCandidate: { scope: "external", status: "external_replay_candidate" },
      securityScanOk: true,
      securityPromotionClean: true,
      securityOk: true,
      verifiedAt: "2026-05-19T01:00:00.000Z"
    },
    "verification.json"
  );

  assert.equal(parsed.promotionCandidate?.scope, "external");
});

test("parseVerificationArtifact rejects malformed structured verification outcome fields", async () => {
  const { parseVerificationArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseVerificationArtifact(
      {
        schemaVersion: 1,
        success: false,
        pathComplete: false,
        executedSteps: [],
        stepCount: 0,
        transitionChecks: [],
        verificationOutcome: "drifted",
        reasonCategory: "bad_reason",
        blockingGate: "bad_gate",
        userFault: "nope",
        diagnosticMode: "yes",
        replayOutcome: "maybe",
        promotionOutcome: "done",
        promotionBlockers: [{ gate: "unknown", reason: "" }],
        securityScanOk: "ok",
        securityPromotionClean: "clean",
        securityOk: false,
        verifiedAt: "2026-05-19T01:00:00.000Z"
      },
      "verification.json"
    ),
    /failed schema validation/
  );
});

test("parseVerificationArtifact rejects malformed replay and promotion outcome fields", async () => {
  const { parseVerificationArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseVerificationArtifact(
      {
        schemaVersion: 1,
        success: true,
        pathComplete: true,
        executedSteps: [],
        stepCount: 0,
        transitionChecks: [],
        replayOutcome: "maybe",
        promotionOutcome: "done",
        promotionBlockers: [{ gate: "unknown", reason: "" }],
        securityScanOk: "ok",
        securityPromotionClean: "clean",
        securityOk: true,
        verifiedAt: "2026-05-19T01:00:00.000Z"
      },
      "verification.json"
    ),
    /failed schema validation/
  );
});

test("parseVerificationArtifact rejects malformed external promotion candidate", async () => {
  const { parseVerificationArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseVerificationArtifact(
      {
        schemaVersion: 1,
        success: true,
        pathComplete: true,
        executedSteps: [],
        stepCount: 0,
        transitionChecks: [],
        replayOutcome: "passed",
        promotionOutcome: "not_promoted",
        promotionBlockers: [{ gate: "registry", reason: "external_requires_operator_approval" }],
        promotionCandidate: { scope: "local", status: "ready" },
        securityScanOk: true,
        securityPromotionClean: true,
        securityOk: true,
        verifiedAt: "2026-05-19T01:00:00.000Z"
      },
      "verification.json"
    ),
    /failed schema validation/
  );
});

test("parseVerificationArtifact rejects missing required fields", async () => {
  const { parseVerificationArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseVerificationArtifact(
      { schemaVersion: 1, success: true /* missing pathComplete, executedSteps, etc. */ },
      "verification.json"
    ),
    /failed schema validation/
  );
});

test("parseVerificationArtifact rejects wrong discriminator", async () => {
  const { parseVerificationArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseVerificationArtifact(
      { schemaVersion: 2, success: true, pathComplete: true, executedSteps: [], stepCount: 0, transitionChecks: [], securityOk: true, verifiedAt: "x" },
      "verification.json"
    ),
    /Invalid (discriminator value|option)/
  );
});

// SecurityArtifact discriminated union — validates the shape that
// scan-artifacts.mjs writes.

test("parseSecurityArtifact accepts a clean security report", async () => {
  const { parseSecurityArtifact } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseSecurityArtifact(
    { schemaVersion: 1, ok: true, findings: [] },
    "security.json"
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.findings.length, 0);
});

test("parseSecurityArtifact accepts a report with findings", async () => {
  const { parseSecurityArtifact } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseSecurityArtifact(
    {
      schemaVersion: 1,
      ok: false,
      findings: [
        { file: "runner.mjs", reason: "secret header name", match: "<redacted:authorization>" }
      ]
    },
    "security.json"
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.findings.length, 1);
});

test("parseSecurityArtifact rejects malformed finding", async () => {
  const { parseSecurityArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseSecurityArtifact(
      { schemaVersion: 1, ok: false, findings: [{ file: "x" /* missing reason, match */ }] },
      "security.json"
    ),
    /failed schema validation/
  );
});

// PathYamlArtifact — pre-serialization object form, validated at write
// time inside compile.mjs.

test("parsePathYamlArtifact accepts a well-formed path doc", async () => {
  const { parsePathYamlArtifact } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parsePathYamlArtifact(
    {
      schemaVersion: 1,
      id: "synth-1",
      fixture: "synthetic",
      startUrl: "/synthetic",
      finalUrl: "/synthetic/result",
      steps: [{ action: "goto", url: "/synthetic" }],
      verification: { expectedFinalUrl: "/synthetic/result" }
    },
    "path.yaml"
  );
  assert.equal(parsed.id, "synth-1");
});

test("parsePathYamlArtifact rejects missing id", async () => {
  const { parsePathYamlArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parsePathYamlArtifact(
      {
        schemaVersion: 1,
        fixture: "synthetic",
        startUrl: "/x",
        finalUrl: "/x",
        steps: [],
        verification: {}
      },
      "path.yaml"
    ),
    /failed schema validation/
  );
});

// RecipeYamlArtifact — recipe.yaml shape with literal truthy
// constraints on localOnly + freshProfile + requires* fields.
// These literals encode policy: a recipe.yaml that flips localOnly
// to false would silently allow non-local replay; the schema makes
// that flip impossible at write time.

test("parseRecipeYamlArtifact accepts a well-formed recipe", async () => {
  const { parseRecipeYamlArtifact } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseRecipeYamlArtifact(
    {
      schemaVersion: 1,
      id: "synth-1",
      fixture: "synthetic",
      localOnly: true,
      artifacts: { path: "x", recipe: "x", runner: "x" },
      verification: {
        freshProfile: true,
        requiresActionPath: true,
        requiresTransition: true,
        requiresEvidence: true
      },
      security: { localOnly: true }
    },
    "recipe.yaml"
  );
  assert.equal(parsed.localOnly, true);
});

test("parseRecipeYamlArtifact rejects localOnly: false", async () => {
  const { parseRecipeYamlArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseRecipeYamlArtifact(
      {
        schemaVersion: 1,
        id: "synth-1",
        fixture: "synthetic",
        localOnly: false,
        artifacts: { path: "x", recipe: "x", runner: "x" },
        verification: {
          freshProfile: true,
          requiresActionPath: true,
          requiresTransition: true,
          requiresEvidence: true
        },
        security: { localOnly: true }
      },
      "recipe.yaml"
    ),
    /failed schema validation/
  );
});

test("parseRecipeYamlArtifact rejects freshProfile: false", async () => {
  const { parseRecipeYamlArtifact } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseRecipeYamlArtifact(
      {
        schemaVersion: 1,
        id: "synth-1",
        fixture: "synthetic",
        localOnly: true,
        artifacts: { path: "x", recipe: "x", runner: "x" },
        verification: {
          freshProfile: false,
          requiresActionPath: true,
          requiresTransition: true,
          requiresEvidence: true
        },
        security: { localOnly: true }
      },
      "recipe.yaml"
    ),
    /failed schema validation/
  );
});

// OpenAiAgentDef — discriminated union over role_type. Closes the
// last phrase-grep holdout in validate-skill.mjs by replacing
// substring key checks with parsed-YAML + Zod parse.

test("parseOpenAiAgentDef accepts a well-formed entry agent", async () => {
  const { parseOpenAiAgentDef } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseOpenAiAgentDef(
    {
      name: "orchestrator",
      role_type: "entry",
      description: "Entry-point orchestrator.",
      entrypoint: "SKILL.md",
      requires_verification: true,
      required_reports: ["artifacts/runs/<id>/reports/verification.json"],
      guardrails: ["Never persist raw secrets."]
    },
    "openai.yaml"
  );
  assert.equal(parsed.role_type, "entry");
});

test("parseDataResult accepts a well-formed data-result report", async () => {
  const { parseDataResult } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseDataResult(
    {
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
      }
    },
    "data-result.json"
  );
  assert.equal(parsed.schemaVersion, SCHEMA_VERSIONS.dataResult);
  assert.equal(parsed.dataOutcome, "data");
  assert.equal(parsed.rowCount, 2);
});

test("parseOpenAiAgentDef accepts a well-formed phase agent", async () => {
  const { parseOpenAiAgentDef } = await import("../../scripts/lib/schemas.mjs");
  const parsed = parseOpenAiAgentDef(
    {
      name: "capture",
      role_type: "phase",
      phase: "capture",
      description: "Capture specialist.",
      inputs: ["run-id"],
      outputs: ["events"],
      guardrails: ["Local-only."]
    },
    "openai.yaml"
  );
  assert.equal(parsed.role_type, "phase");
});

test("parseOpenAiAgentDef rejects phase agent missing inputs", async () => {
  const { parseOpenAiAgentDef } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseOpenAiAgentDef(
      {
        name: "x",
        role_type: "phase",
        phase: "x",
        description: "x",
        outputs: ["y"],
        guardrails: ["z"]
      },
      "openai.yaml"
    ),
    /failed schema validation/
  );
});

test("parseOpenAiAgentDef rejects unknown role_type", async () => {
  const { parseOpenAiAgentDef } = await import("../../scripts/lib/schemas.mjs");
  assert.throws(
    () => parseOpenAiAgentDef(
      { name: "x", role_type: "bogus", description: "x", guardrails: ["z"] },
      "openai.yaml"
    ),
    /Invalid (discriminator value|option)/
  );
});
