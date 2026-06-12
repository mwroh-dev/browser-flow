# Agent-Native CLI Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six agent-native CLI patterns to browser-flow while preserving the existing artifact-first workflow compiler contract.

**Architecture:** Keep `scripts/lib/cli-metadata.mjs` as the agent-visible command contract source of truth. Add focused helpers for typed errors, notices, and status reduction instead of broad rewrites. Implement behavior additively so existing command names, exit codes, and JSON payloads remain compatible.

**Tech Stack:** Node.js ESM, `node:test`, Zod schemas, browser-flow runtime CLI under `skills/browser-flow/runtime`.

---

## Coordination Rules

**Branch:** `codex/agent-native-cli-patterns`

**Commit rule:** Each phase ends with a focused commit. Do not mix unrelated phases in one commit.

**Subagent rule:** Execution and verification must be separate. Worker agents may edit files in their assigned lane. Verifier agents are read-only unless explicitly asked to produce a patch. Close each agent with `close_agent` immediately after its output is reviewed.

**Model tiers:** Use a stronger worker/verifier for high-reasoning contract/status work. Use a smaller/fast worker only for simple docs or mechanical metadata edits. Do not use an override unless there is a task-specific reason.

**Backlog rule:** Each phase has a backlog review step. If a phase reveals a deeper issue, record it in this file under "Phase Backlog". At phase end, decide whether it is required for correctness now. If yes, resolve it before the phase commit. If no, leave it documented.

**Verification rule:** The executing worker cannot be the sole verifier for its own phase. Verification evidence must come from a separate verifier agent or from the main agent after reviewing worker output.

## Phase Backlog

- [ ] No active backlog items.

---

## Lane A: Contract Surface

### Phase A1: Typed CLI Error Contract

**Evaluation before work:**
- JSON errors keep `error.code` and `error.suggestedCommands` for compatibility.
- JSON errors add stable `error.type`, `error.subtype`, `error.hint`, `error.param`, `error.artifacts`, and `error.retryable` when available.
- Human errors include the typed hint without becoming noisy.

**Files:**
- Modify: `skills/browser-flow/runtime/scripts/lib/cli-errors.mjs`
- Test: `skills/browser-flow/runtime/tests/cli-contract.test.mjs`
- Test: `skills/browser-flow/runtime/tests/cli-review-regressions.test.mjs`

- [ ] **Step A1.1: Write failing tests for typed error fields**

Add assertions in `skills/browser-flow/runtime/tests/cli-contract.test.mjs`:

```js
const typed = invalidUsage("bad flag", ["browser-flow help"], {
  subtype: "unknown_flag",
  param: "--bad",
  hint: "remove --bad or run browser-flow help",
  artifacts: ["none"],
  retryable: false
});
const payload = formatJsonCliError(classifyCliError(typed));
assert.equal(payload.error.code, "invalid_usage");
assert.equal(payload.error.type, "validation");
assert.equal(payload.error.subtype, "unknown_flag");
assert.equal(payload.error.param, "--bad");
assert.equal(payload.error.hint, "remove --bad or run browser-flow help");
assert.deepEqual(payload.error.artifacts, ["none"]);
assert.equal(payload.error.retryable, false);
assert.deepEqual(payload.error.suggestedCommands, ["browser-flow help"]);
```

Add a human-format assertion:

```js
const human = formatHumanCliError(classifyCliError(typed));
assert.match(human, /Type: validation/);
assert.match(human, /Subtype: unknown_flag/);
assert.match(human, /Hint: remove --bad or run browser-flow help/);
```

