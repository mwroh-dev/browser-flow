import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const runtimeRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(runtimeRoot, "scripts/cli.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: runtimeRoot,
    encoding: "utf8"
  });
}

test("help exits successfully and reports the runtime root", () => {
  const result = runCli(["help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(runtimeRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(result.stderr, "");
});

test("unknown commands fail closed with guidance", () => {
  const result = runCli(["not-a-command"]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Command "not-a-command" is not implemented yet/);
});

test("doctor returns machine-readable status", () => {
  const result = runCli(["doctor"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(Array.isArray(payload.pageNodes), true);
});
