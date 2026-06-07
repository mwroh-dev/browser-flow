// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

/**
 * @param {string[]} args
 */
function runCli(args) {
  return spawnSync(process.execPath, ["scripts/cli.mjs", ...args], {
    cwd: getRepoRoot(),
    encoding: "utf8",
    env: { ...process.env }
  });
}

test("unknown command uses documented invalid-usage exit and actionable human error", () => {
  const result = runCli(["unknown-command"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /browser-flow error: invalid_usage/i);
  assert.match(result.stderr, /What failed:/);
  assert.match(result.stderr, /Unknown command "unknown-command"/);
  assert.match(result.stderr, /Recoverable: yes/);
  assert.match(result.stderr, /Suggested next commands:/);
  assert.match(result.stderr, /browser-flow help/);
});

test("missing required option in JSON mode returns structured error", () => {
  const result = runCli(["verify", "--json"]);

  assert.equal(result.status, 3);
  assert.equal(result.stderr, "");
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "missing_required_option");
  assert.match(body.error.message, /verify requires --run-id/);
  assert.equal(body.error.recoverable, true);
  assert.ok(body.error.suggestedCommands.includes("browser-flow verify --help"));
});

test("missing string option value returns invalid-usage JSON before command side effects", () => {
  const result = runCli(["doctor", "--chrome-path", "--json"]);

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "invalid_usage");
  assert.match(body.error.message, /--chrome-path requires a value/);
  assert.equal(body.error.recoverable, true);
});

test("help exit-codes documents stable CLI failure taxonomy", () => {
  const result = runCli(["help", "exit-codes"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /browser-flow help exit-codes/);
  assert.match(result.stdout, /2\s+invalid_usage/);
  assert.match(result.stdout, /3\s+missing_required_option/);
  assert.match(result.stdout, /8\s+verification_not_green/);
  assert.match(result.stdout, /9\s+diagnostic_not_promotable/);
});
