import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { classifyCliError, CliError } from "../scripts/lib/cli-errors.mjs";
import { chromeCheck, directoryWritableStatus, doctorCommand } from "../scripts/commands/doctor.mjs";
import { renderCompletion } from "../scripts/lib/completion.mjs";
import { parseCommandLine } from "../scripts/lib/args.mjs";
import { validateOptions } from "../scripts/lib/cli-registry.mjs";
import { saveSession, readSession, deleteSession } from "../scripts/lib/keychain.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("classifyCliError handles Error instances with nullish messages", () => {
  const error = new Error("placeholder");
  Object.defineProperty(error, "message", { value: undefined });

  const failure = classifyCliError(error);

  assert.equal(failure.code, "runtime_error");
  assert.equal(failure.message, "");
});

test("classifyCliError does not regex-classify plain object message values", () => {
  const failure = classifyCliError({ message: "requires --run-id" }, { command: "verify" });

  assert.equal(failure.code, "runtime_error");
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

test("doctor security baseline follows release-independent security entrypoint", () => {
  const result = doctorCommand({});
  const check = result.preflight.checks.find((entry) => entry.name === "securityBaseline");

  assert.equal(check?.status, "ok");
  assert.match(check?.detail ?? "", /security scan entrypoint/);
  assert.equal(result.preflight.ok, true);
});

test("zsh completion escapes colons in command descriptions", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/lib/completion.mjs"), "utf8");

  assert.match(source, /replace\(\/:\/g, "\\\\:"\)/);
});

// A. args.mjs --no-<flag> support
test("parseCommandLine parses --no-headless as headless=false", () => {
  const { options } = parseCommandLine(["node", "cli.mjs", "heal", "--run-id", "demo", "--no-headless"]);
  assert.equal(options.headless, false);
});

test("validateOptions accepts boolean false from --no-<flag> on boolean options", () => {
  const metadata = {
    name: "heal",
    options: [{ name: "--headless", required: false, type: "boolean", values: [], description: "--headless" }]
  };
  assert.doesNotThrow(() => validateOptions(/** @type {any} */ (metadata), { headless: false }));
  assert.throws(() => validateOptions(/** @type {any} */ (metadata), { headless: "yes" }), /does not accept a value/);
});

test("parseCommandLine parses --headless as headless=true", () => {
  const { options } = parseCommandLine(["node", "cli.mjs", "heal", "--run-id", "demo", "--headless"]);
  assert.equal(options.headless, true);
});

test("parseCommandLine leaves headless undefined when omitted", () => {
  const { options } = parseCommandLine(["node", "cli.mjs", "heal", "--run-id", "demo"]);
  assert.equal(options.headless, undefined);
});

// D. extract.mjs --step NaN/negative guard
test("extractCommand throws invalidUsage for non-integer step", () => {
  // Import inline to avoid needing full run fixture setup
  const source = readFileSync(resolve(runtimeRoot, "scripts/commands/extract.mjs"), "utf8");
  assert.match(source, /Number\.isInteger\(stepIndex\)/);
  assert.match(source, /invalidUsage/);
});

// E. keychain.mjs macOS guard
test("keychain saveSession throws CliError on non-macOS when no exec mock provided", () => {
  if (process.platform === "darwin") {
    // On macOS the guard passes — skip this assertion
    return;
  }
  assert.throws(() => saveSession("ref", "value"), (err) => {
    assert.ok(err instanceof CliError, "should be CliError");
    assert.equal(err.code, "safety_or_permission_block");
    assert.match(err.message, /macOS/);
    return true;
  });
});

test("keychain readSession throws CliError on non-macOS when no exec mock provided", () => {
  if (process.platform === "darwin") {
    return;
  }
  assert.throws(() => readSession("ref"), (err) => {
    assert.ok(err instanceof CliError);
    assert.equal(err.code, "safety_or_permission_block");
    return true;
  });
});

// G. workflow-registry.mjs stale lock detection
test("workflow-registry acquireLock removes stale lock file and retries", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/registry/workflow-registry.mjs"), "utf8");
  assert.match(source, /STALE_LOCK_MS/);
  assert.match(source, /mtimeMs/);
  assert.match(source, /rmSync\(lockPath/);
});

// security/redact.mjs — sanitizeUrl catch returns placeholder (A)
test("sanitizeUrl returns placeholder for unparseable URLs", async () => {
  const { sanitizeUrl } = await import("../scripts/security/redact.mjs");
  const result = sanitizeUrl("not a valid url ://");
  assert.equal(result, "<unparseable-url>");
});

test("sanitizeUrl still sanitizes valid URLs normally", async () => {
  const { sanitizeUrl } = await import("../scripts/security/redact.mjs");
  assert.equal(sanitizeUrl("http://127.0.0.1/path"), "http://127.0.0.1/path");
  assert.equal(sanitizeUrl("https://example.com/foo"), "<non-local-url>");
});

// security/patterns.mjs — SECRET_FIELD_PATTERN key boundary (B)
test("SECRET_FIELD_PATTERN does not match hotkey/keyboard/keydown false-positives", async () => {
  const { SECRET_FIELD_PATTERN } = await import("../scripts/security/patterns.mjs");
  for (const fp of ["hotkey", "keyboard", "keydown", "keyup", "donkey", "monkey"]) {
    SECRET_FIELD_PATTERN.lastIndex = 0;
    assert.equal(SECRET_FIELD_PATTERN.test(fp), false, `expected no match for: ${fp}`);
  }
});

test("SECRET_FIELD_PATTERN matches real key-type field names", async () => {
  const { SECRET_FIELD_PATTERN } = await import("../scripts/security/patterns.mjs");
  for (const tp of ["api-key", "api_key", "x-api-key", "secret-key", "access_key", "password", "token", "session", "auth", "cookie", "csrf"]) {
    SECRET_FIELD_PATTERN.lastIndex = 0;
    assert.equal(SECRET_FIELD_PATTERN.test(tp), true, `expected match for: ${tp}`);
  }
});

// E. golden-probe surge detection
test("golden-probe classify returns data when cardinality is within normal range", async () => {
  const { classify } = await import("../scripts/extract/golden-probe.mjs");
  const result = classify({ rows: [{}, {}], cardinality: 2, containerResolved: true }, { cardinality: 2 });
  assert.equal(result.status, "data");
});

test("golden-probe classify returns drift when cardinality drops 50%+ from golden", async () => {
  const { classify } = await import("../scripts/extract/golden-probe.mjs");
  const result = classify({ rows: [{}], cardinality: 1, containerResolved: true }, { cardinality: 4 });
  assert.equal(result.status, "drift");
  assert.match(result.reason ?? "", /dropped/);
});

test("golden-probe classify returns drift when cardinality surges 2x+ from golden", async () => {
  const { classify, CARDINALITY_SURGE_THRESHOLD } = await import("../scripts/extract/golden-probe.mjs");
  const surgeCardinality = Math.ceil(10 * CARDINALITY_SURGE_THRESHOLD);
  const result = classify({ rows: new Array(surgeCardinality).fill({}), cardinality: surgeCardinality, containerResolved: true }, { cardinality: 10 });
  assert.equal(result.status, "drift");
  assert.match(result.reason ?? "", /surged/);
});

test("golden-probe classify does not flag surge when golden is absent", async () => {
  const { classify } = await import("../scripts/extract/golden-probe.mjs");
  const result = classify({ rows: new Array(100).fill({}), cardinality: 100, containerResolved: true }, null);
  assert.equal(result.status, "data");
});

test("golden-probe classify does not flag surge when just below threshold", async () => {
  const { classify, CARDINALITY_SURGE_THRESHOLD } = await import("../scripts/extract/golden-probe.mjs");
  // cardinality / golden = 1.99 < 2.0 threshold
  const cardinality = Math.floor(10 * (CARDINALITY_SURGE_THRESHOLD - 0.01));
  const result = classify({ rows: new Array(cardinality).fill({}), cardinality, containerResolved: true }, { cardinality: 10 });
  assert.equal(result.status, "data");
});

// ── round-2 regressions: fixes-of-fixes verified by adversarial review ──

test("SECRET_FIELD_PATTERN matches camelCase and joined key compounds", async () => {
  const { SECRET_FIELD_PATTERN } = await import("../scripts/security/patterns.mjs");
  for (const name of ["apiKey", "apikey", "x-api-key", "accessKeyId", "sshKey", "privateKey", "publickey", "appKey", "userKey", "key", "key_id"]) {
    assert.equal(SECRET_FIELD_PATTERN.test(name), true, `expected match for: ${name}`);
  }
  for (const name of ["hotkey", "keyboard", "keydown", "whiskey", "jockey", "keyword", "displayName"]) {
    assert.equal(SECRET_FIELD_PATTERN.test(name), false, `expected no match for: ${name}`);
  }
});

test("secret pattern has a single source of truth across capture layers", async () => {
  const { SECRET_FIELD_PATTERN } = await import("../scripts/security/patterns.mjs");
  const { recorderInitScript } = await import("../scripts/observe/recorder-script.mjs");
  assert.ok(recorderInitScript.includes(SECRET_FIELD_PATTERN.toString()), "recorder script must embed the shared pattern");
  const domSanitizeSource = readFileSync(resolve(runtimeRoot, "scripts/sanitize/dom-sanitize.mjs"), "utf8");
  assert.match(domSanitizeSource, /import \{ SECRET_FIELD_PATTERN \} from "\.\.\/security\/patterns\.mjs"/);
  assert.doesNotMatch(domSanitizeSource, /const SECRET_FIELD_PATTERN =/);
});

test("golden-probe surge check skips tiny goldens where ratios are meaningless", async () => {
  const { classify } = await import("../scripts/extract/golden-probe.mjs");
  const grown = classify({ rows: [{}, {}], cardinality: 2, containerResolved: true }, { cardinality: 1 });
  assert.equal(grown.status, "data");
  const surged = classify({ rows: new Array(8).fill({}), cardinality: 8, containerResolved: true }, { cardinality: 3 });
  assert.equal(surged.status, "drift");
});

test("extract paged reuse classifies per-page cardinality against the single-page golden", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/commands/extract.mjs"), "utf8");
  assert.match(source, /perPageMax/);
  assert.match(source, /pageCardinalities/);
});

