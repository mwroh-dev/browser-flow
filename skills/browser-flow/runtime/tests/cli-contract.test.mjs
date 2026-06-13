import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { COMMANDS, buildCapabilities, buildCommandSchema, buildSchema, SUPPORT_SCOPE } from "../scripts/lib/cli-metadata.mjs";
import { COMMAND_REGISTRY } from "../scripts/lib/cli-registry.mjs";
import { invalidUsage, missingRequiredOption, classifyCliError, formatHumanCliError, formatJsonCliError } from "../scripts/lib/cli-errors.mjs";
import { withCliNotices } from "../scripts/lib/cli-notices.mjs";

const runtimeRoot = resolve(import.meta.dirname, "..");
const cliEnvRoot = mkdtempSync(resolve(tmpdir(), "bf-cli-env-"));
const ALLOWED_RISKS = new Set(["read", "write", "high-risk-write", "interactive"]);
const ALLOWED_LAYERS = new Set(["setup", "pipeline", "reuse", "review", "promotion", "recovery", "raw-browser"]);

function hasMeaningfulWrittenArtifacts(entry) {
  return entry.writtenArtifacts.some((artifact) => {
    const normalized = artifact.trim().toLowerCase();
    return normalized.length > 0 && normalized !== "none.";
  });
}

function runCli(args) {
  return spawnSync(process.execPath, ["scripts/cli-main.mjs", ...args], {
    cwd: runtimeRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BROWSER_FLOW_REGISTRY_PATH: resolve(cliEnvRoot, "knowledge", "registry", "workflows.json"),
      BROWSER_FLOW_PAGES_PATH: resolve(cliEnvRoot, "knowledge", "pages"),
      BROWSER_FLOW_SCRAPING_PATH: resolve(cliEnvRoot, "knowledge", "scraping"),
      BROWSER_FLOW_SCORING_PATTERNS_PATH: resolve(cliEnvRoot, "knowledge", "scoring-patterns.json"),
      BROWSER_FLOW_VERIFY_SPEC_PATH: resolve(cliEnvRoot, "knowledge", "verify-spec", "override.json")
    }
  });
}

