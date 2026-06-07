import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { classifyCliError } from "../scripts/lib/cli-errors.mjs";
import { chromeCheck, directoryWritableStatus } from "../scripts/commands/doctor.mjs";
import { renderCompletion } from "../scripts/lib/completion.mjs";

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

test("completion includes every flag from grouped option descriptions", () => {
  const completion = renderCompletion("fish");

  assert.match(completion, /^complete -c browser-flow -n '__fish_seen_subcommand_from teardown' -l record$/m);
  assert.match(completion, /^complete -c browser-flow -n '__fish_seen_subcommand_from teardown' -l search$/m);
});

test("compose wraps missing source workflow reads with a user-facing error", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/commands/compose.mjs"), "utf8");

  assert.match(source, /let sourceWorkflow/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /Source workflow not found .*bf analyze --run-id/);
});

test("doctor directory writable check handles missing path values", () => {
  assert.deepEqual(directoryWritableStatus(undefined), {
    path: "",
    status: "fail",
    detail: "path is undefined or empty"
  });
});

test("doctor runtime dependency check searches parent node_modules directories", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/commands/doctor.mjs"), "utf8");

  assert.match(source, /while \(true\)/);
  assert.match(source, /existsSync\(resolve\(dir, "node_modules", name, "package\.json"\)\)/);
  assert.match(source, /dir = parent/);
});

test("zsh completion escapes colons in command descriptions", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/lib/completion.mjs"), "utf8");

  assert.match(source, /replace\(\/:\/g, "\\\\:"\)/);
});