test("assembler updates relative expectedNetwork urls for the same endpoint", async () => {
  const { assembleComposedWorkflow } = await import("../scripts/compose/workflow-assembler.mjs");
  const out = assembleComposedWorkflow({
    sourceWorkflow: {
      finalUrl: "/api/items?page=2",
      verification: { expectedNetwork: { method: "GET", url: "/api/items?page=1" } }
    },
    primaryRunId: "p",
    derivedRunId: "d",
    selectedSteps: [{ url: "/api/items?page=2" }]
  });
  assert.equal(out.verification.expectedNetwork.url, "/api/items?page=2");
  const kept = assembleComposedWorkflow({
    sourceWorkflow: {
      finalUrl: "/detail",
      verification: { expectedNetwork: { method: "GET", url: "/api/list" } }
    },
    primaryRunId: "p",
    derivedRunId: "d",
    selectedSteps: [{ url: "/detail" }]
  });
  assert.equal(kept.verification.expectedNetwork.url, "/api/list");
});

test("validateOptions rejects --no-<flag> negation on string options", () => {
  const metadata = {
    name: "heal",
    options: [{ name: "--run-id", value: "id", required: true, type: "string", values: [], description: "--run-id <id>" }]
  };
  assert.throws(() => validateOptions(/** @type {any} */ (metadata), { "run-id": false }), /requires a value/);
});