function writeArtifact(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("release unit suite ignores stale e2e entries outside e2e/all suites", () => {
  const root = mkdtempSync(resolve(tmpdir(), "bf-suite-"));
  writeFileSync(resolve(root, "package.json"), "{\"type\":\"module\"}\n");
  writeFileSync(resolve(root, "ok.test.mjs"), "import test from 'node:test'; test('ok', () => {});\n");
  writeFileSync(resolve(root, "e2e-suite.json"), JSON.stringify({ files: ["missing/e2e.test.mjs"] }));

  const script = resolve(runtimeRoot, "scripts/test/run-suite.mjs");
  const unit = spawnSync(process.execPath, [script, "--suite=unit", `--tests-root=${root}`, `--e2e-list=${resolve(root, "e2e-suite.json")}`, "--no-setup"], {
    cwd: runtimeRoot,
    encoding: "utf8"
  });
  assert.equal(unit.status, 0, unit.stderr || unit.stdout);

  const e2e = spawnSync(process.execPath, [script, "--suite=e2e", `--tests-root=${root}`, `--e2e-list=${resolve(root, "e2e-suite.json")}`, "--no-setup"], {
    cwd: runtimeRoot,
    encoding: "utf8"
  });
  assert.equal(e2e.status, 2);
  assert.match(e2e.stderr, /lists missing file/);
});

test("release unit suite structurally quarantines tests/e2e files even when manifest misses them", () => {
  const root = mkdtempSync(resolve(tmpdir(), "bf-suite-e2e-dir-"));
  mkdirSync(resolve(root, "tests", "e2e"), { recursive: true });
  writeFileSync(resolve(root, "package.json"), "{\"type\":\"module\"}\n");
  writeFileSync(resolve(root, "ok.test.mjs"), "import test from 'node:test'; test('ok', () => {});\n");
  writeFileSync(resolve(root, "tests", "e2e", "chrome.test.mjs"), "import test from 'node:test'; test('e2e', () => { throw new Error('should not run in unit'); });\n");
  writeFileSync(resolve(root, "e2e-suite.json"), JSON.stringify({ files: [] }));

  const script = resolve(runtimeRoot, "scripts/test/run-suite.mjs");
  const unit = spawnSync(process.execPath, [script, "--suite=unit", `--tests-root=${root}`, `--e2e-list=${resolve(root, "e2e-suite.json")}`, "--no-setup"], {
    cwd: runtimeRoot,
    encoding: "utf8"
  });
  assert.equal(unit.status, 0, unit.stderr || unit.stdout);
  assert.match(unit.stdout, /unit=1, e2e=1, total=2/);
});

test("command registry and metadata stay in parity", () => {
  const metadataNames = new Set(COMMANDS.map((entry) => entry.name));
  const registryNames = new Set(COMMAND_REGISTRY.keys());

  for (const name of metadataNames) assert.ok(registryNames.has(name), `missing registry handler for ${name}`);
  for (const name of registryNames) assert.ok(metadataNames.has(name), `missing metadata for ${name}`);

  for (const entry of COMMANDS.filter((command) => command.classification === "public")) {
    assert.ok(ALLOWED_RISKS.has(entry.risk), `${entry.name} risk missing or unknown`);
    assert.ok(ALLOWED_LAYERS.has(entry.layer), `${entry.name} layer missing or unknown`);
    assert.ok(entry.output, `${entry.name} output missing`);
    assert.equal(typeof entry.mutating, "boolean", `${entry.name} mutating missing`);
    assert.ok(entry.sideEffects.length > 0, `${entry.name} sideEffects missing`);
    assert.ok(entry.artifacts.length > 0, `${entry.name} artifacts missing`);
    assert.ok(entry.safetyImplications.length > 0, `${entry.name} safetyImplications missing`);
  }
});

test("non-read commands are always marked mutating", () => {
  for (const entry of COMMANDS) {
    if (entry.risk === "read") continue;

    assert.equal(entry.mutating, true, `${entry.name} risk ${entry.risk} must be mutating`);
  }
});

test("commands that mutate the registry are always marked mutating", () => {
  for (const entry of COMMANDS) {
    if (entry.registryMutation === "none") continue;

    assert.equal(entry.mutating, true, `${entry.name} registry mutation ${entry.registryMutation} must be mutating`);
  }
});

test("commands with meaningful written artifacts are always marked mutating", () => {
  for (const entry of COMMANDS) {
    if (!hasMeaningfulWrittenArtifacts(entry)) continue;

    assert.equal(entry.mutating, true, `${entry.name} written artifacts must be mutating`);
  }
});

test("schema and capabilities expose agent contract, support scope, risk, and layer", () => {
  const schema = buildSchema();
  const capabilities = buildCapabilities();
  const verify = buildCommandSchema("verify");
  const status = buildCommandSchema("status");
  const schemaVerify = schema.commands.find((command) => command.name === "verify");
  const schemaStatus = schema.commands.find((command) => command.name === "status");
  const capabilityVerify = capabilities.commands.find((command) => command.name === "verify");
  const capabilityStatus = capabilities.commands.find((command) => command.name === "status");

  assert.equal(schema.agentContract, true);
  assert.deepEqual(schema.supportScope, SUPPORT_SCOPE);
  assert.equal(schemaVerify.risk, "write");
  assert.equal(schemaVerify.layer, "pipeline");
  assert.equal(schemaStatus.risk, "read");
  assert.equal(schemaStatus.layer, "setup");
  assert.equal("requiredOptions" in verify.command, false);
  assert.equal("optionalOptions" in verify.command, false);
  assert.equal(verify.command.risk, "write");
  assert.equal(verify.command.layer, "pipeline");
  assert.equal(status.command.risk, "read");
  assert.equal(status.command.layer, "setup");
  assert.equal(capabilities.agentContract, true);
  assert.deepEqual(capabilities.supportScope, SUPPORT_SCOPE);
  assert.equal(capabilityVerify.risk, "write");
  assert.equal(capabilityVerify.layer, "pipeline");
  assert.equal(capabilityStatus.risk, "read");
  assert.equal(capabilityStatus.layer, "setup");
  assert.ok(verify.command.options.some((option) => option.name === "--screenshots" && option.type === "enum"));
});

test("structured notices are additive on json results", () => {
  const payload = withCliNotices({ ok: true, value: 1 }, [
    {
      severity: "warning",
      code: "needs_authoritative_status",
      message: "Check browser-flow status before claiming success.",
      suggestedCommands: ["browser-flow status --run-id demo"]
    }
  ]);

  assert.deepEqual(payload, {
    ok: true,
    value: 1,
    notices: [
      {
        severity: "warning",
        code: "needs_authoritative_status",
        message: "Check browser-flow status before claiming success.",
        suggestedCommands: ["browser-flow status --run-id demo"]
      }
    ]
  });
});

test("status emits a notice when success cannot be claimed", () => {
  const status = runCli(["status", "--run-id", "missing-notice-run"]);

  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.successClaimable, false);
  assert.equal(payload.notices[0].severity, "warning");
  assert.equal(payload.notices[0].code, "success_not_claimable");
  assert.ok(payload.notices[0].suggestedCommands.includes("browser-flow verify --run-id missing-notice-run"));
});

