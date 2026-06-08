import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { COMMANDS, buildCapabilities, buildCommandSchema, buildSchema, SUPPORT_SCOPE } from "../scripts/lib/cli-metadata.mjs";
import { COMMAND_REGISTRY } from "../scripts/lib/cli-registry.mjs";
import { invalidUsage, missingRequiredOption, classifyCliError, formatJsonCliError } from "../scripts/lib/cli-errors.mjs";

const runtimeRoot = resolve(import.meta.dirname, "..");
const cliEnvRoot = mkdtempSync(resolve(tmpdir(), "bf-cli-env-"));

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
    assert.ok(entry.output, `${entry.name} output missing`);
    assert.equal(typeof entry.mutating, "boolean", `${entry.name} mutating missing`);
    assert.ok(entry.sideEffects.length > 0, `${entry.name} sideEffects missing`);
    assert.ok(entry.artifacts.length > 0, `${entry.name} artifacts missing`);
    assert.ok(entry.safetyImplications.length > 0, `${entry.name} safetyImplications missing`);
  }
});

test("schema and capabilities expose agent contract and macos support scope", () => {
  const schema = buildSchema();
  const capabilities = buildCapabilities();
  const verify = buildCommandSchema("verify");

  assert.equal(schema.agentContract, true);
  assert.deepEqual(schema.supportScope, SUPPORT_SCOPE);
  assert.equal("requiredOptions" in verify.command, false);
  assert.equal("optionalOptions" in verify.command, false);
  assert.equal(capabilities.agentContract, true);
  assert.deepEqual(capabilities.supportScope, SUPPORT_SCOPE);
  assert.ok(verify.command.options.some((option) => option.name === "--screenshots" && option.type === "enum"));
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
