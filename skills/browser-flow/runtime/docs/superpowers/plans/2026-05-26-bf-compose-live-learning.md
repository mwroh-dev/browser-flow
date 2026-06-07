# BF Compose Live Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `bf compose` as a primary-run-anchored workflow composer that reuses existing run/page knowledge first, fills only unresolved gaps through direct CDP live learning, and emits a generated + verified derived run.

**Architecture:** Keep the execution path serial and deterministic inside one critical lane. A small `composer-agent` sub-skill converts natural-language intent into a structured decision artifact; deterministic `scripts/compose/**` owns candidate indexing, projected views, reuse selection, checkpoint gates, live learning, workflow assembly, policy hooks, and compose reporting. Compose session records stay in `artifacts/runs/<id>/compose/`; durable knowledge remains in existing `knowledge/pages`, `knowledge/scraping`, and `knowledge/registry` stores.

**Tech Stack:** Node ESM, `node:test`, existing `bf` CLI/runtime helpers, Zod artifact schemas, CDP browser session/watchdogs, project-local browser-flow skills.

---

## Execution Controls

### Lane map

| Lane | Scope | Files owned | Model tier |
|---|---|---|---|
| `Lane A` | Critical path runtime, safety, generate/verify integration | `scripts/commands/compose.mjs`, `scripts/compose/**`, `scripts/lib/config.mjs`, `scripts/lib/schemas.mjs`, core tests | `gpt-5.5` with `high` reasoning |
| `Lane B` | Sub-agent contract + projected view boundary | `.codex/skills/composer-agent/SKILL.md`, `scripts/compose/projected-view.mjs`, skill/tests | `gpt-5.4` with `medium` reasoning |
| `Lane C` | Public prompt, README, roadmap, backlog wording, validator | `.codex/skills/browser-flow/prompt.md`, `.codex/skills/browser-flow/scripts/validate-skill.mjs`, `README.md`, `docs/roadmap.md`, `tasks/phases/phase-63-composition-agent.md`, doc tests | `gpt-5.4-mini` or `gpt-5.3-codex-spark` for straightforward edits; escalate to `gpt-5.4` if wording conflicts appear |

### Commit rule

- Every task below ends with its own commit.
- If a lane uncovers a root issue that does not block its current task, record it before committing:
  - append a short note under `## Result Log` in `tasks/phases/phase-63-composition-agent.md`
  - if the issue is product-visible or durable, also add a backlog bullet in `docs/roadmap.md`
- If the root issue invalidates the current phase's acceptance conditions, stop the lane and fix it before moving on.

### Phase gate template

Every task below includes:

- **Eval:** measurable acceptance criteria that must be checked before the task is declared complete
- **Result:** the concrete outputs that must exist after the task
- **Backlog review:** the self-review questions to run before the task commit

### Regression self-review at every phase end

Run this checklist after the green tests for each task:

1. Did this phase reveal a deeper graph/safety/provenance problem that will obviously recur in the next phase?
2. Does any deferred issue make the just-written result misleading or unstable?
3. Is the deferred issue isolated enough to live in backlog, or is it now part of the critical path?

If the answer to `2` or `3` is yes, fix it now in the same lane before committing.

## File Map

### Create

- `scripts/commands/compose.mjs`
- `scripts/compose/candidate-index.mjs`
- `scripts/compose/projected-view.mjs`
- `scripts/compose/reuse-selector.mjs`
- `scripts/compose/checkpoint-gates.mjs`
- `scripts/compose/workflow-assembler.mjs`
- `scripts/compose/learning-loop.mjs`
- `scripts/compose/policy-hooks.mjs`
- `scripts/compose/compose-summary.mjs`
- `.codex/skills/composer-agent/SKILL.md`
- `tests/commands/compose.test.mjs`
- `tests/compose/projected-view.test.mjs`
- `tests/compose/reuse-selector.test.mjs`
- `tests/compose/checkpoint-gates.test.mjs`
- `tests/compose/workflow-assembler.test.mjs`
- `tests/compose/learning-loop.test.mjs`
- `tests/compose/policy-hooks.test.mjs`
- `tests/skill/browser-flow-compose.test.mjs`

### Modify

- `scripts/cli-main.mjs`
- `scripts/lib/config.mjs`
- `scripts/lib/schemas.mjs`
- `README.md`
- `docs/roadmap.md`
- `tasks/phases/phase-63-composition-agent.md`
- `.codex/skills/browser-flow/prompt.md`
- `.codex/skills/browser-flow/scripts/validate-skill.mjs`

### Reuse without modification unless forced

- `scripts/generate/generate-runner.mjs`
- `scripts/verify/verify-run.mjs`
- `scripts/explore/explorer.mjs`
- `scripts/explore/cdp-explorer.mjs`

If modification of these reuse surfaces becomes necessary, record why in the backlog review for the task that introduces the change.

## Task 1: Lane A / Phase A1 — Compose CLI Surface, Run Paths, and Artifact Schemas

**Files:**
- Create: `scripts/commands/compose.mjs`
- Modify: `scripts/cli-main.mjs`
- Modify: `scripts/lib/config.mjs`
- Modify: `scripts/lib/schemas.mjs`
- Test: `tests/commands/compose.test.mjs`

**Eval:**
- `bf help` lists `compose`
- `composeCommand` rejects missing `--run-id` and `--request`
- `getRunPaths()` exposes compose artifact paths
- new compose summary / decision schemas parse

**Result:**
- command surface exists
- run path layout for `compose/` artifacts exists
- schema scaffolding exists for compose artifacts

**Backlog review:**
- Did compose artifacts require a new durable knowledge store? If yes, stop and justify it before proceeding.
- Did command validation force changes in unrelated commands? If yes, isolate them now.

