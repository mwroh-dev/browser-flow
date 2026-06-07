# Distribution P3 — ② Guard Triage + Tests Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the test surface to substance — triage the validate-skill behavioral guards (②), audit `tests/` for redundant/obsolete files, scrub test provenance markers, and extend the `no-provenance` gate to `tests/`.

**Architecture:** Cheap-model sub-agents produce evidence-based decision tables (each guard/test → invariant → existing coverage? → DELETE/MIGRATE/KEEP); apply the decisions (delete history cruft; migrate live-but-uncovered contracts as *proper behavioral tests*, never grep copies); then scrub `tests/` provenance and remove the temporary exemption so the gate covers the whole shipping surface.

**Tech Stack:** Node ESM, `node:test`, sub-agents (haiku enumeration, sonnet judgment).

**Spec:** `docs/superpowers/specs/2026-05-24-publish-bundle-design.md` (Component 1②, Component 5, Component 6 triage criteria). Depends on **P1** (validate-skill already lost ③) and **P2** (no-provenance gate exists with `tests/` temporarily exempt).

**Triage criteria (from spec — the guard against a jumble):**
- **DELETE** if: already covered by a real behavioral test · OR obsolete (feature/phase superseded/removed) · OR no behavioral substance (asserts "source text contains X").
- **MIGRATE (as a *proper* test)** only if ALL: protects a live current contract · AND not already covered · AND expressible as a behavioral test (exercise behavior, assert outcome).
- **Forbidden:** copying a grep-assert verbatim into `tests/`. A migrated check earns its place by testing behavior, not source text.

---

## Task 1: ② Behavioral-guard triage (validate-skill Phases 34–58)

