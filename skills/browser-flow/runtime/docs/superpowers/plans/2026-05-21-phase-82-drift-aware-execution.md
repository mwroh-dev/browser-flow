# Phase 82 — Drift-aware execution: per-segment evidence + write-ahead journal + drift-hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Real-Chrome e2e (82.5) MUST use a hard `{timeout}` + zombie-kill cleanup; `rm -f profiles/*/Singleton* profiles/*/RunningChromeVersion` before any `node --test`.**

**Goal:** Make replay run segment-by-segment with a **write-ahead state journal** and **stop (hold) at the first segment whose evidence fails** — delivering the north-star's "race goes on until evidence breaks, then pit-in" + recoverable dangling-data tracking, **deterministically (no LLM yet)**.

**Architecture:** The runner already produces page-node-bounded `workflow.segments[]` (Phase 61b) and FINAL evidence (`transitionChecks`/`resultEvidence`). This phase reframes execution as a loop over segments: before each segment's (potentially mutating) steps, append a write-ahead journal entry; run the segment; if a step/transition fails, mark the entry `incomplete`, **HOLD** (do not run later segments — safety), and return a structured drift report naming the held segment. On success, mark `done` (recording dummy artifacts created, for later cleanup). No model — drift is detected purely by existing evidence/transition failures attributed to a segment.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test`, TS strict checkJs. No new deps, no LLM. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-mold-self-healing-automation-design.md` §4-5-7 (north-star phase 1).

---

