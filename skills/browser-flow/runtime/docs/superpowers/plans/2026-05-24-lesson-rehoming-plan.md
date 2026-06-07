# Lesson/Spec Re-Homing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote durable insights from `tasks/lessons.md` + `docs/superpowers/{specs,plans}` into their correct browser-flow homes/forms (rule / knowledge / skill / agent / structure), classified by the confirmed-principle rubric — not left as flat notes.

**Architecture:** A gated pipeline. Phase 0 lands the doc assets on `main` + deletes the work branch. Phase 1 delegates a read-only HARVEST to a sub-agent that applies the rubric (5-question placement test) and emits per-insight records with 삽질/covered history + `already-homed?` dedup. Phase 2 the user selects. Phase 3 re-homes each selected insight in its proper form. `~/Downloads/folder-structure` is a READ-ONLY rubric reference; all writes are in browser-flow.

**Tech Stack:** git; Agent (Task) tool for the harvest sub-agent; markdown (AGENTS.md/AGENT.md/docs/knowledge); `node` only if a rule-insight becomes a `scripts/security/` gate. `node:test`/`tsc` only if code is touched.

**Spec:** `docs/superpowers/specs/2026-05-24-kb-promotion-design.md` (rubric + 3-phase design).

---

## File Structure (what this plan touches)