- [ ] **Step 1: Write the failing command/path test**

Create `tests/commands/compose.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getRunPaths } from "../../scripts/lib/config.mjs";
import { composeCommand } from "../../scripts/commands/compose.mjs";

test("getRunPaths exposes compose artifact paths", () => {
  const paths = getRunPaths("compose-paths-1");
  assert.match(paths.composeDir, /artifacts\/runs\/compose-paths-1\/compose$/);
  assert.match(paths.composeRequestPath, /compose-request\.json$/);
  assert.match(paths.composePlanPath, /compose-plan\.json$/);
  assert.match(paths.composeSessionPath, /compose-session\.json$/);
  assert.match(paths.composeJournalPath, /compose-journal\.jsonl$/);
  assert.match(paths.composeSummaryPath, /reports\/compose-summary\.json$/);
});

test("composeCommand requires run-id and request", async () => {
  await assert.rejects(() => composeCommand({ request: "x" }), /compose requires --run-id/);
  await assert.rejects(() => composeCommand({ "run-id": "r1" }), /compose requires --request/);
});
```

- [ ] **Step 2: Run the test to verify red**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs
```

Expected: fail because `composeCommand` and compose paths do not exist yet.

- [ ] **Step 3: Add compose paths to `getRunPaths()`**

In `scripts/lib/config.mjs`, extend `getRunPaths()` with:

```js
    composeDir: resolve(runRoot, "compose"),
    composeRequestPath: resolve(runRoot, "compose", "compose-request.json"),
    composePlanPath: resolve(runRoot, "compose", "compose-plan.json"),
    composeSessionPath: resolve(runRoot, "compose", "compose-session.json"),
    composeJournalPath: resolve(runRoot, "compose", "compose-journal.jsonl"),
    composeSummaryPath: resolve(runRoot, "reports", "compose-summary.json"),
```

Then extend `ensureRunDirs()`:

```js
  mkdirSync(paths.composeDir, { recursive: true });
```

- [ ] **Step 4: Add minimal compose schemas**

In `scripts/lib/schemas.mjs`, add small V1 schemas for the compose decision/report artifacts:

```js
const ComposeDecisionV1 = z.object({
  schemaVersion: z.literal(1),
  requestIntent: z.object({
    targetState: z.string().min(1),
    mustKeep: z.array(z.string()).default([]),
    maySkip: z.array(z.string()).default([]),
    requiresData: z.boolean().default(false)
  }).passthrough(),
  candidateHints: z.object({
    preferredSegments: z.array(z.number()).default([]),
    stopAfterSegment: z.number().int().nonnegative().optional()
  }).passthrough(),
  notes: z.array(z.string()).default([])
}).passthrough();

const ComposeSummaryV1 = z.object({
  schemaVersion: z.literal(1),
  primaryRunId: z.string().min(1),
  sourceRuns: z.array(z.string().min(1)),
  status: z.enum(["planned", "composed", "broken"]),
  blockedReason: z.enum(["none", "unreachable_goal", "policy_blocked", "graph_disconnect"]).default("none")
}).passthrough();
```

Export parse helpers in the same style as existing artifacts.

- [ ] **Step 5: Implement the minimal command surface**

Create `scripts/commands/compose.mjs`:

```js
import { getStringOption } from "../lib/args.mjs";
import { ensureRunDirs } from "../lib/config.mjs";

export async function composeCommand(options) {
  const runId = getStringOption(options, "run-id", "");
  if (!runId) throw new Error("compose requires --run-id.");
  const request = getStringOption(options, "request", "");
  if (!request) throw new Error("compose requires --request.");

  const paths = ensureRunDirs(runId);
  return {
    ok: true,
    primaryRunId: runId,
    request,
    composeDir: paths.composeDir
  };
}
```

In `scripts/cli-main.mjs`, wire it in:

```js
import { composeCommand } from "./commands/compose.mjs";
```

Add to help text:

```text
  compose   Build a derived workflow from a primary run via reuse + live learning
```

Add the command branch:

```js
  if (command === "compose") {
    process.stdout.write(`${JSON.stringify(await composeCommand(options), null, 2)}\n`);
    return;
  }
```

- [ ] **Step 6: Run the focused test to verify green**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs
```

Expected: pass.

- [ ] **Step 7: Run the phase eval**

Run:

```bash
node scripts/cli.mjs help
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs
```

Expected:
- help output contains `compose`
- tests pass

- [ ] **Step 8: Backlog self-review**

Check:

```text
[ ] No new durable compose knowledge store was introduced
[ ] Compose artifact paths are purely episodic
[ ] No unrelated CLI command behavior changed
```

If any box cannot be checked, update `tasks/phases/phase-63-composition-agent.md` before commit.

- [ ] **Step 9: Commit**

```bash
git add scripts/commands/compose.mjs scripts/cli-main.mjs scripts/lib/config.mjs scripts/lib/schemas.mjs tests/commands/compose.test.mjs
git commit -m "feat: add compose command surface and artifact scaffolding"
```

## Task 2: Lane B / Phase B1 — Projected View Builder and `composer-agent` Contract

**Files:**
- Create: `scripts/compose/projected-view.mjs`
- Create: `.codex/skills/composer-agent/SKILL.md`
- Test: `tests/compose/projected-view.test.mjs`
- Test: `tests/skill/browser-flow-compose.test.mjs`

**Eval:**
- projected view excludes full workflow history and raw traces
- `composer-agent` contract forbids direct execution/browser actions
- result artifact shape is explicit

**Result:**
- deterministic projected-view builder exists
- internal skill contract exists and is isolated

