# Phase 77 — Teardown: record strategy (③ record) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Let the operator record a cleanup demo (the same capture mechanism) and link it as the workflow's teardown; verify then runs the forward replay AND the teardown so it cleans up the data it created. This is the `record` strategy (operator-chosen via verify-spec `teardown-strategy`); `search`/`bfs` are Phase 79+.

**Architecture:** `teardown.mjs` transforms a cleanup capture's steps into `workflow.teardown` (Phase 73 schema). `bf teardown --record` links a cleanup run into a main workflow. The generated runner executes `workflow.teardown.steps` AFTER the forward replay (and after result-evidence capture), via the same atomic-fp/action machinery. verify-run surfaces teardown results. Builds on Phase 73 (`teardown` field), Phase 69 runner (`resolveAtomicFpLocator` + action), Phase 76 (safety) — **teardown bypasses the irreversible-skip** (deletion is the intended cleanup, not a forward-flow risk).

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test` (`--import=./tests/_setup.mjs`), TS strict + checkJs (keep `npm run check` GREEN).

**Spec:** `docs/superpowers/specs/2026-05-20-human-in-loop-verify-design.md` §③ (record).

---

## File Structure

- Create: `scripts/lib/teardown.mjs` — `buildRecordTeardown(cleanupSteps, dummyNaming?)`
- Create: `scripts/commands/teardown.mjs` — `bf teardown --run-id <main> --record <cleanupRunId>`
- Modify: `scripts/cli.mjs` — register `bf teardown`
- Modify: `scripts/generate/generate-runner.mjs` — execute `workflow.teardown.steps` after forward (bypassing irreversible-skip), record `teardownSteps[]`
- Modify: `scripts/verify/verify-run.mjs` — surface teardown results in report
- Tests: `tests/lib/teardown.test.mjs`, `tests/commands/teardown.test.mjs`, `tests/generate/runner.test.mjs` additions

---

## Task 77.1: buildRecordTeardown transform

**Files:** Create `scripts/lib/teardown.mjs`; Test `tests/lib/teardown.test.mjs`

- [ ] **Step 1: failing test**
```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordTeardown } from "../../scripts/lib/teardown.mjs";

test("buildRecordTeardown wraps cleanup steps with record strategy + default dummyNaming", () => {
  const cleanup = [{ action: "click", selector: "button[aria-label='삭제']" }];
  const td = buildRecordTeardown(cleanup);
  assert.equal(td.strategy, "record");
  assert.deepEqual(td.steps, cleanup);
  assert.deepEqual(td.dummyNaming, { prefix: "__bf_test__", hashLen: 8 });
});