- [ ] **Step A1.2: Run targeted tests to confirm failure**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-contract.test.mjs
```

Expected: FAIL because `invalidUsage` does not accept metadata and formatted errors do not expose typed fields.

- [ ] **Step A1.3: Implement typed metadata**

Update `CliError` constructor in `scripts/lib/cli-errors.mjs` to accept an optional metadata object:

```js
constructor(code, message, suggestedCommands = [], metadata = {}) {
  super(message);
  this.name = "CliError";
  this.code = code;
  const definition = EXIT_CODE_BY_CODE.get(code) ?? EXIT_CODE_BY_CODE.get("runtime_error");
  this.exitCode = definition?.status ?? 1;
  this.recoverable = definition?.recoverable ?? false;
  this.suggestedCommands = suggestedCommands;
  this.type = metadata.type ?? typeForCode(code);
  this.subtype = metadata.subtype ?? code;
  this.param = metadata.param;
  this.hint = metadata.hint;
  this.artifacts = metadata.artifacts;
  this.retryable = metadata.retryable;
}
```

Add `typeForCode(code)` mapping:

```js
const ERROR_TYPE_BY_CODE = new Map([
  ["invalid_usage", "validation"],
  ["missing_required_option", "validation"],
  ["missing_run_artifact", "artifact"],
  ["dependency_preflight_failure", "dependency"],
  ["safety_or_permission_block", "policy"],
  ["checkpoint_required", "checkpoint"],
  ["verification_not_green", "verification"],
  ["diagnostic_not_promotable", "promotion"],
  ["runtime_error", "runtime"]
]);
```

Update constructors such as `invalidUsage(message, suggestedCommands, metadata = {})` and `missingRequiredOption(message, command, metadata = {})`.

Update `classifyCliError` to carry the typed fields into `CliFailure`. Update `formatJsonCliError` and `formatHumanCliError` to emit them when present.

- [ ] **Step A1.4: Run tests**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-contract.test.mjs tests/cli-review-regressions.test.mjs
```

Expected: PASS.

- [ ] **Step A1.5: Backlog review**

If broad error taxonomy work is needed beyond the current mapping, record it in "Phase Backlog". Do not add a large taxonomy unless required by failing tests.

- [ ] **Step A1.6: Commit**

```bash
git add skills/browser-flow/runtime/scripts/lib/cli-errors.mjs skills/browser-flow/runtime/tests/cli-contract.test.mjs skills/browser-flow/runtime/tests/cli-review-regressions.test.mjs
git commit -m "feat: expose typed cli error contract"
```

**Result required:** Typed JSON error contract is additive and existing error tests still pass.

---

### Phase A2: Risk And Layer Metadata

**Evaluation before work:**
- Every public command has `risk` and `layer`.
- `schema`, `schema command <name>`, and `capabilities` expose both fields.
- Help text shows risk/layer for command-specific help.

**Files:**
- Modify: `skills/browser-flow/runtime/scripts/lib/cli-metadata.mjs`
- Test: `skills/browser-flow/runtime/tests/cli-contract.test.mjs`

- [ ] **Step A2.1: Write failing metadata tests**

In `cli-contract.test.mjs`, add:

```js
const schema = buildSchema();
const promote = buildCommandSchema("promote").command;
assert.equal(promote.risk, "high-risk-write");
assert.equal(promote.layer, "promotion");
assert.ok(schema.commands.every((command) => typeof command.risk === "string"));
assert.ok(schema.commands.every((command) => typeof command.layer === "string"));

const capabilities = buildCapabilities();
const status = capabilities.commands.find((entry) => entry.name === "status");
assert.equal(status?.risk, "read");
assert.equal(status?.layer, "setup");
```

If `status` is not implemented yet, temporarily assert an existing command such as `verify` and update this assertion in Phase B1.

- [ ] **Step A2.2: Run targeted tests to confirm failure**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-contract.test.mjs
```

Expected: FAIL because command metadata has no `risk` or `layer`.

- [ ] **Step A2.3: Add metadata fields**

Extend the `CommandMetadata` typedef with:

```js
*   risk: "read" | "write" | "high-risk-write" | "interactive",
*   layer: "setup" | "pipeline" | "reuse" | "review" | "promotion" | "recovery" | "raw-browser",
```

Update `command(input)` defaults:

```js
risk: input.output === "interactive" ? "interactive" : readOnly ? "read" : "write",
layer: layerForGroup(input.group),
```

Add:

```js
function layerForGroup(group) {
  if (group === "pipeline" || group === "capture") return "pipeline";
  if (group === "reuse" || group === "extract" || group === "compose") return "reuse";
  if (group === "review") return "review";
  if (group === "promote") return "promotion";
  if (group === "cleanup") return "recovery";
  return "setup";
}
```

Override risk for commands:

```js
serve-browser: risk "interactive", layer "raw-browser"
prepare: risk "interactive" when real-site flags are used in practice, metadata risk "write"
verify: risk "write"
verify --first/--attach guidance remains in splitFlow metadata in Phase C1
promote: risk "high-risk-write"
cleanup: risk "high-risk-write"
```

Update `buildCapabilities()`, `commandSchema()`, and `renderCommandHelp()` to include risk/layer.

- [ ] **Step A2.4: Run tests**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-contract.test.mjs
```