**Backlog review:**
- Did the projected view need raw telemetry to function? If yes, redesign the projection instead of expanding scope.
- Did the skill try to own safety or execution policy? If yes, move that logic back to code before committing.

- [ ] **Step 1: Write the failing projected-view test**

Create `tests/compose/projected-view.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildComposeProjectedView } from "../../scripts/compose/projected-view.mjs";

test("buildComposeProjectedView keeps only role-scoped fields", () => {
  const view = buildComposeProjectedView({
    request: "keep the first segment and get the result page",
    workflow: {
      id: "run-1",
      steps: [{ action: "goto", selector: "#x", secret: true }],
      inputs: [{ name: "query", type: "text" }],
      segments: [{ range: [0, 0], startPageKey: "p0", endPageKey: "p0", name: "root" }]
    },
    pageGraphSummary: [{ pageKey: "p0", neighbors: ["p1"] }],
    rawTracePath: "/tmp/trace.jsonl"
  });

  assert.equal(view.request, "keep the first segment and get the result page");
  assert.deepEqual(view.workflowSummary.inputs, [{ name: "query", type: "text" }]);
  assert.equal("rawTracePath" in view, false);
  assert.equal("steps" in view.workflowSummary, false);
});
```

Create `tests/skill/browser-flow-compose.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("composer-agent is judgment-only and returns decision artifacts", () => {
  const text = readFileSync(".codex/skills/composer-agent/SKILL.md", "utf8");
  assert.match(text, /You are a compose sub-agent/i);
  assert.match(text, /Do NOT execute browser actions/i);
  assert.match(text, /Return only a structured decision artifact/i);
  assert.doesNotMatch(text, /full orchestrator history/i);
});
```

- [ ] **Step 2: Run the tests to verify red**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/projected-view.test.mjs tests/skill/browser-flow-compose.test.mjs
```

Expected: fail because the module and skill file do not exist yet.

- [ ] **Step 3: Implement the projected-view builder**

Create `scripts/compose/projected-view.mjs`:

```js
export function buildComposeProjectedView({ request, workflow, pageGraphSummary, registrySummary = [] }) {
  return {
    schemaVersion: 1,
    request,
    workflowSummary: {
      id: workflow.id,
      inputs: Array.isArray(workflow.inputs) ? workflow.inputs : [],
      segments: Array.isArray(workflow.segments) ? workflow.segments : []
    },
    pageGraphSummary,
    registrySummary
  };
}
```

- [ ] **Step 4: Write the `composer-agent` contract**

Create `.codex/skills/composer-agent/SKILL.md`:

```md
---
name: composer-agent
description: Convert a natural-language composition request into a structured decision artifact for bf compose. No browser execution.
---

# Composer Agent Skill

## Role

You are a compose sub-agent. You receive a projected compose view and return only a structured decision artifact.

## Constraints

- Do NOT execute browser actions.
- Do NOT decide safety policy.
- Do NOT mutate workflow files directly.
- Do NOT request full orchestrator history.
- Return only a structured decision artifact with request intent, candidate hints, and short notes.
```

- [ ] **Step 5: Run the focused tests to verify green**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/projected-view.test.mjs tests/skill/browser-flow-compose.test.mjs
```

Expected: pass.

- [ ] **Step 6: Run the phase eval**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/projected-view.test.mjs tests/skill/browser-flow-compose.test.mjs
```

Expected: pass with no raw-trace leakage assertions failing.

- [ ] **Step 7: Backlog self-review**

Check:

```text
[ ] The projected view does not contain full workflow steps or raw trace pointers
[ ] The composer-agent contract is judgment-only
[ ] No safety enforcement was delegated to the skill
```

If any box cannot be checked, update `tasks/phases/phase-63-composition-agent.md` before commit.

- [ ] **Step 8: Commit**

```bash
git add scripts/compose/projected-view.mjs .codex/skills/composer-agent/SKILL.md tests/compose/projected-view.test.mjs tests/skill/browser-flow-compose.test.mjs
git commit -m "feat: add compose projected view and agent contract"
```

## Task 3: Lane A / Phase A2 — Candidate Index, Reuse Selection, and Checkpoint Gates

**Files:**
- Create: `scripts/compose/candidate-index.mjs`
- Create: `scripts/compose/reuse-selector.mjs`
- Create: `scripts/compose/checkpoint-gates.mjs`
- Test: `tests/compose/reuse-selector.test.mjs`
- Test: `tests/compose/checkpoint-gates.test.mjs`

**Eval:**
- longer valid reusable prefix wins
- first unresolved boundary is identified
- failed checkpoints halt forward progress

**Result:**
- deterministic reuse/index/checkpoint layer exists

**Backlog review:**
- Did reuse selection require LLM judgment? If yes, split the deterministic and semantic parts more cleanly.
- Did checkpoint logic try to continue after failure? If yes, fix now.

- [ ] **Step 1: Write the failing pure tests**

Create `tests/compose/reuse-selector.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { selectReusablePrefix } from "../../scripts/compose/reuse-selector.mjs";

test("selectReusablePrefix prefers the longest valid prefix", () => {
  const result = selectReusablePrefix({
    segments: [
      { index: 0, name: "root", reusable: true },
      { index: 1, name: "market", reusable: true },
      { index: 2, name: "news", reusable: false }
    ]
  });

  assert.equal(result.reusedUntilSegment, 1);
  assert.equal(result.gapStartsAtSegment, 2);
});
```

Create `tests/compose/checkpoint-gates.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { advanceCheckpoint } from "../../scripts/compose/checkpoint-gates.mjs";