test("buildRecordTeardown accepts custom dummyNaming + empty steps", () => {
  const td = buildRecordTeardown([], { prefix: "__x__", hashLen: 4 });
  assert.deepEqual(td.steps, []);
  assert.equal(td.dummyNaming.prefix, "__x__");
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement `scripts/lib/teardown.mjs`**
```js
/**
 * Build a `record`-strategy teardown object from a cleanup capture's steps.
 * The cleanup steps are the operator's recorded "how to remove what the
 * forward flow created" — run by verify AFTER the forward replay.
 *
 * @param {Array<Record<string, unknown>>} cleanupSteps
 * @param {{ prefix: string, hashLen: number }} [dummyNaming]
 * @returns {{ strategy: "record", steps: Array<Record<string, unknown>>, dummyNaming: { prefix: string, hashLen: number } }}
 */
export function buildRecordTeardown(cleanupSteps, dummyNaming) {
  return {
    strategy: "record",
    steps: Array.isArray(cleanupSteps) ? cleanupSteps : [],
    dummyNaming: dummyNaming ?? { prefix: "__bf_test__", hashLen: 8 }
  };
}
```

- [ ] **Step 4: run, expect pass.**

- [ ] **Step 5: commit** — `phase 77: buildRecordTeardown transform (cleanup steps → record teardown)`

## Task 77.2: `bf teardown --record` command

**Files:** Create `scripts/commands/teardown.mjs`; Modify `scripts/cli.mjs`; Test `tests/commands/teardown.test.mjs`

- [ ] **Step 1: failing test** — set up two run dirs: a `cleanup` run with a workflow.json (steps = the delete demo) and a `main` run with a workflow.json. Run `runTeardownCommand({ runId: main, recordFrom: cleanup })`; assert main's workflow.json now has `teardown.strategy==="record"` + `teardown.steps` equal to cleanup's steps. Re-read via `parseWorkflowArtifact` to confirm schema-valid.
```js
test("bf teardown --record links cleanup run's steps into main workflow.teardown", async () => {
  // write main + cleanup workflow.json under their run dirs (getRunPaths)
  // runTeardownCommand({ runId: mainId, recordFrom: cleanupId })
  // re-read main workflow.json → teardown.strategy "record", steps deep-equal cleanup steps
});
```
(Match the run-dir setup pattern from other command tests.)

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement `scripts/commands/teardown.mjs`**
```js
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseWorkflowArtifact } from "../lib/schemas.mjs";
import { buildRecordTeardown } from "../lib/teardown.mjs";

/**
 * @param {{ runId: string, recordFrom: string }} input
 */
export function runTeardownCommand(input) {
  const mainPaths = getRunPaths(input.runId);
  const cleanupPaths = getRunPaths(input.recordFrom);
  const mainWorkflow = readJson(mainPaths.workflowJsonPath);
  const cleanupWorkflow = /** @type {{ steps: Array<Record<string, unknown>> }} */ (readJson(cleanupPaths.workflowJsonPath));
  mainWorkflow.teardown = buildRecordTeardown(cleanupWorkflow.steps);
  const validated = parseWorkflowArtifact(mainWorkflow, mainPaths.workflowJsonPath);
  writeJson(mainPaths.workflowJsonPath, validated);
  return { runId: input.runId, recordedFrom: input.recordFrom, teardownStepCount: validated.teardown.steps.length };
}

/** CLI entry */
export function teardownCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  const recordFrom = getStringOption(options, "record", undefined);
  if (!runId || !recordFrom) throw new Error("bf teardown requires --run-id and --record <cleanupRunId>");
  return runTeardownCommand({ runId, recordFrom });
}
```
Register in `scripts/cli.mjs` (import + help line + `if (command === "teardown") { ... }`). Match `getStringOption` arity used elsewhere (3-arg).

- [ ] **Step 4: run, expect pass; typecheck 0.**

- [ ] **Step 5: commit** — `phase 77: bf teardown --record links cleanup run into main workflow.teardown`

## Task 77.3: runner executes teardown after forward (bypassing irreversible-skip)

**Files:** Modify `scripts/generate/generate-runner.mjs`; Test `tests/generate/runner.test.mjs`

- [ ] **Step 1: failing test** — generated source contains a teardown execution block that iterates `workflow.teardown.steps` AFTER the forward loop + result-evidence, records `teardownSteps[]`, and does NOT apply the irreversible-skip to teardown.
```js
test("generated runner executes workflow.teardown.steps after forward, records teardownSteps", () => {
  const source = generateRunner({ workflow: minimalWorkflow });
  assert.match(source, /workflow\.teardown/);
  assert.match(source, /teardownSteps/);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** — in generate-runner template, AFTER the forward loop + result-evidence capture (~after line 385) and BEFORE the final report build, add:
```js
const teardownSteps = [];
if (workflow.teardown && Array.isArray(workflow.teardown.steps) && workflow.teardown.steps.length > 0) {
  for (const tStep of workflow.teardown.steps) {
    try {
      // teardown bypasses the forward irreversible-skip: deletion here is intended cleanup.
      const { backendNodeId } = await resolveAtomicFpLocator(bs, targetId, tStep);
      await action.clickByBackendNodeId(targetId, backendNodeId);
      teardownSteps.push({ action: tStep.action, ok: true });
    } catch (tErr) {
      teardownSteps.push({ action: tStep.action, ok: false, error: tErr instanceof Error ? tErr.message : String(tErr) });
    }
  }
}
```
Match the template's actual var names (`bs`, `targetId`, `action`, `resolveAtomicFpLocator`). Handle fill/submit teardown actions too if the cleanup capture has them (mirror the forward loop's action dispatch — click/fill/submit). Add `teardownSteps` to the runner's report object (both success + error paths). Teardown failures do NOT fail the verify (record + surface, don't throw) — orphan-recovery is handled by re-run (Phase 78 dummy idempotency).

- [ ] **Step 4: run, expect pass; `npm run check` → 0** (synthetic has no teardown → block skipped → e2e unchanged).

- [ ] **Step 5: commit** — `phase 77: runner executes teardown.steps after forward (bypasses irreversible-skip); records teardownSteps`

## Task 77.4: verify-run surfaces teardown + Phase 77 doc

**Files:** Modify `scripts/verify/verify-run.mjs`; Create `tasks/phases/phase-77-teardown-record.md`; Test `tests/verify/`

- [ ] **Step 1: failing test** — verify report includes `teardownSteps` (propagated from runner) when teardown present.
- [ ] **Step 2: run, expect fail.**
- [ ] **Step 3: implement** — verify-run propagates `teardownSteps` from the runner report into `verification.json` (it likely flows via spread merge already; add explicit handling + a `teardownComplete` boolean = all teardownSteps ok).
- [ ] **Step 4: run, expect pass; `npm run check` → 0.**
- [ ] **Step 5: write `tasks/phases/phase-77-teardown-record.md`** (phase-doc format; quote operator: "1번을 추구하는 사람도 잇을테고 ... 1번의 경우에는 유저에게 녹화를 하라고 해서 하는 즉 지금 우리가 만든 방식으로 되는거고"). Document: record strategy, cleanup capture → teardown link, teardown runs after forward + bypasses irreversible-skip, failures surfaced not thrown.
- [ ] **Step 6: commit** — `phase 77: verify surfaces teardownSteps + Phase 77 plan doc`

---

## Self-Review

- **Spec §③(record) coverage:** transform (77.1) ✓, link command (77.2) ✓, runner execution after forward (77.3) ✓, verify surface (77.4) ✓.
- **Placeholder scan:** 77.1/77.3 complete code; 77.2/77.4 test bodies reference run-dir harness (implementer matches existing pattern — flagged). 77.4 doc.
- **Type consistency:** `buildRecordTeardown(cleanupSteps, dummyNaming?)` → `{strategy,steps,dummyNaming}` matches Phase 73 WorkflowTeardown schema. `teardownSteps[]` shape `{action, ok, error?}` consistent (runner 77.3 → verify 77.4).
- **Safety interaction (load-bearing):** teardown execution BYPASSES `safety.irreversibleStepIndexes` (those index FORWARD steps; teardown is the intended cleanup incl. deletion). Documented in 77.3 + doc.
- **Governance:** phase doc 77 → delta 77-76=1 (< 5) → no constraint review.

## Execution Handoff

Execute via subagent-driven-development, 77.1 → 77.4. Real-site teardown validation (operator records a cleanup demo) is manual; the synthetic/unit tests are the regression gate. Phase 78 (self-cleaning: sandbox/dummy + create→run→teardown lifecycle) detailed after 77 lands.