## Decisions locked (from spec)
1. Drift = evidence/transition failure (no structural snapshot). Phase 82 reuses existing per-step transition + result-evidence failures, attributed to the *segment* that was executing.
2. Journal is **write-ahead**: entry written BEFORE a segment's mutating steps; status marked after.
3. Journal is **agent-blind**: record dummy *names* + intents + status, NEVER secret values / session state (mirror Phase 75 redaction).
4. Drift-hold = stop further segments (no more mutation); return structured report (held segment + reason). Not an exception.
5. No LLM heal in this phase (that's a later north-star phase). Held = terminal-for-now (operator/agent re-runs later).

---

## File Structure
- Create `scripts/lib/state-journal.mjs` — write-ahead ledger (append/mark/read), persisted to `runRoot/state-journal.jsonl`.
- Modify `scripts/lib/config.mjs` — add `journalPath`.
- Modify `scripts/lib/schemas.mjs` — `VerificationV1` optional `journal` / `heldAtSegment` / `driftReason`.
- Modify `scripts/generate/generate-runner.mjs` — segment-aware execution + journal + drift-hold + report fields.
- Modify `scripts/verify/verify-run.mjs` — surface journal/heldAtSegment.
- Tests: `tests/lib/state-journal.test.mjs`, `tests/generate/runner.test.mjs` additions, `tests/e2e/verify-drift-hold.test.mjs`.

---

## Task 82.1: state-journal lib
**Files:** Create `scripts/lib/state-journal.mjs`; Modify `scripts/lib/config.mjs` (`journalPath: resolve(runRoot, "state-journal.jsonl")`); Test `tests/lib/state-journal.test.mjs`
- [ ] **Failing test:** `appendEntry(journalPath, {segmentIndex, intent, status:"in-progress"})` then `markStatus(journalPath, segmentIndex, "done", {created:["__bf_test__x"]})` → `readJournal(journalPath)` returns one entry with status "done" + created. `appendEntry` is write-ahead (entry exists with "in-progress" even if markStatus never called — simulate crash). A second appendEntry adds a second entry. Reading a missing file → `[]`.
```js
import { appendEntry, markStatus, readJournal } from "../../scripts/lib/state-journal.mjs";
// use an mkdtemp path; assert write-ahead + mark + read shapes
```
- [ ] **Implement** `state-journal.mjs`: JSONL append (`appendEntry` writes one line `{ts, segmentIndex, intent, status, created?, observedEndUrl?}`); `markStatus` rewrites the file with the matching segment's latest status merged (or appends a status-update line — choose append-only JSONL: each line an event, `readJournal` folds to latest per segmentIndex); `readJournal` parses + folds. Agent-blind: callers pass only names/intents (the lib does no redaction but documents the contract). Keep pure fs + deterministic.
- [ ] Test pass; `npm run check` GREEN. Commit `phase 82: state-journal write-ahead ledger lib`.

## Task 82.2: schema fields
**Files:** `scripts/lib/schemas.mjs`
- [ ] Add to `VerificationV1` (optional): `journal: z.array(z.object({ segmentIndex: z.number(), intent: z.string().optional(), status: z.string(), created: z.array(z.string()).optional(), observedEndUrl: z.string().optional() }).passthrough()).optional()`, `heldAtSegment: z.number().optional()`, `driftReason: z.string().optional()`.
- [ ] `npm run check` GREEN. Commit `phase 82: VerificationV1 journal/heldAtSegment/driftReason fields`.

## Task 82.3: segment-aware runner + write-ahead journal + drift-hold
**Files:** `scripts/generate/generate-runner.mjs`; Test `tests/generate/runner.test.mjs`
- [ ] **Failing test:** generated source contains a segment loop + journal + hold (`assert.match(source, /state-journal|appendEntry/); assert.match(source, /heldAtSegment/);`).
- [ ] **Implement** (emitted runner): import the journal lib (compute rel path like other imports). Replace the flat `for (stepIndex...)` forward loop with a **segment-driven** loop:
  - Derive segments: `const segs = Array.isArray(workflow.segments) && workflow.segments.length ? workflow.segments : [{ range: [0, workflow.steps.length-1] }];`
  - For each `seg` (index `si`): `appendEntry(journalPath, { segmentIndex: si, intent: seg.name || ("segment "+si), status: "in-progress" })` BEFORE running its steps. Then run `workflow.steps[seg.range[0]..seg.range[1]]` via the EXISTING step-dispatch (goto/fill/click/submit + irreversible-skip + resolveLocator). Wrap in try/catch:
    - on success of all steps in the segment: `markStatus(journalPath, si, "done", { created: <dummy names used in this segment>, observedEndUrl: <current url> })`.
    - on failure (step throw / expectUrl timeout): `markStatus(journalPath, si, "incomplete", { error })`; set `heldAtSegment = si; driftReason = <message>;` and **break** the segment loop (HOLD — run no further segments).
  - `journalPath` is embedded at generate time (like `reportPath`) or resolved from runId; use the same mechanism the runner already uses for `reportPath`/`verificationPath`.
  - Keep `executedSteps`, `transitionChecks`, `resultEvidence` working (compute over executed steps). Add `journal: readJournal(journalPath)`, `heldAtSegment`, `driftReason` to BOTH report paths. `success` is false when `heldAtSegment != null`.
  - "dummy names used in this segment" = the bound input values (from BROWSER_FLOW_DUMMY_BINDINGS) referenced by that segment's steps; if hard, record all dummy binding names on the first segment that fills them. (Minimal: record `dummyBindingNames` per segment that has a fill with a bound value.)
- [ ] `npm run check` GREEN (existing fixture e2e have 1 segment → behave as before; no hold). Commit `phase 82: runner segment-aware execution + write-ahead journal + drift-hold`.

## Task 82.4: verify-run surfaces journal/hold
**Files:** `scripts/verify/verify-run.mjs`; Test `tests/verify/`
- [ ] The runner report already flows via spread-merge → `journal`/`heldAtSegment`/`driftReason` propagate. Add explicit handling only if a test shows they drop (mirror teardownSteps/orphanSweep). Ensure `report.success === false` when `heldAtSegment != null`.
- [ ] `npm run check` GREEN. Commit `phase 82: verify surfaces journal + heldAtSegment + driftReason`.

## Task 82.5: drift-hold e2e (real Chrome, deterministic)
**Files:** Test `tests/e2e/verify-drift-hold.test.mjs`; maybe a multi-segment fixture in `site-server.mjs`
- [ ] Use a multi-segment fixture flow (a 2+ page-node flow — e.g., `stateful` or `submit`, which transition pages → multiple segments). Capture or author a workflow with ≥2 segments. **Tamper a LATER segment** so its transition/evidence fails (e.g., set its step's `expectUrl` to an unreachable URL, or break its selector AND locator like the false-positive guards). `generate` + `verify`.
- [ ] Assert (hard timeout): `result.report.heldAtSegment` === the tampered segment index; `journal` shows earlier segment(s) `done` and the held one `incomplete`; later segments have NO journal entry (not executed); `result.report.success === false`. This proves "stop at drift + journal tracks what ran" deterministically.
- [ ] Run with the background wall-clock guard + zombie kill. `npm run check` GREEN. Commit `phase 82: drift-hold e2e (runner stops at first failing segment; journal recoverable)`.

## Task 82.6: governance EVAL AUDIT (due @82) + Phase 82 doc
**Files:** `tasks/phases/phase-82-eval-audit.md`, `tasks/phases/phase-82-drift-aware-execution.md`, `.governance/state.json`
- [ ] **EVAL AUDIT (DUE @82: last @72, +10).** Per `harness-hill-climbing` Known Limit: review whether the eval/test suite still measures the right things (are we hill-climbing on synthetic fixtures while real-site/drift behavior is what matters?). Record findings (e.g., the Keep real-site measurement showed the deterministic ladder's real-world ceiling → the north-star + drift-hold are the response; ensure tests cover drift-hold + journal, not just happy-path). Bump `.governance/state.json` `last_eval_audit_phase` → 82. Run `validate-skill.mjs`.
- [ ] Write `tasks/phases/phase-82-drift-aware-execution.md` (quote spec; document evidence-first drift, write-ahead journal, drift-hold, agent-blind journal, deterministic-no-LLM, dangling-data recovery foundation).
- [ ] Commit.

---

## Self-Review
- **Spec coverage:** write-ahead journal (82.1) ✓, drift-hold + segment-aware exec (82.3) ✓, surface (82.4) ✓, deterministic drift e2e (82.5) ✓, governance eval audit due @82 (82.6) ✓. LLM heal / mold-diff / dependency-cascade = later north-star phases (out).
- **Placeholder scan:** 82.1 test body + 82.3 "dummy names per segment" flagged as implementer-judgment (minimal version specified). 82.3 is the integration-heavy task.
- **Type consistency:** journal entry shape `{segmentIndex,intent,status,created?,observedEndUrl?}` consistent lib (82.1) → schema (82.2) → runner (82.3) → verify (82.4).
- **Agent-blind:** journal records names/intents/status only — never secret values/session (82.1 contract, 82.3 usage). Re-confirm in 82.6 eval audit.
- **Real-Chrome:** only 82.5 — hard timeout + Singleton cleanup mandated.
- **Governance:** eval audit IS due at 82 (last @72) — included as 82.6. constraint review last @81 → next @86 (not due).

## Execution Handoff
Subagent-driven. 82.1/82.2 (lib + schema) → fresh subagents. 82.3 (runner segment restructure) is the delicate integration — careful review. 82.4 mechanical. Controller runs 82.5 (real Chrome) directly. 82.6 (eval audit + doc) controller or subagent. After 82: Phase 83 = dependency-graph (Phase 63 completion) for cascade + journal-driven dangling cleanup.
