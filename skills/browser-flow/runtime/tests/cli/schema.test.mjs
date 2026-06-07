// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

/**
 * @param {string[]} args
 * @returns {Record<string, any>}
 */
function runCliJson(args) {
  const result = spawnSync(process.execPath, ["scripts/cli.mjs", ...args], {
    cwd: getRepoRoot(),
    encoding: "utf8",
    env: { ...process.env }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, any>>}
 */
function asCommandList(value) {
  assert.ok(Array.isArray(value));
  return /** @type {Array<Record<string, any>>} */ (value);
}

/**
 * @param {Array<Record<string, any>>} commands
 * @param {string} name
 * @returns {Record<string, any>}
 */
function findCommand(commands, name) {
  const entry = commands.find((candidate) => candidate.name === name);
  assert.ok(entry, `expected command ${name}`);
  return entry;
}

function hasOption(command, name, required = undefined) {
  return command.options.some((option) => option.name === name && (required === undefined || option.required === required));
}

test("capabilities --json returns stable command discovery", () => {
  const result = runCliJson(["capabilities", "--json"]);

  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.product, "browser-flow");
  const commands = asCommandList(result.commands);

  const verify = findCommand(commands, "verify");
  assert.equal(verify.classification, "public");
  assert.equal(verify.outputMode, "json");
  assert.equal(verify.mutating, true);
  assert.equal(verify.registryMutation, "conditional-upsert");
  assert.ok(/** @type {string[]} */ (verify.safetyImplications).some((item) => /verification\.json/.test(item)));

  const promote = findCommand(commands, "promote");
  assert.equal(promote.registryMutation, "required-upsert");
  assert.ok(/** @type {string[]} */ (promote.safetyImplications).some((item) => /external/i.test(item)));
});

test("schema --json returns full command contract list", () => {
  const result = runCliJson(["schema", "--json"]);

  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 1);
  const commands = asCommandList(result.commands);
  assert.ok(commands.length >= 25);
  assert.ok(result.topics.includes("workflows"));

  const prepare = findCommand(commands, "prepare");
  assert.deepEqual(prepare.defaults.fixture, "manual");
  assert.equal(prepare.outputMode, "json");
  assert.equal("requiredOptions" in prepare, false);
  assert.equal("optionalOptions" in prepare, false);
  assert.ok(hasOption(prepare, "--snapshot-dom", false));
  assert.ok(/** @type {string[]} */ (prepare.writtenArtifacts).some((item) => /manifest\.json/.test(item)));
});

test("schema command <name> --json returns one command contract", () => {
  const result = runCliJson(["schema", "command", "verify", "--json"]);

  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.command.name, "verify");
  assert.equal("requiredOptions" in result.command, false);
  assert.equal("optionalOptions" in result.command, false);
  assert.ok(hasOption(result.command, "--run-id", true));
  assert.ok(hasOption(result.command, "--summary", false));
  assert.equal(result.command.registryMutation, "conditional-upsert");
  assert.ok(/** @type {string[]} */ (result.command.readArtifacts).some((item) => /workflow\.json/.test(item)));
  assert.ok(/** @type {string[]} */ (result.command.writtenArtifacts).some((item) => /verification\.json/.test(item)));
  assert.ok(result.command.relatedCommands.includes("generate"));
});
