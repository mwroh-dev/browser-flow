# Phase 78 — Self-Cleaning Verify (⑤) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** verify leaves no residue. Sandbox-first (operate in an operator-arranged test space when available); else create identifiable **test-dummy** data (`__bf_test__<hash>`), run the flow, tear it down (Phase 77), with idempotent orphan recovery. Prove it with a create→run→teardown e2e that leaves the store byte-clean.

**Architecture:** `dummy-naming.mjs` (generate/identify/find dummies). compile populates `workflow.safety.sandbox` from verify-spec (mirror Phase 75.6 connector). verify-run dummy-substitutes text inputs (reuse Phase 61 `bindInputs`) when no sandbox. Teardown execution exists (Phase 77 runner). New stateful fixture (create/list/delete store) is the self-cleaning regression gate. Builds on Phase 61 (`bindInputs`/`bindingsShortHash`), Phase 73 (`safety.sandbox`), Phase 77 (teardown exec).

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test` (`--import=./tests/_setup.mjs`), TS strict + checkJs (keep `npm run check` GREEN).

**Spec:** `docs/superpowers/specs/2026-05-20-human-in-loop-verify-design.md` §⑤.

**Note (largest phase):** 6 tasks; 78.4 adds a new fixture (the self-cleaning proof). Sandbox-first vs dummy-fallback priority: sandbox when `safety.sandbox.available`, else dummy+teardown.

---

## File Structure

- Create: `scripts/lib/dummy-naming.mjs` — `generateDummyName`/`isDummyName`/`findDummies`
- Modify: `scripts/analyze/compile.mjs` — populate `workflow.safety.sandbox` from verify-spec
- Modify: `scripts/verify/verify-run.mjs` — dummy-substitute inputs when no sandbox; orphan sweep
- Modify: `scripts/fixtures/site-server.mjs` — new `selfclean` fixture (create/list/delete store)
- Modify: `scripts/lib/dummy-naming.mjs` + verify — idempotent orphan recovery
- Tests: `tests/lib/dummy-naming.test.mjs`, `tests/analyze/compile.test.mjs` add, `tests/e2e/verify-self-cleaning.test.mjs`

---

## Task 78.1: dummy-naming lib

**Files:** Create `scripts/lib/dummy-naming.mjs`; Test `tests/lib/dummy-naming.test.mjs`

- [ ] **Step 1: failing test**
```js
import test from "node:test";
import assert from "node:assert/strict";
import { generateDummyName, isDummyName, findDummies } from "../../scripts/lib/dummy-naming.mjs";

test("generateDummyName = prefix + hash (human-readable + searchable), unique", () => {
  const a = generateDummyName("__bf_test__", 8);
  const b = generateDummyName("__bf_test__", 8);
  assert.match(a, /^__bf_test__[0-9a-f]{8}$/);
  assert.notEqual(a, b); // unique per call
  assert.ok(isDummyName(a, "__bf_test__"));
  assert.ok(!isDummyName("real-notebook", "__bf_test__"));
});