**Files:**
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs` (remove DELETE/MIGRATE guard blocks; keep ① + any KEEP)
- Create: new behavioral tests under `tests/**` for MIGRATE'd contracts

- [ ] **Step 1: Enumerate the guards (haiku)**

Dispatch one `explore` sub-agent (model: haiku):
> READ-ONLY. In `.codex/skills/browser-flow/scripts/validate-skill.mjs`, list every behavioral-guard block between line 229 and the end of the structural checks (the Phase 34–58 grep-asserts; exclude the required-file checks L1–224 and the already-removed governance gate). For each: the line range, the file/pattern it greps, and the throw message. Output a numbered markdown table. Do not edit.

- [ ] **Step 2: Triage each guard (sonnet, parallel by batch)**

Partition the guard list into batches. Dispatch `explore` sub-agents (model: sonnet, READ-ONLY) — for each guard:
> Determine: (a) the INVARIANT it protects in plain words; (b) whether an existing test in `tests/` already covers that behavior (grep tests/ for the subject; name the test if found); (c) whether the invariant is still live in the current architecture or obsolete. Apply the triage criteria (DELETE / MIGRATE / KEEP) and justify with the specific evidence (the covering test name, or why obsolete, or why it is substance not source-text). Output rows: `# | invariant | covering test (or none) | current/obsolete | DECISION | evidence`.

- [ ] **Step 3: Review the decision table (main context)**

Read the consolidated table. Sanity-check: every DELETE cites a covering test OR an obsolescence reason OR "source-text only"; every MIGRATE cites "live + uncovered + behaviorally testable". If any row is hand-wavy, re-dispatch that row. Save the table inline in this plan file under a "Decision Table" appendix for the audit trail.

- [ ] **Step 4: Apply DELETEs — remove those guard blocks from validate-skill**

Remove each DELETE guard's block (comment + check + throw). Then:

Run: `node .codex/skills/browser-flow/scripts/validate-skill.mjs && npm run typecheck`
Expected: `browser-flow skill validated` + typecheck clean (remove any imports left unused by the deletions).

- [ ] **Step 5: Commit the deletions**

```bash
git add .codex/skills/browser-flow/scripts/validate-skill.mjs
git commit -m "refactor(validate-skill): drop redundant/obsolete behavioral grep-guards (covered or dead)"
```

- [ ] **Step 6: MIGRATE — write a proper behavioral test per surviving contract (sonnet)**

For each MIGRATE guard, dispatch an `executor` (sonnet):
> Write a behavioral test in the appropriate `tests/<area>/*.test.mjs` that EXERCISES the behavior `<invariant>` and asserts the outcome — not a source-text grep. Use the existing tests in that directory as the style reference (node:test, the `tests/_setup.mjs` isolation env). Run `node --test <file>`; it must pass. Then remove the corresponding grep-guard block from validate-skill. Report the test name + that validate-skill still passes.

- [ ] **Step 7: Verify migration completeness**

Run: `node .codex/skills/browser-flow/scripts/validate-skill.mjs && npm test`
Expected: validator passes (now ① + KEEP only); full suite passes including the new behavioral tests.

- [ ] **Step 8: Commit the migrations**

```bash
git add .codex/skills/browser-flow/scripts/validate-skill.mjs tests/
git commit -m "refactor(validate-skill): migrate live behavioral contracts to proper tests"
```

---

## Task 2: Tests substance audit (remove redundant/obsolete)

**Files:** `tests/**`

**Deletion criteria (conservative):** delete a test file/case ONLY if — its subject-under-test no longer exists (broken/removed import), OR another test fully covers the same behavior (provable duplicate). Keep everything else.

- [ ] **Step 1: Map tests → subjects (haiku)**

Dispatch one `explore` sub-agent (model: haiku):
> READ-ONLY. For every file in `tests/`, list its import targets under `scripts/` and a one-line summary of what it asserts. Flag any import that no longer resolves (subject removed). Output: `test file | imports | broken? | one-line subject`.

- [ ] **Step 2: Find duplicates + obsoletes (sonnet)**

Dispatch `explore` sub-agents (model: sonnet, READ-ONLY):
> Using the test→subject map, identify (a) tests whose subject import is broken/removed (obsolete) and (b) groups of tests asserting the SAME behavior where one fully subsumes another (redundant). For each candidate deletion, cite the evidence (broken import path, or the test that subsumes it). Do NOT propose deleting a test that holds any unique assertion. Output: `candidate test | reason (obsolete/redundant) | evidence | unique-assertions-lost (must be none)`.

- [ ] **Step 3: Review + capture coverage baseline**

Run: `node --test --experimental-test-coverage tests/ 2>&1 | tail -30`
Record the summary coverage. (Used to confirm deletions don't drop coverage of live source.)

- [ ] **Step 4: Apply deletions**

Delete the confirmed obsolete/redundant test files. Then:

Run: `npm test`
Expected: PASS (fewer tests, no failures — obsolete tests targeted removed code; redundant ones had subsuming siblings).

- [ ] **Step 5: Confirm coverage of live source did not drop**

Run: `node --test --experimental-test-coverage tests/ 2>&1 | tail -30`
Expected: surviving-source line coverage ≥ the Step 3 baseline for files that still exist (deletions only removed coverage of removed code or duplicate coverage). If any live source lost coverage, restore that test or write a replacement.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: remove obsolete (subject-gone) and redundant (subsumed) tests"
```

---

## Task 3: Scrub test provenance + extend the gate to tests/

**Files:** `tests/**`, `scripts/security/no-provenance.mjs`

- [ ] **Step 1: Scrub provenance markers in tests/ (sonnet, parallel)**

Same principle as P2 Task 2 (drop marker, keep principle; comments only, never assertions/strings). Dispatch sonnet `executor` agents over `tests/` files containing `Phase \d+` / `(#\d+`.

- [ ] **Step 2: Remove the temporary tests/ exemption**

In `scripts/security/no-provenance.mjs`, delete the `tests/` entry so the gate covers the whole shipping surface. Change:

```js
// TEMPORARY: tests/ provenance is scrubbed in P3 (tests audit). Removed there.
const EXEMPT_PREFIX = ["tests/"];
```

to:

```js
const EXEMPT_PREFIX = [];
```

- [ ] **Step 3: Gate now covers tests/ and passes**

Run: `node scripts/security/no-provenance.mjs`
Expected: `no-provenance OK (<N> files)` with tests/ now included.

- [ ] **Step 4: Commit**

```bash
git add tests scripts/security/no-provenance.mjs
git commit -m "refactor(tests): scrub provenance markers + extend no-provenance gate to tests/"
```

---

## Task 4: Final verification — full check + bundle integrity

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: lint, typecheck, validate-skill (① + KEEP only), pii-scan, no-provenance (whole surface), full test suite — all green.

- [ ] **Step 2: Rebuild + verify the bundle**

Run: `node scripts/publish/build-bundle.mjs && cd dist && npm install --no-audit --no-fund --silent && npm run check; cd ..`
Expected: bundle builds, no leaks, bundle `npm run check` passes — the bundle is a dumb copy of a fully-clean, fully-gated source.

- [ ] **Step 3: Confirm the shipping surface is archaeology-free and PII-free**

Run: `node scripts/security/pii-scan.mjs && node scripts/security/no-provenance.mjs`
Expected: both OK.

---

## Self-Review (filled)

**Spec coverage:** ② triage with criteria + evidence tables (T1), tests substance audit with coverage guard (T2), test provenance scrub + gate extension (T3), final full + bundle verify (T4). ✓

**Placeholder scan:** per-guard / per-test edits are data-driven (the triage tables) — unavoidable for an audit — but every step pins the model, the exact dispatch instruction, the decision criteria, and a concrete verification gate (validator passes / npm test / coverage non-regression / gate OK). The decision tables are persisted as an audit-trail appendix (T1 S3). ✓

**Type/name consistency:** removing `EXEMPT_PREFIX = ["tests/"]` → `[]` matches the variable defined in P2; validate-skill keeps `findPii`/`findProvenance`-independent ① checks. ✓

**Risks:** (1) deleting a guard/test that was the sole protector → mitigated by MIGRATE-not-delete for live-uncovered contracts + coverage non-regression check. (2) over-scrub → sonnet judgment + npm test per batch.