test("schema and help expose split-flow browser attach metadata", () => {
  const verify = buildCommandSchema("verify").command;
  const serveBrowser = buildCommandSchema("serve-browser").command;
  const capabilities = buildCapabilities();
  const capabilityVerify = capabilities.commands.find((command) => command.name === "verify");
  const help = runCli(["serve-browser", "--help"]);

  assert.equal(verify.splitFlow.role, "client");
  assert.equal(verify.splitFlow.counterpart, "serve-browser");
  assert.match(verify.splitFlow.portSource, /claimed CDP registry port/);
  assert.equal(serveBrowser.splitFlow.role, "server");
  assert.equal(serveBrowser.splitFlow.counterpart, "verify");
  assert.equal(capabilityVerify.splitFlow.role, "client");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Split-flow browser attach:/);
  assert.match(help.stdout, /node ~\/\.cdp-port-registry\.mjs claim/);
});

test("status reports successClaimable from authoritative verification and security artifacts", (t) => {
  const runId = `status-pass-${process.pid}-${Date.now()}`;
  const runRoot = resolve(runtimeRoot, "artifacts", "runs", runId);
  t.after(() => rmSync(runRoot, { recursive: true, force: true }));

  writeArtifact(resolve(runRoot, "analysis", "workflow.json"), { schemaVersion: 1, runId, steps: [{ name: "open" }, { name: "click" }] });
  writeArtifact(resolve(runRoot, "reports", "verification.json"), {
    schemaVersion: 1,
    success: true,
    pathComplete: true,
    executedSteps: ["open", "click"],
    stepCount: 2,
    transitionChecks: [],
    securityOk: true,
    replayOutcome: "passed",
    verifiedAt: "2026-06-12T00:00:00.000Z"
  });
  writeArtifact(resolve(runRoot, "reports", "security.json"), { schemaVersion: 1, ok: true, findings: [] });
  writeArtifact(resolve(runRoot, "reports", "verification-summary.json"), { schemaVersion: 1, runId });
  writeArtifact(resolve(runRoot, "reports", "data-result.json"), {
    schemaVersion: 1,
    runId,
    replayOutcome: "passed",
    dataOutcome: "data"
  });

  const status = runCli(["status", "--run-id", runId]);

  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.runId, runId);
  assert.equal(payload.successClaimable, true);
  assert.equal(payload.evidence.usesAuthoritativeArtifacts, true);
  assert.equal(payload.evidence.journalUsedForSuccess, false);
  assert.equal(payload.artifacts.workflow.exists, true);
  assert.equal(payload.artifacts.verification.exists, true);
  assert.equal(payload.artifacts.security.exists, true);
  assert.equal(payload.artifacts.summary.exists, true);
  assert.equal(payload.artifacts.dataResult.exists, true);
  assert.equal(typeof payload.artifacts.verification.mtimeMs, "number");
  assert.match(payload.artifacts.security.path, /reports\/security\.json$/);
  assert.equal(payload.lastFailure, undefined);
});

test("status refuses successClaimable when executedSteps length mismatches stepCount", (t) => {
  const runId = `status-mismatch-${process.pid}-${Date.now()}`;
  const runRoot = resolve(runtimeRoot, "artifacts", "runs", runId);
  t.after(() => rmSync(runRoot, { recursive: true, force: true }));

  writeArtifact(resolve(runRoot, "analysis", "workflow.json"), { schemaVersion: 1, runId, steps: [{ name: "open" }, { name: "click" }] });
  writeArtifact(resolve(runRoot, "reports", "verification.json"), {
    schemaVersion: 1,
    success: true,
    pathComplete: true,
    executedSteps: ["open"],
    stepCount: 2,
    transitionChecks: [],
    securityOk: true,
    replayOutcome: "passed",
    verifiedAt: "2026-06-12T00:00:00.000Z"
  });
  writeArtifact(resolve(runRoot, "reports", "security.json"), { schemaVersion: 1, ok: true, findings: [] });
  writeArtifact(resolve(runRoot, "reports", "verification-summary.json"), { schemaVersion: 1, runId });

  const status = runCli(["status", "--run-id", runId]);

  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.successClaimable, false);
  assert.equal(payload.lastFailure.code, "executed_steps_mismatch");
  assert.equal(payload.verification.executedSteps, 1);
  assert.equal(payload.verification.stepCount, 2);
});