Expected: PASS.

- [ ] **Step A2.5: Backlog review**

If command-specific dynamic risk is needed, record it. Do not implement dynamic risk in this phase.

- [ ] **Step A2.6: Commit**

```bash
git add skills/browser-flow/runtime/scripts/lib/cli-metadata.mjs skills/browser-flow/runtime/tests/cli-contract.test.mjs
git commit -m "feat: expose cli risk and layer metadata"
```

**Result required:** Agent metadata can distinguish read/write/recovery/promotion/raw-browser surfaces.

---

## Lane B: Authoritative Status

### Phase B1: Status Command

**Evaluation before work:**
- `status` is read-only.
- It reads authoritative artifacts, not stdout summaries or historical journal entries.
- It reports `successClaimable` only when verification replay passed, path is complete, executed count equals step count, security is ok, and artifacts exist.

**Files:**
- Create: `skills/browser-flow/runtime/scripts/commands/status.mjs`
- Create: `skills/browser-flow/runtime/scripts/lib/status-report.mjs`
- Modify: `skills/browser-flow/runtime/scripts/lib/cli-registry.mjs`
- Modify: `skills/browser-flow/runtime/scripts/lib/cli-metadata.mjs`
- Test: `skills/browser-flow/runtime/tests/cli-contract.test.mjs`
- Test: `skills/browser-flow/runtime/tests/cli-review-regressions.test.mjs`

- [ ] **Step B1.1: Write failing status reducer tests**

In `cli-review-regressions.test.mjs`, add a temp-run test importing `buildStatusReport` from `scripts/lib/status-report.mjs`. The test should create a fake run directory with:

```js
reports/verification.json:
{
  "schemaVersion": 1,
  "success": true,
  "pathComplete": true,
  "executedSteps": ["step1", "step2"],
  "stepCount": 2,
  "transitionChecks": [],
  "resultEvidence": {"passed": true, "selector": "#done", "actualText": "Done", "expectedText": "Done"},
  "securityOk": true,
  "verifiedAt": "2026-06-12T00:00:00.000Z",
  "replayOutcome": "passed"
}
reports/security.json:
{"schemaVersion":1,"ok":true,"findings":[]}
```

Assert:

```js
assert.equal(report.ok, true);
assert.equal(report.status.successClaimable, true);
assert.equal(report.status.executed, "2/2");
assert.equal(report.status.replayOutcome, "passed");
assert.equal(report.artifacts.verification.exists, true);
assert.equal(report.artifacts.security.exists, true);
```

Add a negative case where `executedSteps` length is `1` and assert `successClaimable === false`.

- [ ] **Step B1.2: Run tests to confirm failure**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-review-regressions.test.mjs
```

Expected: FAIL because `status-report.mjs` does not exist.

- [ ] **Step B1.3: Implement `status-report.mjs`**

Create `buildStatusReport({ runId, runPaths, now = new Date() })` with this shape:

```js
{
  ok: true,
  runId,
  status: {
    successClaimable,
    replayOutcome,
    securityOk,
    pathComplete,
    executed,
    executedSteps,
    stepCount,
    lastFailure
  },
  artifacts: {
    workflow: { path, exists, mtimeMs },
    verification: { path, exists, mtimeMs },
    security: { path, exists, mtimeMs },
    summary: { path, exists, mtimeMs },
    dataResult: { path, exists, mtimeMs }
  },
  evidence: {
    usesAuthoritativeArtifacts: true,
    journalUsedForSuccess: false
  }
}
```

Use `existsSync`, `statSync`, and `readJson`. If an artifact is missing or malformed, include `lastFailure` and keep `successClaimable: false`.

- [ ] **Step B1.4: Add command and metadata**

Create `commands/status.mjs`:

```js
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { buildStatusReport } from "../lib/status-report.mjs";

