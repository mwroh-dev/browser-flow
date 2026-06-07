# Phase 83 — Dependency-graph (variable-binding) + cascade-on-hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Mostly pure libs + a surfacing wire — minimal Chrome.

**Goal:** Give drift-hold (Phase 82) a *dependency analysis* so a held segment's failure cascades only to **data-dependent downstream** segments, while structurally-independent downstream is reported as still-valid — the north-star's "중간 연결고리만 끊김; 뒷 연결고리는 작동" partial degradation.

**Architecture:** Build the planned Phase 63 `dependency-graph.mjs` (1단계: **explicit variable-binding dependency** — segments sharing an `{{input.X}}` reference are data-coupled). On a drift-hold (`heldAtSegment=N`), verify-run computes `affectedSegments` = N plus downstream segments that share an input binding with N (transitively), and surfaces it. URL-identity / element-identity dependency (Phase 63's other two) need richer capture and are deferred. No LLM. No composer-agent (that capability stays out — north-star needs the analysis, not composition).

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test`, TS strict checkJs. No new deps. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-mold-self-healing-automation-design.md` §7 + planned `tasks/phases/phase-63-composition-agent.md` (dependency-graph 1단계).

---

## Decisions locked
1. 1단계 = **variable-binding dependency only** (cleanly detectable from workflow.steps `valueRef` within a segment's range). URL/element-identity deferred (need mold/journal richness).
2. Bias = **independent unless proven dependent** (matches "뒷 연결고리는 작동"). Risk: misses implicit deps → measured after use (Phase 63 discipline).
3. `affectedSegments` is computed at verify-run post-hoc (it has the workflow + heldAtSegment), not in the runner.

---

## File Structure
- Create `scripts/lib/dependency-graph.mjs` — `segmentInputs(workflow)`, `buildDependencyGraph(workflow)`, `affectedByHold(workflow, heldSegmentIndex)`.
- Modify `scripts/lib/schemas.mjs` — `VerificationV1` optional `affectedSegments: number[]`.
- Modify `scripts/verify/verify-run.mjs` — on `heldAtSegment != null`, set `report.affectedSegments`.
- Tests: `tests/lib/dependency-graph.test.mjs`, a verify-run unit/integration assertion.

---

## Task 83.1: dependency-graph lib (variable-binding)
**Files:** Create `scripts/lib/dependency-graph.mjs`; Test `tests/lib/dependency-graph.test.mjs`
- [ ] **Failing test:**
```js
import { segmentInputs, buildDependencyGraph, affectedByHold } from "../../scripts/lib/dependency-graph.mjs";

const wf = {
  steps: [
    { action: "goto" },                                   // seg0
    { action: "fill", valueRef: "{{input.itemName}}" },   // seg0 uses itemName
    { action: "click" },                                  // seg1 (no input)
    { action: "fill", valueRef: "{{input.itemName}}" },   // seg2 uses itemName (shares with seg0)
    { action: "fill", valueRef: "{{input.other}}" }       // seg3 uses other (independent)
  ],
  segments: [
    { range: [0, 1] }, { range: [2, 2] }, { range: [3, 3] }, { range: [4, 4] }
  ]
};

test("segmentInputs maps each segment to the inputs it references", () => {
  assert.deepEqual(segmentInputs(wf), [["itemName"], [], ["itemName"], ["other"]]);
});
test("buildDependencyGraph links segments sharing an input binding", () => {
  const g = buildDependencyGraph(wf);
  // edges undirected-ish: seg0 <-> seg2 share itemName
  assert.ok(g.sharesInput(0, 2));
  assert.ok(!g.sharesInput(0, 1));
  assert.ok(!g.sharesInput(0, 3));
});
test("affectedByHold: held seg0 cascades to downstream sharing its input (seg2), not independent (seg1, seg3)", () => {
  assert.deepEqual(affectedByHold(wf, 0).sort((a, b) => a - b), [0, 2]);
});
test("affectedByHold: a held segment with no inputs affects only itself", () => {
  assert.deepEqual(affectedByHold(wf, 1), [1]);
});
test("tolerates missing segments (single implicit segment)", () => {
  assert.deepEqual(affectedByHold({ steps: [{ action: "goto" }] }, 0), [0]);
});
```
- [ ] **Implement** `dependency-graph.mjs`:
  - `parsePlaceholder(valueRef)` → input name (reuse the regex from `workflow-inputs.mjs` — import or mirror; `{{input.X}}` → "X").
  - `segmentInputs(workflow)`: for each segment, scan `workflow.steps[range[0]..range[1]]` for `valueRef`, collect distinct input names. Fallback to a single segment `[0, steps.length-1]` if no `segments`.
  - `buildDependencyGraph(workflow)`: compute `segmentInputs`; return `{ sharesInput(i, j): boolean }` — true if segments i,j share ≥1 input name.
  - `affectedByHold(workflow, heldIndex)`: start set = `{heldIndex}`; for each downstream segment `m > heldIndex`, include it if it shares an input with ANY segment already in the set (transitive over the held + already-affected). Return sorted array. (Downstream-only: a hold doesn't retroactively invalidate already-completed upstream.)
- [ ] Test pass; `npm run check` GREEN. Commit `phase 83: dependency-graph lib (variable-binding cascade analysis)`.

## Task 83.2: schema field
**Files:** `scripts/lib/schemas.mjs`
- [ ] Add to `VerificationV1` (optional): `affectedSegments: z.array(z.number()).optional()`.
- [ ] `npm run check` GREEN. Commit `phase 83: VerificationV1 affectedSegments field`.

## Task 83.3: verify-run surfaces affectedSegments on hold
**Files:** `scripts/verify/verify-run.mjs`; Test `tests/verify/`
- [ ] **Failing test:** a verify-run unit test (or extend an existing one) where the runner report has `heldAtSegment = N` and the workflow has segments sharing a binding → after verify-run, `report.affectedSegments` = `affectedByHold(workflow, N)`. (If a real-Chrome path is needed, prefer a focused unit that calls the relevant verify-run helper or asserts the merge; otherwise add the assertion to the Phase 82 drift-hold e2e.)
- [ ] **Implement:** in verify-run, after the report is finalized, `if (typeof report.heldAtSegment === "number") { report.affectedSegments = affectedByHold(workflowDoc, report.heldAtSegment); }`. Import `affectedByHold`. (`workflowDoc` is already read in verify-run.)
- [ ] `npm run check` GREEN. Commit `phase 83: verify surfaces affectedSegments (cascade) on drift-hold`.

## Task 83.4: extend drift-hold e2e with cascade assertion (optional real-Chrome)
**Files:** `tests/e2e/verify-drift-hold.test.mjs` (extend) OR a unit
- [ ] Extend the Phase 82 drift-hold workflow so a downstream segment shares the held segment's input and another doesn't; assert `result.report.affectedSegments` includes the held + the data-dependent downstream, excludes the independent one. (If the e2e flow doesn't fit cleanly, cover via the 83.1 unit + 83.3 unit and skip this — note it.)
- [ ] Run with the wall-clock guard + zombie kill if real-Chrome. `npm run check` GREEN. Commit `phase 83: drift-hold cascade e2e (data-dependent downstream affected; independent survives)`.

## Task 83.5: Phase 83 doc + governance check
**Files:** `tasks/phases/phase-83-dependency-graph.md`
- [ ] Governance: constraint last @81 (next @86 > 83 → none), eval last @82 (next @92 > 83 → none). Run `validate-skill.mjs`. No gate.
- [ ] Write the phase doc (quote Phase 63 user intent "5개 중 4개만" + north-star §7; document variable-binding 1단계, independent-unless-proven-dependent bias, deferred URL/element deps, affectedSegments surfacing, partial-degradation foundation; note dangling-cleanup = Phase 84).
- [ ] Commit.

---

## Self-Review
- **Spec coverage (§7):** dependency edges (83.1) ✓, cascade on hold (83.1 affectedByHold + 83.3 surface) ✓, partial degradation analysis (independent survives) ✓. Dangling cleanup (journal+teardown+graph) = Phase 84 (out). URL/element-identity deps deferred (documented).
- **Placeholder scan:** 83.1 complete code; 83.3/83.4 reference verify-run merge + drift-hold e2e (implementer matches existing patterns).
- **Type consistency:** `affectedByHold(workflow, n) -> number[]` (83.1) consumed by verify-run (83.3) → schema `affectedSegments: number[]` (83.2).
- **Governance:** neither gate due at 83.

## Execution Handoff
Subagent-driven. 83.1 (pure lib) + 83.2 (schema) → fresh subagents. 83.3 (verify-run wire) standard. 83.4 controller (if real-Chrome) or fold to unit. After 83: Phase 84 = journal-driven dangling-data cleanup (Phase 82 journal + Phase 83 graph + Phase 78/79 teardown/sweep).