test("status refuses successClaimable when required verification summary is missing", (t) => {
  const runId = `status-missing-summary-${process.pid}-${Date.now()}`;
  const runRoot = resolve(runtimeRoot, "artifacts", "runs", runId);
  t.after(() => rmSync(runRoot, { recursive: true, force: true }));

  writeArtifact(resolve(runRoot, "analysis", "workflow.json"), { schemaVersion: 1, runId, steps: [{ name: "open" }] });
  writeArtifact(resolve(runRoot, "reports", "verification.json"), {
    schemaVersion: 1,
    success: true,
    pathComplete: true,
    executedSteps: ["open"],
    stepCount: 1,
    transitionChecks: [],
    securityOk: true,
    replayOutcome: "passed",
    verifiedAt: "2026-06-12T00:00:00.000Z"
  });
  writeArtifact(resolve(runRoot, "reports", "security.json"), { schemaVersion: 1, ok: true, findings: [] });

  const status = runCli(["status", "--run-id", runId]);

  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.successClaimable, false);
  assert.equal(payload.lastFailure.code, "summary_missing");
  assert.equal(payload.lastFailure.artifact, "summary");
  assert.equal(payload.artifacts.summary.exists, false);
});

test("status refuses successClaimable when required workflow is malformed", (t) => {
  const runId = `status-malformed-workflow-${process.pid}-${Date.now()}`;
  const runRoot = resolve(runtimeRoot, "artifacts", "runs", runId);
  t.after(() => rmSync(runRoot, { recursive: true, force: true }));

  mkdirSync(resolve(runRoot, "analysis"), { recursive: true });
  writeFileSync(resolve(runRoot, "analysis", "workflow.json"), "{not-json", "utf8");
  writeArtifact(resolve(runRoot, "reports", "verification.json"), {
    schemaVersion: 1,
    success: true,
    pathComplete: true,
    executedSteps: ["open"],
    stepCount: 1,
    transitionChecks: [],
    securityOk: true,
    replayOutcome: "passed",
    verifiedAt: "2026-06-12T00:00:00.000Z"
  });
  writeArtifact(resolve(runRoot, "reports", "security.json"), { schemaVersion: 1, ok: true, findings: [] });
  writeArtifact(resolve(runRoot, "reports", "verification-summary.json"), { schemaVersion: 1, runId });

  const status = runCli(["status", "--run-id", runId]);

  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.successClaimable, false);
  assert.equal(payload.lastFailure.code, "workflow_malformed");
  assert.equal(payload.lastFailure.artifact, "workflow");
  assert.equal(payload.artifacts.workflow.parseOk, false);
});

test("status refuses successClaimable when optional data result exists but is malformed", (t) => {
  const runId = `status-malformed-data-result-${process.pid}-${Date.now()}`;
  const runRoot = resolve(runtimeRoot, "artifacts", "runs", runId);
  t.after(() => rmSync(runRoot, { recursive: true, force: true }));

  writeArtifact(resolve(runRoot, "analysis", "workflow.json"), { schemaVersion: 1, runId, steps: [{ name: "open" }] });
  writeArtifact(resolve(runRoot, "reports", "verification.json"), {
    schemaVersion: 1,
    success: true,
    pathComplete: true,
    executedSteps: ["open"],
    stepCount: 1,
    transitionChecks: [],
    securityOk: true,
    replayOutcome: "passed",
    verifiedAt: "2026-06-12T00:00:00.000Z"
  });
  writeArtifact(resolve(runRoot, "reports", "security.json"), { schemaVersion: 1, ok: true, findings: [] });
  writeArtifact(resolve(runRoot, "reports", "verification-summary.json"), { schemaVersion: 1, runId });
  mkdirSync(resolve(runRoot, "reports"), { recursive: true });
  writeFileSync(resolve(runRoot, "reports", "data-result.json"), "{not-json", "utf8");

  const status = runCli(["status", "--run-id", runId]);

  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.successClaimable, false);
  assert.equal(payload.lastFailure.code, "dataResult_malformed");
  assert.equal(payload.lastFailure.artifact, "dataResult");
  assert.equal(payload.artifacts.dataResult.parseOk, false);
});

test("command-specific help exposes risk and layer", () => {
  const help = runCli(["verify", "--help"]);

  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Risk: write/);
  assert.match(help.stdout, /Layer: pipeline/);
});