test("advanceCheckpoint halts on failed gate", () => {
  const state = advanceCheckpoint({
    current: "reusable_prefix_selected",
    ok: false,
    blockedReason: "graph_disconnect"
  });

  assert.equal(state.status, "broken");
  assert.equal(state.blockedReason, "graph_disconnect");
  assert.equal(state.next, null);
});
```

- [ ] **Step 2: Run the tests to verify red**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/reuse-selector.test.mjs tests/compose/checkpoint-gates.test.mjs
```

Expected: fail because the modules do not exist yet.

- [ ] **Step 3: Implement the candidate/reuse/checkpoint modules**

Create `scripts/compose/candidate-index.mjs`:

```js
export function buildComposeCandidateIndex({ workflow, registry = [], pageGraph = [] }) {
  return {
    segments: Array.isArray(workflow.segments) ? workflow.segments.map((segment, index) => ({ index, ...segment })) : [],
    registry,
    pageGraph
  };
}
```

Create `scripts/compose/reuse-selector.mjs`:

```js
export function selectReusablePrefix({ segments }) {
  let reusedUntilSegment = -1;
  for (const segment of segments) {
    if (segment.reusable !== true) {
      return {
        reusedUntilSegment,
        gapStartsAtSegment: segment.index
      };
    }
    reusedUntilSegment = segment.index;
  }
  return {
    reusedUntilSegment,
    gapStartsAtSegment: null
  };
}
```

Create `scripts/compose/checkpoint-gates.mjs`:

```js
const ORDER = [
  "request_structured",
  "reusable_prefix_selected",
  "learning_gap_resolved",
  "workflow_generated",
  "verification_passed"
];

export function advanceCheckpoint({ current, ok, blockedReason = "none" }) {
  if (!ok) {
    return { status: "broken", blockedReason, next: null };
  }
  const index = ORDER.indexOf(current);
  return {
    status: "in-progress",
    blockedReason: "none",
    next: index >= 0 && index + 1 < ORDER.length ? ORDER[index + 1] : null
  };
}
```

- [ ] **Step 4: Run the focused tests to verify green**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/reuse-selector.test.mjs tests/compose/checkpoint-gates.test.mjs
```

Expected: pass.

- [ ] **Step 5: Run the phase eval**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/reuse-selector.test.mjs tests/compose/checkpoint-gates.test.mjs
```

Expected: pass with deterministic prefix selection and halt-on-failure behavior.

- [ ] **Step 6: Backlog self-review**

Check:

```text
[ ] Reuse selection remains deterministic
[ ] Checkpoint gates cannot skip past a failed state
[ ] No raw run mutation occurs in these helpers
```

If any box cannot be checked, update `tasks/phases/phase-63-composition-agent.md` before commit.

- [ ] **Step 7: Commit**

```bash
git add scripts/compose/candidate-index.mjs scripts/compose/reuse-selector.mjs scripts/compose/checkpoint-gates.mjs tests/compose/reuse-selector.test.mjs tests/compose/checkpoint-gates.test.mjs
git commit -m "feat: add compose reuse selection and checkpoint gates"
```

## Task 4: Lane A / Phase A3 — Reuse-Only Workflow Assembly and Compose Artifacts

**Files:**
- Create: `scripts/compose/workflow-assembler.mjs`
- Create: `scripts/compose/compose-summary.mjs`
- Modify: `scripts/commands/compose.mjs`
- Test: `tests/compose/workflow-assembler.test.mjs`
- Test: `tests/commands/compose.test.mjs`

**Eval:**
- reuse-only compose produces a derived run
- compose artifacts are written under `compose/`
- composed workflow records `primaryRunId`, `sourceRuns`, and reuse metadata

**Result:**
- derived run creation works without live learning

**Backlog review:**
- Did assembly need to mutate the source run? If yes, stop and fix it now.
- Did summary/report data leak into durable knowledge? If yes, revert and isolate.

- [ ] **Step 1: Add a failing workflow-assembler unit test**

Create `tests/compose/workflow-assembler.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { assembleComposedWorkflow } from "../../scripts/compose/workflow-assembler.mjs";

test("assembleComposedWorkflow stamps provenance on the derived workflow", () => {
  const workflow = assembleComposedWorkflow({
    sourceWorkflow: { id: "r1", steps: [{ action: "goto" }] },
    primaryRunId: "r1",
    selectedSteps: [{ action: "goto" }],
    learnedSteps: [{ action: "click" }]
  });

  assert.equal(workflow.primaryRunId, "r1");
  assert.deepEqual(workflow.sourceRuns, ["r1"]);
  assert.equal(workflow.steps.length, 2);
});
```

- [ ] **Step 2: Extend the command test with a reuse-only happy path**

Append to `tests/commands/compose.test.mjs`:

```js
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";

test("composeCommand writes a derived run for reuse-only composition", async () => {
  const sourceRunId = `compose-source-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, { runId: sourceRunId, fixture: "synthetic", startUrl: "/synthetic" });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [
      { action: "goto", url: "/synthetic", pageKey: "synthetic/root" },
      { action: "click", selector: "[data-bf=\"run\"]", pageKey: "synthetic/root" }
    ],
    segments: [{ range: [0, 1], startPageKey: "synthetic/root", endPageKey: "synthetic/root", name: "root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is" },
    {
      decide: async () => ({
        schemaVersion: 1,
        requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false },
        candidateHints: {},
        notes: []
      }),
      learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
      verifyDerived: async () => ({ ok: true })
    }
  );

  const derivedWorkflow = readJson(result.derivedWorkflowPath);
  assert.equal(derivedWorkflow.primaryRunId, sourceRunId);
  assert.deepEqual(derivedWorkflow.sourceRuns, [sourceRunId]);
});
```

- [ ] **Step 3: Run the tests to verify red**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs
```