| Path | Role |
|------|------|
| `main` branch (git) | Phase 0 target — assets land here; harvest + placement run here |
| `tasks/lessons.md`, `docs/superpowers/{specs,plans}/*` | Phase 1 INPUT corpus (read-only by harvest) |
| `~/Downloads/folder-structure/confirmed/*` | Phase 1 rubric reference (read-only) |
| `knowledge/<domain>/`, `.codex/skills/<name>/`, `agents/<name>/AGENT.md`, `scripts/security/`, `AGENTS.md`, `docs/architecture.md`/`docs/patterns-applied.md` | Phase 3 placement targets (per selected insight's KIND) |
| `artifacts/runs/harvest-<ts>.md` (ephemeral) | Phase 1 harvest output (gitignored scratch; the shortlist) |

No new permanent files are pre-defined for Phase 3 — targets depend on Phase 2 selection; the per-KIND placement procedure (Task 4) is complete and deterministic given a selected insight.

---

## Task 1 (Phase 0): Land assets on main, delete work branch

**Files:** git only. Bring ONLY docs + lessons (NOT `readiness-gate.mjs`/test) from `feat/capture-reliability` to `main`.

- [ ] **Step 1: Switch to main**
```bash
cd /Users/cielo-iamdt/projects/browser-flow
git checkout main
```

- [ ] **Step 2: Copy the doc/lesson assets from the branch (code excluded)**
```bash
git checkout feat/capture-reliability -- \
  docs/superpowers/plans/2026-05-24-capture-reliability-spec.md \
  docs/superpowers/specs/2026-05-24-kb-promotion-design.md \
  docs/superpowers/plans/2026-05-24-lesson-rehoming-plan.md \
  tasks/lessons.md
```

- [ ] **Step 3: Verify the code did NOT come along**
```bash
git status --short
ls scripts/observe/readiness-gate.mjs 2>/dev/null && echo "LEAK: readiness-gate present" || echo "OK: no readiness-gate code"
```
Expected: staged are only the 3 docs + lessons.md; "OK: no readiness-gate code".

- [ ] **Step 4: Commit on main**
```bash
git add docs/superpowers tasks/lessons.md
git commit -m "docs: land capture-reliability spec + re-homing design + lessons on main (assets only)"
```

- [ ] **Step 5: Delete the work branch**
```bash
git branch -D feat/capture-reliability
git branch --show-current   # expect: main
git log --oneline -3
```
Expected: on `main`; branch gone; `git ls-files | grep readiness-gate` → empty (confirm code never merged).

---

## Task 2 (Phase 1): Dispatch the HARVEST sub-agent

**Files:** none written by us; the sub-agent writes `artifacts/runs/harvest-<ts>.md`.

- [ ] **Step 1: Dispatch the harvester (Agent / Task tool, subagent_type: explore)**

Use this EXACT prompt (fill `<ts>` with `date +%s`):
```
Read-only HARVEST for re-homing browser-flow's accumulated insights. Do NOT write
to ~/Downloads/folder-structure (read-only rubric) and do NOT modify any
browser-flow source — your ONLY write is the harvest report file.

INPUTS to read:
1. /Users/cielo-iamdt/projects/browser-flow/tasks/lessons.md  (105 entries)
2. /Users/cielo-iamdt/projects/browser-flow/docs/superpowers/specs/*.md and plans/*.md
3. RUBRIC (read these confirmed principles): ~/Downloads/folder-structure/confirmed/
   architecture/artifact-placement-decision-framework.md, rule-is-not-skill.md,
   skill-surface-types.md, agent-as-contract-not-code.md, agent-directory-structure.md,
   purpose-scoped-authority.md ; memory/artifact-vs-knowledge.md ;
   safety/multi-layered-safety-via-code.md ; architecture/constraint-hierarchy-over-accumulation.md
4. The current browser-flow tree (agents/, .codex/skills/, knowledge/, scripts/,
   AGENTS.md, docs/) to detect what is ALREADY homed.

TASK: extract ONLY durable, promotable insights (skip one-off debugging trivia).
For EACH, classify its KIND with the rubric's 5-question ordered placement test
(Q1 always-enforced+code-able → runtime code; Q2 human rationale/normative rule →
docs/AGENTS.md; Q3 invocable procedure → skill; Q4 evolving heuristic → knowledge;
special: agent-role refinement → AGENT.md). Apply the rule↔skill trap: fires-always
regardless-of-LLM = rule (code/AGENTS.md), fires-when-chosen = skill; safety is never
a skill.

OUTPUT: write a markdown report to
/Users/cielo-iamdt/projects/browser-flow/artifacts/runs/harvest-<ts>.md
as a table grouped by KIND, one row per insight with EXACTLY these columns:
| # | insight (1-2 sentences) | 삽질(origin: which wrong-turn surfaced it, concrete) |
covered(결과: what it fixed/prevents) | source (lessons date / spec file) | KIND |
rubric (which confirmed principle classifies it) | proposed home (exact path+form) |
already-homed? (yes+where=skip / partial=augment X / no) |

Then return a SHORT summary: total insights, count per KIND, and the count that are
already-homed (skip) vs new vs augment. Be conservative — prefer fewer, high-value,
genuinely-not-yet-homed insights. The 삽질→covered history is MANDATORY per row.
```

- [ ] **Step 2: Verify the harvest report**

Run: `ls -la artifacts/runs/harvest-*.md && wc -l artifacts/runs/harvest-*.md`
Expected: a non-empty report. Open it; confirm every row has 삽질 + covered + KIND + proposed-home + already-homed verdict, and KINDs use only {knowledge, rule, skill, agent, structure, artifact}.

- [ ] **Step 3: No commit** (the report is gitignored scratch under `artifacts/`).

---

## Task 3 (Phase 2): User selection gate

**Files:** none.

- [ ] **Step 1: Present the shortlist**
Surface the harvest table to the user, grouped by KIND, with the 삽질→covered history and the `already-homed?` verdict per row. Highlight the "new" + "augment" rows (skip the "already-homed").

- [ ] **Step 2: Ask the user to SELECT** which insights to re-home and to confirm/adjust each proposed home. (Use AskUserQuestion or a numbered list.) Record the selected set as `SELECTED[]` (each: insight, KIND, target path, new|augment).

- [ ] **Step 3: STOP for user response.** Do not place anything until the user selects. (Per spec: we don't auto-promote.)

---

## Task 4 (Phase 3): Re-home each SELECTED insight (per-KIND procedure)

For EACH item in `SELECTED[]`, run the procedure for its KIND. These are complete and deterministic given the item; repeat per item.

- [ ] **KIND = knowledge** → `knowledge/<domain>/<name>.json` (or append to an existing domain file)
  1. Pick `<domain>` matching an existing `knowledge/` subdir if one fits; else a new kebab domain.
  2. Write/append the semantic insight as JSON `{ schemaVersion: 1, ... , note, source }` mirroring the shape of a sibling file in that domain (read one first).
  3. `git add knowledge/<domain>/<name>.json && git commit -m "knowledge(<domain>): <insight> (from lessons <date>)"`

- [ ] **KIND = rule, code-enforceable** → `scripts/security/<name>.mjs` gate
  1. Write the gate as a pure function mirroring an existing `scripts/security/*.mjs` (read `local-only.mjs` for the pattern).
  2. Add a test `tests/security/<name>.test.mjs` (node:test) — golden (passes) + red (blocked) per `dual-polarity-evaluation`.
  3. Run `node --import=./tests/_setup.mjs --test tests/security/<name>.test.mjs` → PASS; `npx tsc --noEmit` → 0 errors.
  4. Add a one-line pointer in `AGENTS.md` "Security Rules" with `Source of truth: scripts/security/<name>.mjs` (derived view, per cross-cutting rule).
  5. `git add scripts/security/<name>.mjs tests/security/<name>.test.mjs AGENTS.md && git commit -m "feat(security): <rule> gate (from lessons <date>)"`

- [ ] **KIND = rule, NOT code-enforceable (advisory/process)** → `AGENTS.md` Architecture Rules
  1. Add a bullet under `AGENTS.md` "Architecture Rules" (or "Security Rules") stating the normative rule.
  2. `node .codex/skills/browser-flow/scripts/validate-skill.mjs` → "validated" (AGENTS.md is imported by the skill).
  3. `git add AGENTS.md && git commit -m "docs(rules): <rule> (from lessons <date>)"`

- [ ] **KIND = skill** → `.codex/skills/<name>/SKILL.md` (new) or edit existing
  1. Mirror an existing sub-agent skill (e.g. `.codex/skills/scope-agent/SKILL.md`): frontmatter `name` + `description`, role, I/O contract.
  2. `node .codex/skills/browser-flow/scripts/validate-skill.mjs` if the entry skill/manifest is touched.
  3. `git add .codex/skills/<name>/ && git commit -m "feat(skill): <name> (from spec <file>)"`

- [ ] **KIND = agent** → `agents/<name>/AGENT.md`
  1. Add/refine the role-contract section in the relevant `agents/<name>/AGENT.md` (read it first; follow its section style).
  2. `git add agents/<name>/AGENT.md && git commit -m "docs(agent): <name> contract — <insight> (from lessons <date>)"`

- [ ] **KIND = structure** → `AGENTS.md` (Repository Layers / Architecture Rules) and/or `docs/architecture.md` / `docs/patterns-applied.md`
  1. A design decision with rationale → `docs/patterns-applied.md` (ADR-style entry). A layer/rule fact → `AGENTS.md`.
  2. `node .codex/skills/browser-flow/scripts/validate-skill.mjs` if AGENTS.md touched.
  3. `git add <files> && git commit -m "docs(structure): <decision> (from <source>)"`

- [ ] **already-homed = partial (augment)** → open the existing home file, add the missing piece only; do NOT create a near-duplicate; commit.

- [ ] **already-homed = yes (skip)** → no action; note it as "already homed at <path>".

---

## Task 5 (Phase 3 close): Final verification

- [ ] **Step 1:** If any code/gate was added: `npx tsc --noEmit` → 0 new errors; `npm test` → no NEW failures (the known-flaky `verify-breadth-enrichment` aside).
- [ ] **Step 2:** If `AGENTS.md` / entry skill touched: `node .codex/skills/browser-flow/scripts/validate-skill.mjs` → validated.
- [ ] **Step 3:** Confirm no insight was placed as a flat "notes" doc (each is a rule/knowledge/agent/skill/structure in canonical form) and no duplicates of already-homed content were created.
- [ ] **Step 4:** Report a summary table: insight → home placed → form. lessons.md entries remain (history preserved; re-homing is promotion-by-copy).

---

## Self-Review

- **Spec coverage:** Phase 0 (Task 1), Phase 1 harvest+rubric+삽질/covered (Task 2), Phase 2 select (Task 3), Phase 3 per-KIND placement + augment + skip (Task 4), honesty/dedup gates + verification (Task 5). folder-structure read-only (Task 2 prompt). rule↔skill trap encoded (Task 2 prompt + Task 4 rule branches).
- **Placeholders:** Phase 3 targets are selection-dependent BY DESIGN — the per-KIND procedure (Task 4) is complete for any selected item, so there are no undefined steps. The harvest prompt is verbatim.
- **Consistency:** KIND set {knowledge, rule, skill, agent, structure, artifact} consistent across harvest prompt (Task 2) and placement procedure (Task 4). Paths match the spec's layer map.

## Out of scope
KB confirmed/candidate entry creation (read-only rubric only); promoting one-off trivia; code behavior changes beyond rule-gates for selected rule-insights; `readiness-gate.mjs` (stays unmerged).