export function statusCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("status requires --run-id.");
  return buildStatusReport({ runId, runPaths: getRunPaths(runId) });
}
```

Register `status` in `cli-registry.mjs` and add metadata in `cli-metadata.mjs` under setup/diagnostics with `risk: "read"` and `layer: "setup"`.

- [ ] **Step B1.5: Run targeted tests**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-contract.test.mjs tests/cli-review-regressions.test.mjs
```

Expected: PASS.

- [ ] **Step B1.6: Backlog review**

If mtime comparison against the exact last verify start time is not available, record it. Do not fake stronger proof than available.

- [ ] **Step B1.7: Commit**

```bash
git add skills/browser-flow/runtime/scripts/commands/status.mjs skills/browser-flow/runtime/scripts/lib/status-report.mjs skills/browser-flow/runtime/scripts/lib/cli-registry.mjs skills/browser-flow/runtime/scripts/lib/cli-metadata.mjs skills/browser-flow/runtime/tests/cli-contract.test.mjs skills/browser-flow/runtime/tests/cli-review-regressions.test.mjs
git commit -m "feat: add authoritative run status command"
```

**Result required:** Agents can ask `browser-flow status --run-id <id>` before claiming success.

---

## Lane C: Notices And Split-Flow Docs

### Phase C1: Notice Envelope Hook

**Evaluation before work:**
- Structured success output can include `_notice`.
- Plain text help and shell completion are not polluted.
- No fake skill-drift state is invented.

**Files:**
- Create: `skills/browser-flow/runtime/scripts/lib/cli-notices.mjs`
- Modify: `skills/browser-flow/runtime/scripts/cli-main.mjs`
- Modify: `skills/browser-flow/runtime/scripts/cli.mjs`
- Test: `skills/browser-flow/runtime/tests/cli-contract.test.mjs`

- [ ] **Step C1.1: Write failing tests**

Add tests that call `withCliNotices({ ok: true }, ["node", "cli", "schema"])` and assert no notice by default. Add a test with env override:

```js
const payload = withCliNotices(
  { ok: true },
  ["node", "cli", "schema"],
  { BROWSER_FLOW_AGENT_NOTICE: "agent-contract-v1" }
);
assert.equal(payload._notice.agentContract.message, "agent-contract-v1");
```

- [ ] **Step C1.2: Implement `cli-notices.mjs`**

Export:

```js
export function withCliNotices(payload, argv = process.argv, env = process.env) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) return payload;
  if (argv.includes("completion") || argv.includes("__complete")) return payload;
  const message = env.BROWSER_FLOW_AGENT_NOTICE;
  if (!message) return payload;
  return {
    ...payload,
    _notice: {
      ...(payload._notice && typeof payload._notice === "object" ? payload._notice : {}),
      agentContract: {
        message,
        command: "browser-flow capabilities"
      }
    }
  };
}
```

Wire it into JSON success output in `cli-main.mjs` and `cli.mjs` only where output mode is JSON.