Expected: fail because `composeCommand` does not yet assemble a derived run.

- [ ] **Step 4: Implement workflow assembly and summary helpers**

Create `scripts/compose/workflow-assembler.mjs`:

```js
export function assembleComposedWorkflow({ sourceWorkflow, primaryRunId, selectedSteps, learnedSteps = [] }) {
  return {
    ...sourceWorkflow,
    id: `${primaryRunId}-compose-${Date.now()}`,
    primaryRunId,
    sourceRuns: [primaryRunId],
    steps: [...selectedSteps, ...learnedSteps]
  };
}
```

Create `scripts/compose/compose-summary.mjs`:

```js
export function buildComposeSummary({ primaryRunId, sourceRuns, status, blockedReason = "none", reusedSegments = [], learnedSteps = 0 }) {
  return {
    schemaVersion: 1,
    primaryRunId,
    sourceRuns,
    status,
    blockedReason,
    reusedSegments,
    learnedSteps
  };
}
```

- [ ] **Step 5: Upgrade `composeCommand()` to write compose artifacts**

In `scripts/commands/compose.mjs`, switch to dependency-injected orchestration:

```js
import { readJson, writeJson } from "../lib/fs.mjs";
import { getRunPaths, ensureRunDirs } from "../lib/config.mjs";
import { assembleComposedWorkflow } from "../compose/workflow-assembler.mjs";
import { buildComposeSummary } from "../compose/compose-summary.mjs";

function defaultDeps() {
  return {
    decide: async () => ({ schemaVersion: 1, requestIntent: { targetState: "reuse", mustKeep: [], maySkip: [], requiresData: false }, candidateHints: {}, notes: [] }),
    learnGap: async () => ({ status: "not-needed", learnedSteps: [] })
  };
}

export async function composeCommand(options, deps = defaultDeps()) {
  // existing validation...
  const sourcePaths = getRunPaths(runId);
  const sourceWorkflow = readJson(sourcePaths.workflowJsonPath);
  const decision = await deps.decide({ request, sourceWorkflow });
  const derivedRunId = `${runId}-compose`;
  const derivedPaths = ensureRunDirs(derivedRunId);
  const assembled = assembleComposedWorkflow({
    sourceWorkflow,
    primaryRunId: runId,
    selectedSteps: sourceWorkflow.steps,
    learnedSteps: []
  });
  writeJson(derivedPaths.composeRequestPath, { runId, request });
  writeJson(derivedPaths.composePlanPath, decision);
  writeJson(derivedPaths.workflowJsonPath, assembled);
  writeJson(derivedPaths.composeSessionPath, { checkpoint: "workflow_generated", status: "in-progress" });
  writeJson(derivedPaths.composeSummaryPath, buildComposeSummary({
    primaryRunId: runId,
    sourceRuns: [runId],
    status: "planned"
  }));
  return {
    ok: true,
    derivedRunId,
    derivedWorkflowPath: derivedPaths.workflowJsonPath,
    composeSummaryPath: derivedPaths.composeSummaryPath
  };
}
```

- [ ] **Step 6: Run the tests to verify green**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs
```

Expected: pass.

- [ ] **Step 7: Run the phase eval**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs tests/compose/workflow-assembler.test.mjs
```

Expected:
- derived run exists
- source run remains unchanged
- composed workflow has provenance metadata

- [ ] **Step 8: Backlog self-review**

Check:

```text
[ ] Source run remained read-only
[ ] Compose artifacts stayed under the derived run's episodic directory
[ ] The compose summary lives under `reports/` and is still evidence, not durable knowledge
```

If any box cannot be checked, record it as blocking and fix before commit.

- [ ] **Step 9: Commit**

```bash
git add scripts/commands/compose.mjs scripts/compose/workflow-assembler.mjs scripts/compose/compose-summary.mjs tests/commands/compose.test.mjs tests/compose/workflow-assembler.test.mjs
git commit -m "feat: assemble reuse-only compose runs"
```

## Task 5: Lane A / Phase A4 — Live Learning Loop and Policy Hooks

**Files:**
- Create: `scripts/compose/learning-loop.mjs`
- Create: `scripts/compose/policy-hooks.mjs`
- Modify: `scripts/commands/compose.mjs`
- Test: `tests/compose/learning-loop.test.mjs`
- Test: `tests/compose/policy-hooks.test.mjs`

**Eval:**
- a simple gap can be filled through learned `click`/`fill`/`submit` steps
- each learned step is journaled
- disallowed actions return `policy_blocked`

**Result:**
- compose can bridge a gap through interactive learning under policy control

**Backlog review:**
- Did live learning require unrestricted browsing outside the inherited context? If yes, stop and tighten the hooks.
- Did a learned step fail to reconnect without being reported as `graph_disconnect`? If yes, fix now.

- [ ] **Step 1: Write the failing pure learning/policy tests**

Create `tests/compose/policy-hooks.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { assertComposeActionAllowed } from "../../scripts/compose/policy-hooks.mjs";

test("assertComposeActionAllowed blocks irreversible action in public-read mode", () => {
  assert.throws(
    () => assertComposeActionAllowed({
      mode: "public-read",
      action: { action: "click", role: "button", name: "Delete" }
    }),
    /policy_blocked/
  );
});
```