test("findDummies returns only names matching the prefix (orphan recovery)", () => {
  const names = ["real-1", "__bf_test__aaaa1111", "note", "__bf_test__bbbb2222"];
  assert.deepEqual(findDummies(names, "__bf_test__").sort(), ["__bf_test__aaaa1111", "__bf_test__bbbb2222"]);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement `scripts/lib/dummy-naming.mjs`**
```js
import { randomBytes } from "node:crypto";

/**
 * Generate an identifiable test-dummy name: human-readable prefix +
 * agent-searchable hex hash. Unique per call (random) so concurrent
 * verifies don't collide; the prefix makes orphans findable for cleanup.
 * @param {string} prefix @param {number} hashLen @returns {string}
 */
export function generateDummyName(prefix, hashLen) {
  const hex = randomBytes(Math.ceil(hashLen / 2)).toString("hex").slice(0, hashLen);
  return `${prefix}${hex}`;
}

/** @param {string} name @param {string} prefix @returns {boolean} */
export function isDummyName(name, prefix) {
  return typeof name === "string" && name.startsWith(prefix);
}

/** @param {string[]} names @param {string} prefix @returns {string[]} */
export function findDummies(names, prefix) {
  return names.filter((n) => isDummyName(n, prefix));
}
```

- [ ] **Step 4: run, expect pass.**

- [ ] **Step 5: commit** — `phase 78: dummy-naming lib (prefix+hash, isDummyName, findDummies)`

## Task 78.2: compile populates safety.sandbox from verify-spec

**Files:** Modify `scripts/analyze/compile.mjs`; Test `tests/analyze/compile.test.mjs`

- [ ] **Step 1: failing test** — run with verify-spec `answers["sandbox-available"]` = a location string (e.g. "/tmp/sandbox" or "yes: testfolder") → compiled `workflow.safety.sandbox` = `{available:true, location:<parsed>}`. Falsy ("no"/"n"/""/absent) → `{available:false, location:null}` (the existing scaffold).
- [ ] **Step 2: run, expect fail.**
- [ ] **Step 3: implement** — mirror the Phase 75.6 `isLoginRequiredTruthy`/`deriveLoginSite` pattern: add `parseSandboxAnswer(value)` → `{available, location}`. Truthy rule: same falsy set as login (no/n/false/empty). location = the answer string minus a leading "yes"/"y" token, trimmed, or null. Set `workflow.safety.sandbox` from it when verify-spec present; else keep scaffold `{available:false, location:null}`.
- [ ] **Step 4: run, expect pass; `npm run check` → 0** (bundled fixtures: no verify-spec → scaffold unchanged).
- [ ] **Step 5: commit** — `phase 78: compile populates safety.sandbox from verify-spec sandbox-available`

## Task 78.3: verify dummy-substitutes inputs when no sandbox

**Files:** Modify `scripts/verify/verify-run.mjs`; Test `tests/verify/`

- [ ] **Step 1: failing test** — a workflow with `inputs[]` (text type) + `safety.sandbox.available=false` + a teardown: when `verifyRun` runs in self-cleaning mode, the runner receives a workflow whose bound text-input values are dummy names (`__bf_test__…`). When `safety.sandbox.available=true`, NO dummy substitution (operate in sandbox as captured). Stub the runner to capture the workflow it received; assert input values.
- [ ] **Step 2: run, expect fail.**
- [ ] **Step 3: implement** — in verify-run, before invoking the runner: if `workflow.safety?.sandbox?.available !== true` AND `workflow.inputs?.length`, build dummy bindings (`{ [input.name]: generateDummyName(workflow.teardown?.dummyNaming?.prefix ?? "__bf_test__", 8) }` for text-type inputs) and apply via `bindInputs(workflow, bindings)` (Phase 61, from workflow-inputs.mjs). Pass the bound workflow to the runner. When sandbox available, skip substitution (the operator's sandbox absorbs real values). Record the dummy bindings in the report (names only — they're not secret) so teardown/orphan-sweep can find them.
- [ ] **Step 4: run, expect pass; `npm run check` → 0** (bundled fixtures have no inputs/teardown → no substitution → e2e unchanged).
- [ ] **Step 5: commit** — `phase 78: verify dummy-substitutes text inputs when no sandbox (reuses bindInputs)`

## Task 78.4: self-cleaning e2e (create→run→teardown leaves store clean)

**Files:** Modify `scripts/fixtures/site-server.mjs` (new `selfclean` fixture); Create `tests/e2e/verify-self-cleaning.test.mjs`

- [ ] **Step 1: design the fixture** — add a `selfclean` route set to `site-server.mjs` with an in-memory store:
  - `GET /selfclean` — page with a name input + "Create" button + a list of items + per-item "Delete" button.
  - `POST /api/selfclean/create` (name) → adds item to the store.
  - `POST /api/selfclean/delete` (name) → removes item.
  - `GET /api/selfclean/list` → returns current items (for the test to assert clean).
  Keep it minimal — the store is a module-level array reset per server start.
- [ ] **Step 2: failing e2e test** — `tests/e2e/verify-self-cleaning.test.mjs`:
  - capture-equivalent: build a workflow.json with forward steps (fill name = input, click Create) + teardown.steps (fill name, click Delete) + `inputs:[{name:"itemName", type:"text", ...}]` + `safety.sandbox.available=false`.
  - snapshot store via `/api/selfclean/list` (should be empty).
  - run `verifyRun` (which dummy-substitutes itemName → `__bf_test__…`, runs forward [creates dummy] → teardown [deletes dummy]).
  - assert: after verify, `/api/selfclean/list` is empty again (store byte-clean — the dummy was created then removed). `teardownComplete === true`.
- [ ] **Step 3: run, expect fail** (fixture/wiring missing).
- [ ] **Step 4: implement the fixture + any verify wiring; run, expect pass.**
- [ ] **Step 5: `npm run check` → 0; commit** — `phase 78: self-cleaning e2e — create→run→teardown leaves store clean (selfclean fixture)`

## Task 78.5: idempotent orphan recovery

**Files:** Modify `scripts/verify/verify-run.mjs` (+ `dummy-naming.mjs` if a helper helps); Test `tests/verify/` or extend the e2e

- [ ] **Step 1: failing test** — simulate a prior failed teardown that left an orphan dummy in the store; on the next `verifyRun`, before/after the run, an orphan sweep finds dummies by prefix (`findDummies`) and removes them (via the teardown delete path), so the store ends clean even after a prior crash. (Use the selfclean fixture; pre-seed an orphan `__bf_test__dead` via `/api/selfclean/create`.)
- [ ] **Step 2: run, expect fail.**
- [ ] **Step 3: implement** — after teardown (or as a pre-run sweep), query the store/page for names matching the dummy prefix and delete any leftovers. Concretely: the teardown phase already deletes the just-created dummy; add an orphan sweep that lists current dummies (via the fixture's list or DOM) and removes any with the prefix. Keep it best-effort + recorded (not throwing). Document that real-site orphan sweep depends on a listable surface (graph/DOM) — for the fixture it's `/api/selfclean/list`.
- [ ] **Step 4: run, expect pass; `npm run check` → 0.**
- [ ] **Step 5: commit** — `phase 78: idempotent orphan recovery (findDummies sweep removes leftover test-dummies)`

## Task 78.6: Phase 78 doc

**Files:** Create `tasks/phases/phase-78-self-cleaning.md`

- [ ] **Step 1: write** (phase-doc; quote operator: "유저에게 sandbox, playground 에 대해서 세팅을 권고 하는것이 1차적인 목표" + "네이밍은 인간적으로 알아보면서 동시에 agent 에게 검색이 잘되는것을 섞어야함. prefix 가 될수도 잇고 hash값이 될수도있고"). Document: sandbox-first / dummy-fallback, dummy naming, create→run→teardown lifecycle, idempotent orphan recovery, the selfclean e2e as regression gate.
- [ ] **Step 2: commit** — `phase 78 plan doc — self-cleaning verify (sandbox/dummy + lifecycle + orphan recovery)`

---

## Self-Review

- **Spec §⑤ coverage:** dummy naming prefix+hash (78.1) ✓, sandbox-first connector (78.2) ✓, dummy substitution when no sandbox (78.3) ✓, create→run→teardown leaves clean (78.4 e2e) ✓, idempotent orphan recovery (78.5) ✓.
- **Placeholder scan:** 78.1 complete code; 78.2/78.3/78.5 reference established patterns (75.6 connector, bindInputs, findDummies) — implementer matches; 78.4 fixture is designed inline (store + 3 routes). 78.6 doc.
- **Type consistency:** `generateDummyName(prefix,hashLen)`/`isDummyName(name,prefix)`/`findDummies(names,prefix)` consistent (78.1/78.3/78.5). `safety.sandbox{available,location}` matches Phase 73 schema (78.2). Reuses `bindInputs` (Phase 61) in 78.3.
- **Sandbox-first vs dummy:** 78.3 substitutes dummies ONLY when `sandbox.available !== true`. Documented.
- **Governance:** phase doc 78 → delta 78-76=2 (< 5) → no constraint review. (Phase 79 → delta 3; constraint review next at 81, eval audit at 82.)

## Execution Handoff

Execute via subagent-driven-development, 78.1 → 78.6. 78.4 (fixture + e2e) is the load-bearing self-cleaning proof. Phase 79 (search teardown; BFS north-star) detailed after 78 lands. After 79, the full feature can have a real-site mutating e2e (now safe — self-cleaning exists).
