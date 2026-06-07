# Phase 76 — Safety Classification + Consent (④) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Classify irreversible / high-consequence steps (financial / security / business: payment, email send, external share) and (a) exclude them from verify replay, (b) require operator consent for the run, (c) report them as "verify에서 제외(비가역)". The deterministic layer flags candidates by keyword; LLM refinement + operator confirmation is offline (never silently decided).

**Architecture:** New `safety-classify.mjs` (deterministic keyword classifier over step text/selector/url/href/formAction) → `compile.mjs` populates `workflow.safety.irreversibleStepIndexes` + `consentRequired`. Generated runner skips those indexes during replay and records them as excluded. verify-run surfaces exclusions + consent requirement. Builds on Phase 73 (`safety` scaffold at compile.mjs:289), generated-runner step loop (generate-runner.mjs:251).

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test` (`--import=./tests/_setup.mjs`), TS strict + checkJs (keep `npm run check` GREEN).

**Spec:** `docs/superpowers/specs/2026-05-20-human-in-loop-verify-design.md` §④.

**⚠️ GOVERNANCE:** creating any `tasks/phases/phase-76-*.md` doc makes `validate-skill` compute `currentPhase=76`, `delta = 76 - last_constraint_review_phase(71) = 5` → constraint-review gate THROWS until the counter is bumped. **Task 76.1 does the constraint review FIRST** (writes the review doc + bumps state 71→76) so every later task's `npm test`/`npm run check` stays green.

---

## File Structure

- Create: `scripts/lib/safety-classify.mjs` — `classifyIrreversible(steps)` → number[]
- Modify: `scripts/analyze/compile.mjs:289` — populate `safety.irreversibleStepIndexes` + `consentRequired`
- Modify: `scripts/generate/generate-runner.mjs:251` — skip irreversible indexes, record excluded
- Modify: `scripts/verify/verify-run.mjs` — surface excluded + consentRequired in report (not a blocker for automated repeat; first-mode operator consent is human-driven)
- Create: `tasks/phases/phase-76-constraint-review.md` + bump `.governance/state.json`
- Tests: `tests/lib/safety-classify.test.mjs`, additions to `tests/analyze/compile.test.mjs`, `tests/generate/runner.test.mjs`

---

## Task 76.1: Constraint Set Review (governance) — DO FIRST

**Files:** Create `tasks/phases/phase-76-constraint-review.md`; Modify `.governance/state.json`

- [ ] **Step 1: write the review doc** — follow `tasks/phases/phase-69-constraint-review.md` format (5-question self-analysis; audit window phases 71→76 = Phase 73/74/75 + this; assess whether any new constitutional invariant emerged). Expected finding: the agent-blind session invariant (Phase 75) is a real new candidate — evaluate it. The four-question test: is "the agent must never access credential/session values" a constitutional invariant? It is enforced at the keychain→env-var boundary (Phase 75). Decide: promote to a documented invariant OR keep as a Hook-layer guarantee. Record the decision. This is the 11th constraint review (prior: 22/27/32/37/42/48/53/59/64/69).

- [ ] **Step 2: bump counter** — `.governance/state.json`: `last_constraint_review_phase` 71 → 76. (eval audit stays 72; next eval at 82.)

- [ ] **Step 3: verify gate clears** — `node .codex/skills/browser-flow/scripts/validate-skill.mjs 2>&1 | tail -2` → "browser-flow skill validated". Then `npm run typecheck > /dev/null 2>&1; echo $?` → 0.

- [ ] **Step 4: commit**
```bash
git add tasks/phases/phase-76-constraint-review.md .governance/state.json
git commit -m "phase 76: Constraint Set Review (governance gate, 11th) — counter 71→76; assess agent-blind session invariant"
```

## Task 76.2: safety classifier + compile populate

**Files:** Create `scripts/lib/safety-classify.mjs`; Modify `scripts/analyze/compile.mjs`; Tests `tests/lib/safety-classify.test.mjs` + `tests/analyze/compile.test.mjs`

- [ ] **Step 1: failing test (classifier)**
```js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyIrreversible } from "../../scripts/lib/safety-classify.mjs";