Create `tests/compose/learning-loop.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runLearningLoop } from "../../scripts/compose/learning-loop.mjs";

test("runLearningLoop records learned steps and reconnects when target is found", async () => {
  const result = await runLearningLoop({
    requestIntent: { targetState: "done" },
    observe: async () => ({ pageKey: "p1", affordances: [{ action: "click", name: "Next" }] }),
    choose: async () => ({ action: "click", name: "Next" }),
    execute: async () => ({ pageKey: "p2", step: { action: "click", selector: "[data-bf=\"next\"]", pageKey: "p1" } }),
    reconnect: async () => ({ ok: true, reconnectPageKey: "p2" }),
    appendJournal: async () => {}
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.learnedSteps.length, 1);
  assert.equal(result.reconnectPageKey, "p2");
});
```

- [ ] **Step 2: Run the tests to verify red**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/policy-hooks.test.mjs tests/compose/learning-loop.test.mjs
```

Expected: fail because the modules do not exist yet.

- [ ] **Step 3: Implement policy hooks**

Create `scripts/compose/policy-hooks.mjs`:

```js
import { isIrreversibleText } from "../lib/safety-classify.mjs";

export function assertComposeActionAllowed({ mode, action }) {
  const name = String(action?.name ?? "");
  if (mode === "public-read" && isIrreversibleText(name)) {
    throw new Error("policy_blocked: irreversible action not allowed in public-read compose.");
  }
  return true;
}
```

- [ ] **Step 4: Implement the learning loop**

Create `scripts/compose/learning-loop.mjs`:

```js
export async function runLearningLoop({ requestIntent, observe, choose, execute, reconnect, appendJournal }) {
  const learnedSteps = [];
  while (true) {
    const observation = await observe();
    const nextAction = await choose({ requestIntent, observation, learnedSteps });
    if (!nextAction) {
      return { status: "blocked", blockedReason: "unreachable_goal", learnedSteps };
    }
    const execution = await execute(nextAction);
    learnedSteps.push(execution.step);
    await appendJournal({ type: "learned-step", step: execution.step, pageKey: execution.pageKey });
    const rc = await reconnect({ requestIntent, observation: execution, learnedSteps });
    if (rc.ok) {
      return { status: "resolved", reconnectPageKey: rc.reconnectPageKey, learnedSteps };
    }
  }
}
```

- [ ] **Step 5: Wire the learning loop into `composeCommand()`**

In `scripts/commands/compose.mjs`, replace the fixed `learnedSteps: []` path with:

```js
  const gap = { needsLearning: decision?.candidateHints?.stopAfterSegment !== undefined };
  const learnResult = gap.needsLearning
    ? await deps.learnGap({
        request,
        decision,
        sourceWorkflow,
        composePaths: derivedPaths
      })
    : { status: "not-needed", learnedSteps: [] };
```

Then use `learnResult.learnedSteps` in `assembleComposedWorkflow()`. On blocked status:

```js
  if (learnResult.status === "blocked") {
    writeJson(derivedPaths.composeSessionPath, {
      checkpoint: "learning_gap_resolved",
      status: "broken",
      blockedReason: learnResult.blockedReason
    });
    return {
      ok: false,
      blockedReason: learnResult.blockedReason,
      derivedRunId
    };
  }
```

- [ ] **Step 6: Run the focused tests to verify green**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/policy-hooks.test.mjs tests/compose/learning-loop.test.mjs tests/commands/compose.test.mjs
```

Expected: pass.

- [ ] **Step 7: Add one fixture-backed integration test**

Extend `tests/commands/compose.test.mjs` with a headless local-fixture scenario using an existing form fixture such as `submit`, where the injected `learnGap` returns a learned `fill` and `submit` step. Assert those actions appear in the derived workflow and in the compose journal.

```js
assert.equal(derivedWorkflow.steps.some((step) => step.action === "fill"), true);
assert.equal(derivedWorkflow.steps.some((step) => step.action === "submit"), true);
```

- [ ] **Step 8: Run the phase eval**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/compose/policy-hooks.test.mjs tests/compose/learning-loop.test.mjs tests/commands/compose.test.mjs
```

Expected:
- blocked actions return `policy_blocked`
- learned steps are recorded
- unresolved learning returns `unreachable_goal` or `graph_disconnect`

- [ ] **Step 9: Backlog self-review**

Check:

```text
[ ] Live learning stayed inside inherited context boundaries
[ ] Every learned step produced a journal entry
[ ] Blocked outcomes are structured, not free-form only
```

If any box cannot be checked, update `tasks/phases/phase-63-composition-agent.md` before commit.

- [ ] **Step 10: Commit**

```bash
git add scripts/compose/learning-loop.mjs scripts/compose/policy-hooks.mjs scripts/commands/compose.mjs tests/compose/learning-loop.test.mjs tests/compose/policy-hooks.test.mjs tests/commands/compose.test.mjs
git commit -m "feat: add compose live learning and policy hooks"
```

## Task 6: Lane A / Phase A5 — Real Generate/Verify Integration and Final Runtime Truthfulness

**Files:**
- Modify: `scripts/commands/compose.mjs`
- Modify: `scripts/compose/compose-summary.mjs`
- Test: `tests/commands/compose.test.mjs`
- Test: `tests/e2e/compose.test.mjs`

**Eval:**
- compose success requires real generation and verification
- `compose succeeded` is impossible when verification/security are not green
- broken categories surface in the summary report

**Result:**
- compose runtime reaches truthful terminal states

**Backlog review:**
- Did this phase require changing `generate-runner` or `verify-run` semantics? If yes, record why and isolate the change.
- Did any direct success path bypass real verification/security results? If yes, remove it before commit.

- [ ] **Step 1: Add a failing e2e test for truthful success**

Create `tests/e2e/compose.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { composeCommand } from "../../scripts/commands/compose.mjs";