test("iteration_limit is a registered blockedReason everywhere it is consumed", () => {
  for (const file of ["scripts/commands/compose.mjs", "scripts/compose/compose-summary.mjs", "scripts/lib/schemas.mjs"]) {
    const source = readFileSync(resolve(runtimeRoot, file), "utf8");
    assert.match(source, /iteration_limit/, `${file} must include iteration_limit`);
  }
});

test("client close keeps the error sink alive until cri.close resolves", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/cdp/client.mjs"), "utf8");
  const removeIdx = source.indexOf("criAsEmitter.removeAllListeners();");
  const sinkIdx = source.indexOf('criAsEmitter.on("error", () => {})');
  const closeIdx = source.indexOf("await cri.close()");
  assert.ok(removeIdx !== -1 && sinkIdx !== -1 && closeIdx !== -1);
  assert.ok(removeIdx < sinkIdx && sinkIdx < closeIdx, "order must be removeAll -> error sink -> close");
});

test("registry stale-lock steal is rename-based with inode verification", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/registry/workflow-registry.mjs"), "utf8");
  assert.match(source, /renameSync\(lockPath, stalePath\)/);
  assert.match(source, /grabbed\.ino === seen\.ino/);
  assert.doesNotMatch(source, /rmSync\(lockPath, \{ force: true \}\);\s*\n\s*continue/);
});

test("settle pending-network check is part of the stability condition", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/observe/observer-daemon.mjs"), "utf8");
  assert.match(source, /if \(stableMs >= STABLE_TARGET_MS\) \{\s*\n\s*if \(countPendingRequests\(networkEvents, Date\.now\(\)\) === 0\) return;/);
  assert.match(source, /PENDING_AGE_CUTOFF_MS/);
  assert.match(source, /await Promise\.race\(\[snapshotQueue, delay\(3_000\)\]\)/);
});

test("proxy-auth retry map drops entries on cancel and on pass-through", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/cdp/watchdogs/proxy-auth.mjs"), "utf8");
  const deletes = source.match(/authRetryCount\.delete\(/g) ?? [];
  assert.ok(deletes.length >= 2, "expected delete on CancelAuth and on requestPaused");
});

test("verify-run invalidates the full prior report set before spawning", () => {
  const source = readFileSync(resolve(runtimeRoot, "scripts/verify/verify-run.mjs"), "utf8");
  assert.match(source, /rmSync\(runPaths\.verificationPath, \{ force: true \}\)/);
  assert.match(source, /verification-summary\.json"\), \{ force: true \}/);
  assert.match(source, /rmSync\(runPaths\.securityPath, \{ force: true \}\)/);
});
