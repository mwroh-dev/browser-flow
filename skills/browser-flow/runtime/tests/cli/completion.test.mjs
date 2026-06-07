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

test("completion bash emits static command and option completion", () => {
  const result = runCli(["completion", "bash"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /_browser_flow\(\)/);
  assert.match(result.stdout, /COMPREPLY/);
  assert.match(result.stdout, /prepare done analyze generate verify/);
  assert.match(result.stdout, /--run-id/);
});

test("completion zsh emits static command and option completion", () => {
  const result = runCli(["completion", "zsh"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /#compdef browser-flow/);
  assert.match(result.stdout, /_arguments/);
  assert.match(result.stdout, /prepare:Create a capture session/);
  assert.match(result.stdout, /--dry-run/);
});

test("completion fish emits static command and option completion", () => {
  const result = runCli(["completion", "fish"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /complete -c browser-flow/);
  assert.match(result.stdout, /-a 'prepare done analyze generate verify/);
  assert.match(result.stdout, /-l run-id/);
});

test("completion rejects unknown shells as invalid usage", () => {
  const result = runCli(["completion", "powershell", "--json"]);

  assert.equal(result.status, 2);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "invalid_usage");
  assert.match(body.error.message, /completion supports bash, zsh, or fish/);
});