test("classifyIrreversible flags payment/email/share steps by keyword, leaves benign", () => {
  const steps = [
    { action: "goto", url: "https://x.com" },
    { action: "click", selector: "button", text: "결제하기", href: "" },       // payment
    { action: "click", selector: "button[aria-label='send email']", text: "send" }, // email
    { action: "click", selector: "button", text: "외부 공유", href: "" },        // share
    { action: "click", selector: "button", text: "검색 열기" }                   // benign
  ];
  assert.deepEqual(classifyIrreversible(steps), [1, 2, 3]);
});

test("classifyIrreversible returns [] when no irreversible step", () => {
  assert.deepEqual(classifyIrreversible([{ action: "click", text: "열기" }]), []);
});

test("classifyIrreversible matches across text/selector/url/href/formAction", () => {
  const steps = [
    { action: "submit", formAction: "/checkout/payment", selector: "form" },
    { action: "click", selector: "a[href='/share/external']", text: "" }
  ];
  assert.deepEqual(classifyIrreversible(steps), [0, 1]);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement `scripts/lib/safety-classify.mjs`**
```js
// Irreversible / high-consequence categories. Deterministic keyword
// flagging only — LLM refinement + operator confirmation is offline
// (the pipeline stays LLM-free). Conservative on purpose: better to
// flag a benign step for operator review than to silently replay a
// payment. Operator can un-flag during first-verify confirmation.
const IRREVERSIBLE_PATTERN = new RegExp(
  [
    "결제", "payment", "checkout", "purchase", "구매", "송금", "이체", "transfer",
    "이메일", "email", "메일\\b", "send.?mail", "발송", "전송",
    "공유", "share", "external", "외부",
    "삭제", "delete", "remove", "탈퇴", "withdraw", "구독.?취소", "unsubscribe", "결제.?취소"
  ].join("|"),
  "i"
);

/**
 * Flag step indexes that look irreversible / high-consequence by keyword
 * across text / selector / url / href / formAction.
 *
 * @param {Array<Record<string, unknown>>} steps
 * @returns {number[]}
 */
export function classifyIrreversible(steps) {
  const flagged = [];
  steps.forEach((step, i) => {
    const haystack = [step.text, step.selector, step.url, step.href, step.formAction, step.submitterText]
      .filter((v) => typeof v === "string")
      .join(" ");
    if (IRREVERSIBLE_PATTERN.test(haystack)) flagged.push(i);
  });
  return flagged;
}
```
Note: this includes `delete`/삭제 — that is intentional for the SAFETY classifier (deletion is high-consequence on real data). The teardown phase (77+) handles *intended* dummy deletion separately; safety-flagging a delete in the FORWARD flow is correct (the operator confirms whether a forward delete is intended).

In `scripts/analyze/compile.mjs`, replace the static `irreversibleStepIndexes: []` scaffold with the computed value:
```js
import { classifyIrreversible } from "../lib/safety-classify.mjs";
// ... at the safety field:
const irreversibleStepIndexes = classifyIrreversible(workflow.steps);
// safety:
safety: {
  irreversibleStepIndexes,
  consentRequired: irreversibleStepIndexes.length > 0,
  sandbox: { available: false, location: null }
}
```

- [ ] **Step 4: failing test (compile populate)** — add to `tests/analyze/compile.test.mjs`: a fixture run whose steps include a flagged keyword → assert compiled `workflow.safety.irreversibleStepIndexes` non-empty + `consentRequired === true`; a benign fixture → `[]` + `false`. (Match the existing `compileRun(runId)` helper + fixture-setup pattern in that file.)

- [ ] **Step 5: run both test files, expect pass; `npm run check` → 0; commit**
```bash
git add scripts/lib/safety-classify.mjs scripts/analyze/compile.mjs tests/lib/safety-classify.test.mjs tests/analyze/compile.test.mjs
git commit -m "phase 76: safety classifier (irreversible keyword) + compile populates safety.irreversibleStepIndexes/consentRequired"
```

## Task 76.3: runner skips irreversible + verify surfaces exclusions

**Files:** Modify `scripts/generate/generate-runner.mjs:251`; Modify `scripts/verify/verify-run.mjs`; Tests `tests/generate/runner.test.mjs` + `tests/verify/`

- [ ] **Step 1: failing test (runner skip)** — assert the generated runner source skips steps whose index is in `workflow.safety.irreversibleStepIndexes` and pushes them to an `excludedSteps` list rather than executing.
```js
test("generated runner skips irreversible step indexes and records them excluded", () => {
  const source = generateRunner({ workflow: minimalWorkflow }); // existing helper
  assert.match(source, /irreversibleStepIndexes/);
  assert.match(source, /excludedSteps|excluded/);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** — in the runner template step loop (generate-runner.mjs:251 `for (const step of workflow.steps)`), convert to index-aware and skip:
```js
const irreversible = new Set((workflow.safety?.irreversibleStepIndexes) ?? []);
const excludedSteps = [];
for (let stepIndex = 0; stepIndex < workflow.steps.length; stepIndex += 1) {
  const step = workflow.steps[stepIndex];
  if (irreversible.has(stepIndex)) {
    excludedSteps.push({ index: stepIndex, action: step.action, reason: "irreversible" });
    continue;
  }
  // ... existing per-step replay body ...
}
```
Include `excludedSteps` in the runner's output report. In `verify-run.mjs`, propagate `excludedSteps` + `consentRequired` into `verification.json` so the operator sees what was skipped. (Automated repeat mode does NOT block on consent; first-mode operator consent is human-driven and out of the automated test.)

- [ ] **Step 4: run + `npm run check` → 0** (synthetic fixtures have no irreversible steps, so `excludedSteps` is empty and existing e2e passes unchanged).

- [ ] **Step 5: commit**
```bash
git add scripts/generate/generate-runner.mjs scripts/verify/verify-run.mjs tests/generate/runner.test.mjs tests/verify/
git commit -m "phase 76: runner skips irreversible steps (records excluded); verify surfaces exclusions + consentRequired"
```

## Task 76.4: Phase 76 plan doc

**Files:** Create `tasks/phases/phase-76-safety.md`

- [ ] **Step 1: write** (phase-doc format; quote operator: "이메일 발송, 결제, 외부 공유 류는 등 금융,보안,비지니스 적인것은 verify 에서 제외 분류" + "유저에게 철저하게 공지하고 동의를 받아야하는 영역"). Document: deterministic keyword classifier (conservative, operator un-flags), excluded-from-replay, consentRequired surfaced, LLM refinement offline.

- [ ] **Step 2: commit**
```bash
git add tasks/phases/phase-76-safety.md
git commit -m "phase 76 plan doc — safety classification + consent (irreversible exclusion)"
```

---

## Self-Review

- **Spec §④ coverage:** classify irreversible (76.2) ✓, exclude from verify (76.3 runner skip) ✓, consent surfaced (76.3 verify report `consentRequired`) ✓, never silently decided (conservative classifier + operator un-flag/confirm at first-verify; LLM offline) ✓.
- **Placeholder scan:** 76.1-76.3 complete code/commands. Test bodies for compile-populate (76.2 Step 4) + verify propagation (76.3) reference the existing `compileRun`/verify harness — implementer matches actual helper names (flagged inline). 76.4 is a doc.
- **Type consistency:** `classifyIrreversible(steps): number[]` consistent (76.2 lib, compile, runner reads `workflow.safety.irreversibleStepIndexes`). `excludedSteps` shape consistent (76.3 runner + verify).
- **Governance:** 76.1 does the constraint review FIRST → counter 71→76 → later tasks green. Eval audit (82) not reached.
- **Ordering hazard:** if an implementer creates phase-76-safety.md (76.4) before 76.1's counter bump, validate-skill throws. 76.1 MUST be first. (Plan orders it first; note for executor.)

## Execution Handoff

Execute via subagent-driven-development, **Task 76.1 FIRST** (governance), then 76.2 → 76.3 → 76.4. Phase 77 (teardown record) detailed after 76 lands.
