# Human-in-Loop Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add human-in-loop bookends around the capture pipeline so real-site captures become safely + reproducibly verifiable — front: a verifiable-spec questionnaire; back: auth-bootstrapped, self-cleaning verify.

**Architecture:** Spec source of truth is `docs/superpowers/specs/2026-05-20-human-in-loop-verify-design.md`. Six components (① questionnaire / ② auth / ③ teardown / ④ safety / ⑤ self-cleaning / ⑥ data-model) build on existing assets (Phase 61 variable-agent, Phase 36 page-node graph, generate-runner `replayProfileDir` hook, security `secretRef` redaction, NODE_TEST_CONTEXT test guard). Implemented as project phases 73-79 in dependency order.

**Tech Stack:** Node ESM `.mjs`, Zod (`scripts/lib/schemas.mjs`), `node --test` (concurrency=1, `--import=./tests/_setup.mjs`), TypeScript strict + JSDoc checkJs (must stay GREEN — `npm run check`), OS keychain via macOS `security` CLI (mocked in tests).

**Scope note:** The operator chose one spec for the whole feature. This plan details **Phase 73 (data model)** in full TDD; **Phases 74-79** are sequenced outlines (goal / files / spec-ref / dependency / governance) to be expanded into full TDD plans when each phase is reached — later interfaces depend on earlier ones and would be speculative if written now. Each phase produces working, tested software on its own.

**Governance:** `.governance/state.json` at plan time: `last_constraint_review_phase=71`, `last_eval_audit_phase=72`, max phase doc = 72. Constraint review fires at phase doc 76 (delta 76-71=5) — **Phase 76 includes a constraint-review task**. Eval audit fires at phase 82 (not reached this plan).

---

## File Structure (all 6 components)

**New files:**
- `knowledge/verify-spec/questions.base.json` — canonical question dataset (committed)
- `scripts/lib/verify-spec.mjs` — base⊕override merge + verify-spec read/write
- `scripts/lib/spec-agent.mjs` — gap detection (raw request vs question set)
- `scripts/lib/keychain.mjs` — OS keychain session read/write boundary (mockable)
- `scripts/lib/safety-classify.mjs` — irreversible-op classification
- `scripts/lib/teardown.mjs` — teardown step derivation (record inverse / search)
- `scripts/commands/spec.mjs` — `bf spec` CLI (front questionnaire)
- `tests/lib/verify-spec.test.mjs`, `tests/lib/spec-agent.test.mjs`, `tests/lib/keychain.test.mjs`, `tests/lib/safety-classify.test.mjs`, `tests/lib/teardown.test.mjs`, `tests/commands/spec.test.mjs`, `tests/e2e/verify-self-cleaning.test.mjs`

**Modified files:**
- `scripts/lib/schemas.mjs` — extend WorkflowV1 with optional `preconditions`/`teardown`/`safety`
- `scripts/analyze/compile.mjs:259-291` — populate the new fields
- `scripts/lib/config.mjs` — `verify-spec` path helpers + env override
- `scripts/generate/generate-runner.mjs` — accept `sessionState` injection in `runWorkflow`
- `scripts/verify/verify-run.mjs` — first/repeat modes, session injection, teardown, consent gate
- `scripts/cli.mjs` — register `bf spec`

---

## Phase 73 — Data-model extensions (⑥) [FULL DETAIL]

Foundation: workflow.json gains optional `preconditions[]`, `teardown`, `safety`. All additive-optional (older workflow.json stays valid, like Phase 61b inputs/segments). No behavior change yet — later phases populate/consume.

### Task 73.1: Zod schemas for the three new fields

**Files:**
- Modify: `scripts/lib/schemas.mjs` (near WorkflowV1, ~line 70-103)
- Test: `tests/lib/schemas.test.mjs`

- [ ] **Step 1: failing test**

Add to `tests/lib/schemas.test.mjs`:
```js
test("WorkflowArtifact accepts optional preconditions/teardown/safety", () => {
  const doc = {
    schemaVersion: 1,
    fixture: "manual",
    startUrl: "https://example.com",
    steps: [{ action: "goto", url: "https://example.com" }],
    preconditions: [
      { kind: "login", site: "example.com", authMode: "human-bootstrap+keychain-session", sessionRef: "kc:example" }
    ],
    teardown: { strategy: "record", steps: [], dummyNaming: { prefix: "__bf_test__", hashLen: 8 } },
    safety: { irreversibleStepIndexes: [2], consentRequired: true, sandbox: { available: false, location: null } }
  };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.preconditions[0].kind, "login");
  assert.equal(result.teardown.strategy, "record");
  assert.equal(result.safety.consentRequired, true);
});

test("WorkflowArtifact still accepts a doc with none of the new fields (additive-optional)", () => {
  const doc = { schemaVersion: 1, fixture: "synthetic", startUrl: "x", steps: [{ action: "goto", url: "x" }] };
  const result = parseWorkflowArtifact(doc, "<test>");
  assert.equal(result.preconditions, undefined);
});
```