test("completion exposes command-aware flags and enum values", () => {
  const zsh = runCli(["completion", "zsh"]);
  assert.equal(zsh.status, 0, zsh.stderr);
  assert.match(zsh.stdout, /--screenshots/);
  assert.match(zsh.stdout, /off final steps both/);
  assert.match(zsh.stdout, /case "\$words\[1\]" in/);
  assert.doesNotMatch(zsh.stdout, /options=\([\s\S]*'--step'[\s\S]*case "\$words\[1\]" in/);

  const fish = runCli(["completion", "fish"]);
  assert.equal(fish.status, 0, fish.stderr);
  assert.match(fish.stdout, /complete -c browser-flow -n '__fish_seen_subcommand_from verify' -l screenshots/);
  assert.match(fish.stdout, /-a 'off final steps both'/);
  assert.doesNotMatch(fish.stdout, /-l ell\b/);
  assert.match(fish.stdout, /__fish_seen_subcommand_from completion' -f -a 'bash zsh fish'/);
  assert.doesNotMatch(fish.stdout, /^complete -c browser-flow -l step$/m);
  assert.match(fish.stdout, /^complete -c browser-flow -n '__fish_seen_subcommand_from extract' -l step$/m);
});

test("typed cli errors bypass regex classification", () => {
  const invalid = classifyCliError(invalidUsage("custom invalid message", ["browser-flow help"]));
  assert.equal(invalid.code, "invalid_usage");
  assert.equal(invalid.exitCode, 2);
  assert.deepEqual(invalid.suggestedCommands, ["browser-flow help"]);

  const missing = classifyCliError(missingRequiredOption("custom missing value", "verify"));
  assert.equal(missing.code, "missing_required_option");
  assert.equal(missing.exitCode, 3);
  assert.deepEqual(formatJsonCliError(missing).error.suggestedCommands, ["browser-flow verify --help"]);

  const untyped = classifyCliError(new Error("verify requires --run-id."));
  assert.equal(untyped.code, "runtime_error");
  assert.equal(untyped.exitCode, 1);
  assert.deepEqual(untyped.suggestedCommands, ["browser-flow help"]);
});

test("typed cli errors expose stable json and human contract fields", () => {
  const typed = invalidUsage("bad flag", ["browser-flow help"], {
    subtype: "unknown_flag",
    param: "--bad",
    hint: "remove --bad or run browser-flow help",
    artifacts: ["none"],
    retryable: false
  });
  const failure = classifyCliError(typed);
  const payload = formatJsonCliError(failure);

  assert.equal(payload.error.code, "invalid_usage");
  assert.equal(payload.error.type, "validation");
  assert.equal(payload.error.subtype, "unknown_flag");
  assert.equal(payload.error.param, "--bad");
  assert.equal(payload.error.hint, "remove --bad or run browser-flow help");
  assert.deepEqual(payload.error.artifacts, ["none"]);
  assert.equal(payload.error.retryable, false);
  assert.deepEqual(payload.error.suggestedCommands, ["browser-flow help"]);

  const human = formatHumanCliError(failure);
  assert.match(human, /Type: validation/);
  assert.match(human, /Subtype: unknown_flag/);
  assert.match(human, /Hint: remove --bad or run browser-flow help/);
});

test("typed cli errors omit absent optional json fields", () => {
  const payload = formatJsonCliError(classifyCliError(invalidUsage("plain invalid message", ["browser-flow help"])));

  assert.equal(payload.error.code, "invalid_usage");
  assert.equal(payload.error.type, "validation");
  assert.equal("subtype" in payload.error, false);
  assert.equal("hint" in payload.error, false);
  assert.equal("param" in payload.error, false);
  assert.equal("artifacts" in payload.error, false);
  assert.equal("retryable" in payload.error, false);
});

test("release cli smoke works without importing heavy command modules first", () => {
  assert.equal(runCli([]).status, 0);
  assert.equal(runCli(["help"]).status, 0);
  assert.equal(runCli(["schema"]).status, 0);
  assert.equal(runCli(["schema", "command", "verify"]).status, 0);
  assert.equal(runCli(["completion", "bash"]).status, 0);
  assert.equal(runCli(["completion", "zsh"]).status, 0);
  assert.equal(runCli(["completion", "fish"]).status, 0);

  const missing = runCli(["verify", "--json"]);
  assert.equal(missing.status, 3);
  assert.equal(missing.stderr, "");
  assert.equal(JSON.parse(missing.stdout).error.code, "missing_required_option");
});

test("cli-main catch block safely falls back if command parsing throws", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/cli-main.mjs"), "utf8");

  assert.match(source, /let command = "help"/);
  assert.match(source, /try \{\n\s+const parsed = parseCommandLine\(process\.argv\)/);
  assert.match(source, /catch \{\n\s+options = \{\}/);
});