- [ ] **Step C1.3: Run tests**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-contract.test.mjs
```

Expected: PASS.

- [ ] **Step C1.4: Backlog review**

Record skill-version drift state as backlog unless there is an existing persisted runtime/skill version source.

- [ ] **Step C1.5: Commit**

```bash
git add skills/browser-flow/runtime/scripts/lib/cli-notices.mjs skills/browser-flow/runtime/scripts/cli-main.mjs skills/browser-flow/runtime/scripts/cli.mjs skills/browser-flow/runtime/tests/cli-contract.test.mjs
git commit -m "feat: add cli notice envelope hook"
```

**Result required:** Notice infrastructure exists without corrupting non-JSON surfaces.

---

### Phase C2: Split-Flow Browser Attach Guidance

**Evaluation before work:**
- `serve-browser`, `verify --first`, and `verify --attach` metadata tell agents how to hand control to the user and resume.
- Skill docs warn against hardcoded named CDP port usage and align with local AGENTS instructions.

**Files:**
- Modify: `skills/browser-flow/runtime/scripts/lib/cli-metadata.mjs`
- Modify: `skills/browser-flow/references/phase-entry-contract.md`
- Modify: `skills/browser-flow/references/replay-permission-policy.md`
- Test: `skills/browser-flow/runtime/tests/cli-contract.test.mjs`

- [ ] **Step C2.1: Write failing metadata tests**

In `cli-contract.test.mjs`, assert:

```js
const serve = buildCommandSchema("serve-browser").command;
assert.equal(serve.splitFlow?.mode, "human-browser-handoff");
assert.match(serve.splitFlow?.resumeCommand ?? "", /browser-flow verify --run-id <id> --attach <port>/);
const verify = buildCommandSchema("verify").command;
assert.ok(Array.isArray(verify.splitFlow?.entrypoints));
assert.ok(verify.splitFlow.entrypoints.includes("--first"));
assert.ok(verify.splitFlow.entrypoints.includes("--attach"));
```

- [ ] **Step C2.2: Add splitFlow metadata**

Extend `CommandMetadata` with optional `splitFlow`. Add command schema exposure. For `serve-browser`, set:

```js
splitFlow: {
  mode: "human-browser-handoff",
  operatorAction: "User completes login or browser setup in the visible Chrome.",
  resumeCommand: "browser-flow verify --run-id <id> --attach <port>",
  agentRules: [
    "Do not inject cookies or form values.",
    "Do not hardcode 9222 for named workflows; claim a port with the local CDP registry."
  ]
}
```

For `verify`, set entrypoints for `--first` and `--attach`.

- [ ] **Step C2.3: Update docs**

Update phase/replay references with the same split-flow rules. Mention that named CDP workflows should use the local port registry before launch.

- [ ] **Step C2.4: Run tests**

Run:

```bash
cd skills/browser-flow/runtime
node --test tests/cli-contract.test.mjs
```

Expected: PASS.

- [ ] **Step C2.5: Backlog review**

If the runtime should call `~/.cdp-port-registry.mjs` itself, record it. Do not add machine-local dependency calls in this phase.

- [ ] **Step C2.6: Commit**

```bash
git add skills/browser-flow/runtime/scripts/lib/cli-metadata.mjs skills/browser-flow/references/phase-entry-contract.md skills/browser-flow/references/replay-permission-policy.md skills/browser-flow/runtime/tests/cli-contract.test.mjs
git commit -m "docs: describe split-flow browser handoff"
```

**Result required:** Agent-facing docs and schema explain browser handoff without encouraging CDP shortcuts.

---

## Lane D: Final Verification

### Phase D1: Independent Verification Pass

**Evaluation before work:**
- Full unit suite passes.
- `schema`, `capabilities`, and `status` smoke commands work.
- Review confirms each of the six design patterns has concrete evidence.

**Files:**
- No production edits expected.
- Possible test-only edits if verifier finds a real gap.

- [ ] **Step D1.1: Run full tests**

Run:

```bash
cd skills/browser-flow/runtime
npm test
```

Expected: PASS.

- [ ] **Step D1.2: Run CLI smoke checks**

Run:

```bash
cd skills/browser-flow/runtime
node scripts/cli-main.mjs schema > /tmp/browser-flow-schema.json
node scripts/cli-main.mjs capabilities > /tmp/browser-flow-capabilities.json
node scripts/cli-main.mjs schema command status > /tmp/browser-flow-status-schema.json
node -e 'const s=require("/tmp/browser-flow-schema.json"); if(!s.commands.find(c=>c.name==="status")) process.exit(1)'
```

Expected: exit 0 for every command.

- [ ] **Step D1.3: Verifier audit**

Dispatch a verifier agent with read-only instructions:

```text
Audit the current browser-flow branch for the six agent-native CLI patterns in docs/superpowers/specs/2026-06-12-agent-native-cli-patterns-design.md. Do not edit files. Report gaps with exact file paths and tests/commands that prove or disprove completion.
```

Close the verifier agent after reviewing its final answer.

- [ ] **Step D1.4: Resolve required gaps**

If verifier findings contradict the plan's evaluation requirements, fix them in a focused commit before final reporting.

- [ ] **Step D1.5: Final commit if needed**

Only commit if D1.4 changed files:

Stage only the files changed by D1.4, then run:

```bash
git commit -m "fix: close agent-native cli verification gaps"
```

**Result required:** Final evidence proves the six-pattern goal without relying on intent or partial progress.