test("composeCommand reports success only after generate and verify succeed", async () => {
  const sourceRunId = `compose-e2e-${Date.now()}`;
  const sourcePaths = ensureRunDirs(sourceRunId);
  writeJson(sourcePaths.manifestPath, { runId: sourceRunId, fixture: "synthetic", startUrl: "/synthetic" });
  writeJson(sourcePaths.workflowJsonPath, {
    schemaVersion: 1,
    id: sourceRunId,
    fixture: "synthetic",
    startUrl: "/synthetic",
    finalUrl: "/synthetic/result",
    steps: [{ action: "goto", url: "/synthetic", pageKey: "synthetic/root" }],
    verification: { expectedFinalUrl: "/synthetic/result" },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  });

  const result = await composeCommand(
    { "run-id": sourceRunId, request: "reuse the flow as-is" },
    {
      decide: async () => ({ schemaVersion: 1, requestIntent: { targetState: "result", mustKeep: [], maySkip: [], requiresData: false }, candidateHints: {}, notes: [] }),
      learnGap: async () => ({ status: "not-needed", learnedSteps: [] }),
      generateDerived: async () => ({ runnerPath: "/tmp/runner.mjs" }),
      verifyDerived: async () => ({ ok: true, verification: { success: true }, security: { ok: true } })
    }
  );

  assert.equal(result.ok, true);
  const summary = readJson(result.composeSummaryPath);
  assert.equal(summary.status, "composed");
  assert.equal(summary.blockedReason, "none");
});
```

- [ ] **Step 2: Run the e2e test to verify red**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/e2e/compose.test.mjs
```

Expected: fail because compose does not yet derive success from real generation and verification.

- [ ] **Step 3: Integrate real injected generate/verify calls**

In `scripts/commands/compose.mjs`, after writing the composed workflow, add:

```js
  const generation = await deps.generateDerived({
    derivedRunId,
    derivedPaths
  });

  const verification = await deps.verifyDerived({
    derivedRunId,
    derivedPaths,
    runnerPath: generation.runnerPath
  });

  const success = verification.ok === true &&
    verification.verification?.success === true &&
    verification.security?.ok === true;
```

Default dependency implementation should wrap the real runtime surfaces:

```js
import { generateRunner } from "../generate/generate-runner.mjs";
import { verifyRun } from "../verify/verify-run.mjs";

function defaultDeps() {
  return {
    // existing decide / learnGap ...
    generateDerived: async ({ derivedRunId }) => generateRunner(derivedRunId),
    verifyDerived: async ({ derivedRunId }) => verifyRun(derivedRunId)
  };
}
```

Update the summary write:

```js
  const summary = buildComposeSummary({
    primaryRunId: runId,
    sourceRuns: [runId],
    status: success ? "composed" : "broken",
    blockedReason: success ? "none" : (verification.blockedReason ?? "graph_disconnect"),
    reusedSegments: selectedSegmentIndexes,
    learnedSteps: learnResult.learnedSteps.length
  });
  writeJson(derivedPaths.composeSummaryPath, summary);
  return {
    ok: success,
    derivedRunId,
    derivedWorkflowPath: derivedPaths.workflowJsonPath,
    composeSummaryPath: derivedPaths.composeSummaryPath,
    blockedReason: summary.blockedReason
  };
```

- [ ] **Step 4: Run the focused tests to verify green**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs tests/e2e/compose.test.mjs
```

Expected: pass.

- [ ] **Step 5: Run the phase eval**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs tests/compose/*.test.mjs tests/e2e/compose.test.mjs
```

Expected:
- all compose-focused tests pass
- compose success is derived from real generation and verification

- [ ] **Step 6: Backlog self-review**

Check:

```text
[ ] Success is impossible without real verification and security success
[ ] Broken reasons still preserve `policy_blocked`, `unreachable_goal`, and `graph_disconnect`
[ ] Compose summary status comes only from real generation and verification results
```

If any box cannot be checked, fix before commit.

- [ ] **Step 7: Commit**

```bash
git add scripts/commands/compose.mjs scripts/compose/compose-summary.mjs tests/commands/compose.test.mjs tests/e2e/compose.test.mjs
git commit -m "feat: integrate compose with generate and verify"
```

## Task 7: Lane C / Phase C1 — Public Prompt, README, Roadmap, and Backlog Surface

**Files:**
- Modify: `.codex/skills/browser-flow/prompt.md`
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs`
- Modify: `README.md`
- Modify: `docs/roadmap.md`
- Modify: `tasks/phases/phase-63-composition-agent.md`
- Test: `tests/skill/browser-flow-compose.test.mjs`

**Eval:**
- public docs mention primary-run-only v1, integrated live learning, and multi-run deferral
- skill validator prevents prompt regressions on those points
- phase backlog explicitly carries multi-run follow-ups

**Result:**
- user-visible and agent-visible docs match the implemented v1 boundary

**Backlog review:**
- Did documentation promise multi-run support? If yes, fix it before commit.
- Did prompt wording imply safety is prompt-enforced? If yes, move it back to code wording and validator.

- [ ] **Step 1: Add failing doc/prompt tests**

Extend `tests/skill/browser-flow-compose.test.mjs`:

```js
test("public browser-flow prompt describes compose as primary-run live learning only", () => {
  const prompt = readFileSync(".codex/skills/browser-flow/prompt.md", "utf8");
  assert.match(prompt, /bf compose/i);
  assert.match(prompt, /requires --run-id/i);
  assert.match(prompt, /interactive live learning/i);
  assert.match(prompt, /multi-run compose is deferred/i);
});