- [ ] **Step 2: run, expect fail**

Run: `node --import=./tests/_setup.mjs --test tests/lib/schemas.test.mjs`
Expected: FAIL — `preconditions`/`teardown`/`safety` stripped or rejected.

- [ ] **Step 3: implement schemas**

In `scripts/lib/schemas.mjs`, before `const WorkflowV1`, add:
```js
const WorkflowPrecondition = z
  .object({
    kind: z.literal("login"),
    site: z.string(),
    authMode: z.literal("human-bootstrap+keychain-session"),
    sessionRef: z.string()
  })
  .strict();

const WorkflowTeardown = z
  .object({
    strategy: z.enum(["record", "search", "bfs"]),
    steps: z.array(z.record(z.string(), z.unknown())).default([]),
    dummyNaming: z.object({ prefix: z.string(), hashLen: z.number().int().positive() })
  })
  .strict();

const WorkflowSafety = z
  .object({
    irreversibleStepIndexes: z.array(z.number().int().nonnegative()).default([]),
    consentRequired: z.boolean(),
    sandbox: z.object({ available: z.boolean(), location: z.string().nullable() })
  })
  .strict();
```
Then inside the `WorkflowV1` object (after `segments: z.array(WorkflowSegment).optional()`), add:
```js
    preconditions: z.array(WorkflowPrecondition).optional(),
    teardown: WorkflowTeardown.optional(),
    safety: WorkflowSafety.optional()
```

- [ ] **Step 4: run, expect pass**

