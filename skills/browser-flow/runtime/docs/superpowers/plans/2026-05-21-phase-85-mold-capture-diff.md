# Phase 85 — Structural mold capture + old-vs-live diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Real-Chrome e2e (85.5) MUST use a hard `{timeout}` + zombie-kill + `rm -f profiles/*/Singleton* profiles/*/RunningChromeVersion`.**

**Goal:** Capture each page-node's **affordance skeleton** (interactive elements as `{role, name, structuralKey}`) and, on a drift-hold, compute an **old-vs-live diff** + emit a **heal-request artifact** — the deterministic input the (Phase 86) heal sub-agent will reason over. No LLM in this phase.

**Architecture:** Extend the in-page `locator-capture` source with `__bfAffordanceSkeleton()` (enumerate interactive elements → skeleton). Capture the skeleton per page-node at compile time (from the run's selectors, reusing existing element data where possible) into `mold.json`. A pure `mold-diff` lib diffs two skeletons (appeared/disappeared/changed). On drift-hold, the runner captures the LIVE skeleton, diffs it against the stored mold, and writes a `heal-request.json` artifact `{heldSegment, intent, heldStepLocator, diff, liveSkeleton}`.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test`, TS strict checkJs. No new deps, no LLM. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-mold-heal-loop-design.md` §3 (+ parent north-star §4).

---

## Decisions locked
1. Skeleton = `{role, name, structuralKey}` per interactive element (reuses Phase 81 `__bfComputedName`/`__bfBuildStructuralKey`/role); visibility/class/text ignored.
2. Diff is pure data-in/data-out (skeleton arrays) → Node-testable. Extraction is in-page (covered by e2e).
3. heal-request is a per-run artifact; **agent-blind** (no secret values/session — names/roles/keys only).
4. No heal/LLM here — only capture + diff + emit. Heal-agent = Phase 86.

---

## File Structure
- Modify `scripts/observe/locator-capture.mjs` — add `__bfAffordanceSkeleton()` (in-page enumerator).
- Create `scripts/lib/mold-diff.mjs` — `diffSkeletons(oldSkel, liveSkel)`.
- Modify `scripts/lib/config.mjs` — `moldPath` per page-node (`mold.json`) + `healRequestPath` per run.
- Modify `scripts/analyze/compile.mjs` — write per-page-node `mold.json` (affordance skeleton derived from the run's captured selectors + the step locators).
- Modify `scripts/generate/generate-runner.mjs` — on drift-hold, capture live skeleton + diff vs stored mold + write `heal-request.json`.
- Modify `scripts/lib/schemas.mjs` — `heal-request` shape (+ optional `healRequest` ref on the held report).
- Tests: `tests/lib/mold-diff.test.mjs`, `tests/generate/runner.test.mjs` add, `tests/e2e/verify-heal-request.test.mjs`.

---

## Task 85.1: affordance-skeleton in-page enumerator
**Files:** `scripts/observe/locator-capture.mjs`; equivalence/usage covered by 85.5 e2e
- [ ] Add to `locatorCaptureSource` (no backticks/`${`): `__bfAffordanceSkeleton()` — `document.querySelectorAll("a,button,[role],[tabindex],input,textarea,select,summary,[contenteditable]")`, for each visible-ish element build `{ role: el.getAttribute("role") || __bfImplicitRole(el-ish), name: __bfComputedName(el), structuralKey: __bfBuildStructuralKey(__bfDescriptorFromElement(el)) }`, dedupe by structuralKey, cap at ~80. (Reuse existing `__bfComputedName`, `__bfDescriptorFromElement`, `__bfBuildStructuralKey`; for role, mirror the recorder's `getAttribute("role")||implicitRoleOf` — add a small `__bfImplicitRole` if not present, or use `el.getAttribute("role")||""`.)
- [ ] Validate the injected script still parses: `node -e "import('./scripts/observe/locator-capture.mjs').then(m=>{ new Function(m.locatorCaptureSource); console.log('OK'); })"`.
- [ ] `npm run check` GREEN. Commit `phase 85: __bfAffordanceSkeleton in-page enumerator`.

## Task 85.2: mold-diff pure lib
**Files:** Create `scripts/lib/mold-diff.mjs`; Test `tests/lib/mold-diff.test.mjs`
- [ ] **Failing test:**
```js
import { diffSkeletons } from "../../scripts/lib/mold-diff.mjs";
const oldS = [{ role: "textbox", name: "Title", structuralKey: "k1" }, { role: "button", name: "Save", structuralKey: "k2" }];
const live = [{ role: "textbox", name: "제목", structuralKey: "k1b" }, { role: "button", name: "Save", structuralKey: "k2" }];
test("diffSkeletons reports appeared/disappeared/changed", () => {
  const d = diffSkeletons(oldS, live);
  // Save (k2) unchanged; Title→제목 is a change (matched by role, name/key differ)
  assert.deepEqual(d.unchanged.map((x) => x.structuralKey), ["k2"]);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].old.name, "Title");
  assert.equal(d.changed[0].live.name, "제목");
});
test("appeared/disappeared", () => {
  const d = diffSkeletons([{ role: "button", name: "X", structuralKey: "a" }], [{ role: "button", name: "Y", structuralKey: "b" }]);
  // no match by role+name or key → X disappeared, Y appeared
  assert.deepEqual(d.disappeared.map((x) => x.name), ["X"]);
  assert.deepEqual(d.appeared.map((x) => x.name), ["Y"]);
});
test("tolerates empty", () => { assert.deepEqual(diffSkeletons(null, null), { unchanged: [], changed: [], appeared: [], disappeared: [] }); });
```
- [ ] **Implement:** match old↔live first by exact `structuralKey`, then (for remaining) by `role`+`name` (a "changed" pair — same identity, different key/name); leftover old = `disappeared`, leftover live = `appeared`; key-matched with same name = `unchanged`, key-matched (or role+name-matched) with differing name/key = `changed` (`{old, live}`). Pure.
- [ ] Test pass; `npm run check` GREEN. Commit `phase 85: mold-diff lib (skeleton appeared/disappeared/changed)`.

## Task 85.3: capture mold.json per page-node
**Files:** `scripts/lib/config.mjs` (`moldPath`), `scripts/analyze/compile.mjs`; Test `tests/analyze/compile.test.mjs`
- [ ] `config.mjs` `pagePaths(pageKey)` → add `moldPath: resolve(pageDir, "mold.json")`.
- [ ] compile `writePageNode`: derive the affordance skeleton for the page-node from the run's captured data — the step `locator`s (Phase 81) whose `pageKey` matches, plus the page-node's `selectors.json` entries — normalized to `{role, name, structuralKey}`; write `mold.json` `{ schemaVersion, pageKey, skeleton: [...] }`. (Reuse step.locator where present; for selectors-only entries, map text→name, derive a key from selector+text. Keep deterministic.)
- [ ] Test: a compile run with locator-bearing steps writes a `mold.json` with the skeleton. `npm run check` GREEN. Commit `phase 85: capture per-page-node affordance-skeleton mold.json`.

## Task 85.4: emit heal-request on drift-hold
**Files:** `scripts/lib/config.mjs` (`healRequestPath`), `scripts/generate/generate-runner.mjs`, `scripts/lib/schemas.mjs`; Test `tests/generate/runner.test.mjs`
- [ ] `config.mjs` `getRunPaths` → `healRequestPath: resolve(runRoot, "heal-request.json")`.
- [ ] runner: in the drift-hold branch (where `heldAtSegment` is set), BEFORE returning the held report: capture the LIVE skeleton (`__bfAffordanceSkeleton` via `evaluateOnNode`/Runtime.evaluate using `locatorCaptureSource`), load the held page-node's stored `mold.json` skeleton (embed at generate time or read by pageKey), `diffSkeletons(stored, live)`, and write `heal-request.json` `{ heldSegment, intent, heldStepLocator: <the failing step's locator>, diff, liveSkeleton }`. Add `healRequest: true` (or the path) to the held report. **agent-blind**: skeleton has role/name/key only.
- [ ] runner.test: generated source references `heal-request` + `__bfAffordanceSkeleton`. `schemas.mjs`: add optional `healRequest` boolean/path on VerificationV1.
- [ ] `npm run check` GREEN. Commit `phase 85: runner emits heal-request (live skeleton + mold diff) on drift-hold`.

## Task 85.5: heal-request e2e (real Chrome) + doc + governance
**Files:** Test `tests/e2e/verify-heal-request.test.mjs`; `tasks/phases/phase-85-mold-capture-diff.md`
- [ ] e2e: a workflow with a stored mold + a drift-held segment (a step whose target moved/renamed so the stored locator fails). On verify → drift-hold → assert `heal-request.json` exists with a non-empty `diff` (the changed/disappeared affordance) + `heldStepLocator` + `liveSkeleton`. (Use the selfclean/noanchor fixture; tamper a step's locator so resolution fails AND the page's affordance differs from the stored mold.) Hard timeout + zombie kill.
- [ ] Governance: constraint last @81 (next @86 > 85 → none), eval last @82 (next @92 → none). validate-skill. No gate.
- [ ] Write `tasks/phases/phase-85-mold-capture-diff.md` (quote spec §3; document skeleton capture, diff, heal-request, agent-blind, deterministic-no-LLM, sets up Phase 86 heal-agent).
- [ ] `npm run check` GREEN. Commit `phase 85: heal-request e2e + doc`.

---

## Self-Review
- **Spec §3 coverage:** affordance-skeleton capture (85.1/85.3) ✓, old-vs-live diff (85.2) ✓, heal-request emission on drift (85.4) ✓, e2e (85.5) ✓. Heal-agent/apply = Phase 86 (out).
- **Placeholder scan:** 85.2 complete code; 85.1/85.3/85.4 reference reuse (locator-capture helpers, compile writePageNode, runner held branch) with implementer notes — the skeleton derivation in 85.3 (step.locator + selectors.json → skeleton) is the judgment-heavy bit (flagged).
- **Type consistency:** skeleton entry `{role,name,structuralKey}` consistent: in-page (85.1) → mold.json (85.3) → diff (85.2) → heal-request (85.4). Reuses Phase 81 locator shape.
- **agent-blind:** skeleton + heal-request hold role/name/key only; no secret values (85.4).
- **Real-Chrome:** only 85.5 — hard timeout + Singleton cleanup.
- **Governance:** neither gate due at 85.

## Execution Handoff
Subagent-driven. 85.2 (pure diff) → fresh subagent. 85.1 (in-page enumerator — String.raw discipline) careful. 85.3 (compile mold derivation) standard. 85.4 (runner held-branch heal-request) delicate. Controller runs 85.5 (real Chrome). After 85: Phase 86 = heal-agent skill + heal-apply + cleanup→heal→re-run orchestration.