test("README documents compose v1 boundaries", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /bf compose/i);
  assert.match(readme, /primary run/i);
  assert.match(readme, /multi-run compose.*deferred/i);
});
```

- [ ] **Step 2: Run the tests to verify red**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/skill/browser-flow-compose.test.mjs
```

Expected: fail because the public docs do not mention compose yet.

- [ ] **Step 3: Update the public skill prompt and validator**

In `.codex/skills/browser-flow/prompt.md`, add a compose section that states:

```md
- `bf compose --run-id <id> --request "<goal>"` builds a derived workflow from one primary run.
- v1 may use interactive live learning to fill a gap.
- v1 does not compose across multiple source runs.
```

In `.codex/skills/browser-flow/scripts/validate-skill.mjs`, add prompt contract checks:

```js
if (!/bf compose --run-id <id> --request/i.test(promptText)) {
  throw new Error("prompt.md must document bf compose primary-run entry surface.");
}
if (!/interactive live learning/i.test(promptText)) {
  throw new Error("prompt.md must state that compose v1 may perform interactive live learning.");
}
if (!/multi-run compose is deferred/i.test(promptText)) {
  throw new Error("prompt.md must state that multi-run compose is deferred in v1.");
}
```

- [ ] **Step 4: Update README, roadmap, and phase backlog**

In `README.md`, add a short `bf compose` section:

```md
`bf compose --run-id <primaryRunId> --request "<goal>"` builds a derived workflow from one primary run. The runtime reuses existing segments first and may perform interactive live learning to fill a missing gap. v1 is primary-run only; multi-run composition is deferred.
```

In `docs/roadmap.md`, add a backlog bullet under Phase 63 follow-ups:

```md
- Multi-run compose: merge candidate segments from multiple source runs after v1 stabilizes.
- Cross-run security context merge policy: decide how mixed auth/profile contexts may compose.
```

In `tasks/phases/phase-63-composition-agent.md`, append to `## Result Log`:

```md
- v1 boundary fixed: primary-run only, interactive live learning included, multi-run deferred to backlog.
```

- [ ] **Step 5: Run the focused tests to verify green**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/skill/browser-flow-compose.test.mjs
npm run validate-skill
```

Expected: both pass.

- [ ] **Step 6: Run the phase eval**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/skill/browser-flow-compose.test.mjs
npm run validate-skill
```

Expected:
- prompt and README assertions pass
- validator enforces the compose wording

- [ ] **Step 7: Backlog self-review**

Check:

```text
[ ] Public docs state primary-run-only v1 explicitly
[ ] Multi-run remains backlog, not implied feature scope
[ ] Prompt text does not imply prompt-only safety enforcement
```

If any box cannot be checked, fix before commit.

- [ ] **Step 8: Commit**

```bash
git add .codex/skills/browser-flow/prompt.md .codex/skills/browser-flow/scripts/validate-skill.mjs README.md docs/roadmap.md tasks/phases/phase-63-composition-agent.md tests/skill/browser-flow-compose.test.mjs
git commit -m "docs: describe compose v1 boundary and backlog"
```

## Task 8: Lane A / Final Integration — Bundle Sync, Regression Sweep, and Lane Merge Review

**Files:**
- Modify: any merge-conflict resolutions across previous tasks
- Run: bundle sync / verification commands

**Eval:**
- compose tests pass together
- skill validator passes
- bundle build passes
- backlog self-review says no deferred issue now blocks ship of v1

**Result:**
- integrated branch is ready for implementation completion review

**Backlog review:**
- Does any deferred issue now change the truth of README/prompt/summary wording?
- Did any lane introduce overlapping write scope or hidden dependency?

- [ ] **Step 1: Merge or rebase lane branches**

Run:

```bash
git rebase main
```

or, if using isolated worktrees/branches, merge them back in the agreed order:

```bash
git merge <lane-b-branch>
git merge <lane-c-branch>
```

Resolve conflicts conservatively; do not change runtime semantics without updating tests.

- [ ] **Step 2: Run the full targeted regression sweep**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/commands/compose.test.mjs tests/compose/*.test.mjs tests/e2e/compose.test.mjs tests/skill/browser-flow-compose.test.mjs
npm run validate-skill
```

Expected: all pass.

- [ ] **Step 3: Sync the bundle/runtime surface**

Run:

```bash
node scripts/publish/build-bundle.mjs
```

Expected: bundle sync completes without validation failure.

- [ ] **Step 4: Run the final backlog regression self-review**

Check:

```text
[ ] No deferred issue invalidates the primary-run-only v1 promise
[ ] No deferred issue invalidates live-learning safety boundaries
[ ] Multi-run remains a backlog item, not a silent partial implementation
[ ] Derived-run provenance (`primaryRunId`, `sourceRuns`) is preserved everywhere it must be
```

If any box cannot be checked, fix it now and rerun the regression sweep.

- [ ] **Step 5: Commit the integration result**

```bash
git add .
git commit -m "feat: finalize compose live-learning rollout"
```

## Execution order

1. Run `Task 1` first. No other task starts before it lands.
2. After `Task 1`, run:
   - `Task 2` in `Lane B`
   - `Task 3` in `Lane A`
3. After `Task 3`, continue `Task 4`, `Task 5`, `Task 6` serially in `Lane A`.
4. After `Task 4` lands, `Task 7` may run in `Lane C` in parallel with `Task 5` or `Task 6`.
5. Finish with `Task 8` after all lanes are merged.

## Stop conditions

Stop and replan before any further code change if:

- `Task 5` proves that interactive live learning cannot be implemented without violating inherited context boundaries
- `Task 6` proves that real generate/verify integration requires a change in global verification semantics
- `Task 7` reveals that the public prompt or README cannot truthfully describe the implemented runtime