Run: `node --import=./tests/_setup.mjs --test tests/lib/schemas.test.mjs`
Expected: PASS (both new tests + existing).

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck > /dev/null 2>&1; echo $?` → 0
```bash
git add scripts/lib/schemas.mjs tests/lib/schemas.test.mjs
git commit -m "phase 73: workflow schema — optional preconditions/teardown/safety (additive)"
```

### Task 73.2: compile.mjs emits empty scaffolds

**Files:**
- Modify: `scripts/analyze/compile.mjs:259-291`
- Test: `tests/analyze/compile.test.mjs`

- [ ] **Step 1: failing test**

Add to `tests/analyze/compile.test.mjs` (use the existing compile fixture pattern in that file; assert on the produced workflow):
```js
test("compile emits safety scaffold (consentRequired false, empty irreversible) by default", () => {
  // <reuse the file's existing helper that runs compile on a fixture run dir
  //  and returns the parsed workflow.json; follow the pattern already in this file>
  const workflow = compileFixtureWorkflow("synthetic"); // existing helper name may differ — match the file
  assert.deepEqual(workflow.safety, { irreversibleStepIndexes: [], consentRequired: false, sandbox: { available: false, location: null } });
  assert.equal(workflow.teardown, undefined); // teardown only set when a strategy is chosen (Phase 74+)
  assert.equal(workflow.preconditions, undefined); // set by spec-agent (Phase 74+)
});
```
Note: match the actual helper in `tests/analyze/compile.test.mjs`. If the file builds the run dir inline, replicate that setup.

- [ ] **Step 2: run, expect fail**

Run: `node --import=./tests/_setup.mjs --test tests/analyze/compile.test.mjs`
Expected: FAIL — `workflow.safety` undefined.

- [ ] **Step 3: implement**

In `scripts/analyze/compile.mjs`, at the `const workflow = {` block (line 259), add a `safety` scaffold field:
```js
    safety: { irreversibleStepIndexes: [], consentRequired: false, sandbox: { available: false, location: null } }
```
Do NOT add `teardown`/`preconditions` here — those are set by the spec-agent / teardown phases (74+). The empty `safety` scaffold establishes the field so downstream phases mutate rather than create.

- [ ] **Step 4: run, expect pass**

Run: `node --import=./tests/_setup.mjs --test tests/analyze/compile.test.mjs`
Expected: PASS.

- [ ] **Step 5: full check + commit**

Run: `npm run check > /dev/null 2>&1; echo $?` → 0
```bash
git add scripts/analyze/compile.mjs tests/analyze/compile.test.mjs
git commit -m "phase 73: compile.mjs emits default safety scaffold in workflow.json"
```

### Task 73.3: verify-spec path helpers (config.mjs)

**Files:**
- Modify: `scripts/lib/config.mjs`
- Test: `tests/lib/config.test.mjs` (create if absent; else add to existing config test)

- [ ] **Step 1: failing test**

```js
test("getVerifySpecPaths returns base + override + per-run paths, override respects env", () => {
  const original = process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
  delete process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
  try {
    const p = getVerifySpecPaths("run-1");
    assert.ok(p.basePath.endsWith("knowledge/verify-spec/questions.base.json"));
    assert.ok(p.overridePath.endsWith("verify-spec/override.json"));
    assert.ok(p.perRunPath.includes("run-1"));
    process.env.BROWSER_FLOW_VERIFY_SPEC_PATH = "/tmp/ov.json";
    assert.equal(getVerifySpecPaths("run-1").overridePath, "/tmp/ov.json");
  } finally {
    if (original === undefined) delete process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
    else process.env.BROWSER_FLOW_VERIFY_SPEC_PATH = original;
  }
});
```

- [ ] **Step 2: run, expect fail** — `getVerifySpecPaths is not a function`.

- [ ] **Step 3: implement** — add to `scripts/lib/config.mjs`:
```js
export function getVerifySpecPaths(runId) {
  const overrideEnv = process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
  return {
    basePath: resolve(repoRoot, "knowledge", "verify-spec", "questions.base.json"),
    overridePath: overrideEnv ? resolve(overrideEnv) : resolve(repoRoot, "verify-spec", "override.json"),
    perRunPath: resolve(getPaths().runsRoot, runId, "verify-spec.json")
  };
}
```
Add `verify-spec/` to `.gitignore` (override is per-user, like profiles/).

- [ ] **Step 4: run, expect pass.**

- [ ] **Step 5: check + commit**
```bash
git add scripts/lib/config.mjs tests/lib/config.test.mjs .gitignore
git commit -m "phase 73: verify-spec path helpers (base committed / override gitignored+env / per-run)"
```

### Task 73.4: Phase 73 plan doc

**Files:**
- Create: `tasks/phases/phase-73-verify-data-model.md`

- [ ] **Step 1: write** — follow the existing `tasks/phases/phase-NN-*.md` format (사용자 원문 quote, 목적, 산출물 table with commits, 테스트 count, Out of scope, Result Log). Quote operator: "결국 인간에게 질의를 통해서 진행" + "verify 가 되기 때문".

- [ ] **Step 2: commit**
```bash
git add tasks/phases/phase-73-verify-data-model.md
git commit -m "phase 73 plan doc — verify data-model extensions (preconditions/teardown/safety)"
```

---

## Phase 74 — verifiable-spec questionnaire (①) [OUTLINE]

**Goal:** Front bookend — gather the verifiable spec, asking only the gaps. Spec §①.
**Files:** `knowledge/verify-spec/questions.base.json` (seed: site-url, login-required, file-location, input-values, teardown-strategy, sandbox-available, irreversible-ops-consent), `scripts/lib/verify-spec.mjs` (base⊕override merge by `id`, base immutable), `scripts/lib/spec-agent.mjs` (gap detection: raw request → answered/missing), `scripts/commands/spec.mjs` (`bf spec --run-id` interactive, reuse `variable-agent-interaction.mjs` `createReadlineAsk`/`createScriptedAsk`), per-run `verify-spec.json` writer.
**Dependency:** Phase 73 (paths + schema). **Reuses:** Phase 61 variable-agent interaction helpers.
**Key tests:** merge never mutates base; gap detection (raw answers → skip, missing → ask); override-only evolution; scripted-ask integration for `bf spec`.
**First task sketch:** Task 74.1 = `loadMergedQuestions(basePath, overridePath)` returns `base ⊕ override` (override replaces/adds by id, base object unchanged) — failing test asserts base file content unchanged after merge + override id wins.

## Phase 75 — auth model (②) [OUTLINE]

**Goal:** First-verify human login → session to keychain → repeat injects session into fresh profile, agent-blind. Spec §②.
**Files:** `scripts/lib/keychain.mjs` (`saveSession(ref, value)` / `readSession(ref)` via macOS `security` CLI, injectable runner for tests), `generate-runner.mjs` `runWorkflow({ sessionState })` → write cookies/storage to the fresh profile via CDP `Network.setCookies` / `Storage` before navigate, `verify-run.mjs` first-vs-repeat branch.
**Dependency:** Phase 73 (preconditions field). **Reuses:** `generate-runner.mjs:194` replayProfileDir hook, `security/` secretRef pattern.
**Key tests:** keychain boundary mocked — assert session value never appears in any artifact or stdout; session-injection unit (cookies land in profile); first→repeat fallback on missing session. Keychain CLI mocked in CI (no real OS keychain).
**First task sketch:** Task 75.1 = `keychain.mjs` with an injectable `exec` runner; test passes a fake exec, asserts `saveSession`/`readSession` round-trip and that the value is base64/opaque (never logged).

## Phase 76 — safety classification + consent (④) + CONSTRAINT REVIEW [OUTLINE]

**Goal:** Classify irreversible steps (financial/security/business: payment/email/external-share), exclude from verify, gate side-effecting replay on operator consent. Spec §④.
**Files:** `scripts/lib/safety-classify.mjs` (keyword/category classifier over step text+selector+url; LLM-assisted classification is an offline skill input, the deterministic layer takes the resulting indexes), `verify-run.mjs` consent gate + skip irreversible indexes, populate `workflow.safety.irreversibleStepIndexes`.
**Dependency:** Phase 73 (safety field), Phase 75 (verify modes).
**Key tests:** classifier flags payment/email/share fixtures, leaves benign clicks; verify skips flagged indexes; consent gate blocks side-effecting replay without consent token.
**⚠️ GOVERNANCE:** phase doc 76 → delta 76-71=5 → constraint review fires. **Include Task 76.N: Constraint Set Review** (follow `tasks/phases/phase-69-constraint-review.md` format, bump `last_constraint_review_phase` 71→76, run `validate-skill`).

## Phase 77 — teardown: record strategy (③ record) [OUTLINE]

**Goal:** Operator records a cleanup demo → inverse segment; verify runs forward then teardown. Spec §③ record.
**Files:** `scripts/lib/teardown.mjs` (`record` strategy: link a cleanup runId's steps as `workflow.teardown.steps`), `verify-run.mjs` runs teardown steps after forward replay, `bf spec` offers strategy choice (record|search).
**Dependency:** Phase 73 (teardown field), Phase 75 (verify), Phase 78 (self-cleaning exec — may co-develop).
**Key tests:** record round-trip (cleanup capture → teardown.steps); verify executes teardown after forward; teardown failure surfaced not swallowed.

## Phase 78 — self-cleaning verify execution (⑤) [OUTLINE]

**Goal:** Sandbox-first; else test-dummy (`__bf_test__<hash>`) create→run→teardown; first-verify human-controlled, repeat automated. Spec §⑤.
**Files:** `scripts/lib/dummy-naming.mjs` (`prefix + hash`, idempotent re-find), `verify-run.mjs` orchestration (first/repeat, sandbox detect, dummy lifecycle), `tests/e2e/verify-self-cleaning.test.mjs` (synthetic create/teardown fixture leaves store clean).
**Dependency:** Phase 75 (auth), 77 (teardown).
**Key tests:** synthetic full bookended loop leaves fixture store clean (deep-equal before/after); dummy idempotent orphan recovery; first vs repeat path.

## Phase 79 — teardown: search strategy (③ search) [OUTLINE]

**Goal:** Declared cleanup intent → search DOM/network/page-node graph for teardown path (LLM-assisted seed of BFS). Spec §③ search. **BFS auto-discovery is north-star, deferred.**
**Files:** `scripts/lib/teardown.mjs` (`search` strategy over `knowledge/pages/` graph), human-verify the discovered teardown on first verify.
**Dependency:** Phase 77 (teardown infra), Phase 36 page-node graph.
**Key tests:** search finds a delete path in a fixture graph that has one; reports unavailable (falls back to record) when none.

---

## Self-Review (Phase 73 detail vs spec)

- **Spec coverage (Phase 73 scope):** ⑥ data-model — `preconditions`/`teardown`/`safety` schemas (73.1) ✓, compile scaffold (73.2) ✓, verify-spec paths (73.3) ✓. Components ①-⑤ covered by outlined Phases 74-79 with spec-section refs.
- **Placeholder scan:** Phase 73 tasks have complete code. Phases 74-79 are explicitly outlines (not placeholder tasks) — each to be expanded into a full TDD plan when reached, per the scope note. The one soft spot: Task 73.2 references `compileFixtureWorkflow` — the implementer MUST match the actual helper name in `tests/analyze/compile.test.mjs` (noted inline).
- **Type consistency:** field names `preconditions`/`teardown`/`safety` and sub-fields (`irreversibleStepIndexes`, `dummyNaming.{prefix,hashLen}`, `sandbox.{available,location}`) are identical across schema (73.1), compile scaffold (73.2), and the spec data-model §⑥. `sessionRef`/`authMode` literals match spec §②.
- **Governance:** constraint review flagged at Phase 76. Eval audit (phase 82) not reached.

## Execution Handoff

Detailed and executable now: **Phase 73**. Phases 74-79 are sequenced outlines; return to writing-plans to expand each when reached (recommended: expand Phase 74 right after Phase 73 lands, since 74 interfaces firm up from 73).
