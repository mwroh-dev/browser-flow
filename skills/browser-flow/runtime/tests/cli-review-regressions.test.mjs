import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { classifyCliError } from "../scripts/lib/cli-errors.mjs";
import { chromeCheck } from "../scripts/commands/doctor.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("classifyCliError handles Error instances with nullish messages", () => {
  const error = new Error("placeholder");
  Object.defineProperty(error, "message", { value: undefined });

  const failure = classifyCliError(error);

  assert.equal(failure.code, "runtime_error");
  assert.equal(failure.message, "");
});

test("classifyCliError preserves plain object message values", () => {
  const failure = classifyCliError({ message: "requires --run-id" }, { command: "verify" });

  assert.equal(failure.code, "missing_required_option");
  assert.equal(failure.message, "requires --run-id");
});

test("doctor npm version check uses shell execution on Windows", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/commands/doctor.mjs"), "utf8");

  assert.match(
    source,
    /spawnSync\("npm",\s*\["--version"\],\s*\{[^}]*shell:\s*process\.platform\s*===\s*"win32"/s
  );
});

test("doctor chrome check handles undefined browser paths", () => {
  const check = chromeCheck(undefined, () => undefined);

  assert.equal(check.name, "chrome");
  assert.equal(check.status, "warning");
  assert.equal(check.path, undefined);
});
