# Lesson/Spec Re-Homing — Design Spec

> **Corrected scope (v2):** This is NOT about creating new principle docs in the
> external KB (`~/Downloads/folder-structure`). It is about taking meaningful,
> durable insights out of this project's `tasks/lessons.md` (105 entries) +
> `docs/superpowers/{specs,plans}` (39 docs) and **re-homing each into its
> correct browser-flow home and FORM** — a rule, a knowledge entry, an agent
> contract, a skill, a structural doc — instead of leaving it as flat working
> memory. The KB's `confirmed/` principles are used as the **classification
> rubric** (how to decide the kind + home), read-only.

**Goal:** Promote (상향) durable lessons/spec insights from working memory into
canonical, *used/enforced* homes in browser-flow, classified by the confirmed
placement principles.

**Why:** A lesson in `lessons.md` is remembered but not *enforced or reused*. A
rule belongs in a code gate or AGENTS.md; a semantic learning belongs in
`knowledge/`; a role refinement belongs in an `AGENT.md`. Re-homing turns inert
notes into active structure.

---

## The Rubric — operational, derived from confirmed/ (constructed, not hand-waved)

**Which confirmed principles form the rubric:**
- SPINE: `artifact-placement-decision-framework` — its 5-question ordered test IS the classifier.
- BOUNDARY refiners: `rule-is-not-skill` (rule↔skill), `artifact-vs-knowledge`
  (artifact↔knowledge), `skill-surface-types` (skill form), `agent-as-contract-not-code`
  (agent home), `agent-directory-structure` (layer→dir mapping).
- PLACEMENT CONSTRAINTS: `multi-layered-safety-via-code` (safety MUST be code, not prose),
  `constraint-hierarchy-over-accumulation` (few hard invariants — don't pile rules),
  `purpose-scoped-authority` (one primary owner per concern).

**Layer → browser-flow path mapping** (the framework's required Local Mapping):

| Abstract layer | browser-flow path | Authority |
|---|---|---|
| Runtime code (enforces invariants, unbypassable) | `scripts/` (esp `scripts/security/`) | code gate |
| Procedure (agent-invokable, may not fire) | `.codex/skills/<name>/` | skill |
| Semantic knowledge (evolving, committed) | `knowledge/<domain>/` | learned pattern |
| Documentation (human rationale / decision / normative rule) | `docs/` + `AGENTS.md` | human-facing |
| Agent role contract (definition, not runtime code) | `agents/<name>/AGENT.md` | role identity |
| Episodic record (immutable, gitignored) | `artifacts/` | per-run (rarely a promotion target) |

**Decision tree — apply in ORDER, first YES wins (Q1 has priority):**
1. **Must this hold on EVERY run regardless of LLM/orchestrator choice, AND is it
   code-enforceable?** → **runtime code** (`scripts/security/` gate).
   *Caveat (framework Known Limits): if observed only once / not yet confirmed across
   multiple contexts, do NOT jump to code — hold it one layer down (knowledge/skill)
   with a promotion annotation; promote to code when confirmed across contexts.*
2. **Is it human-facing rationale, a design/architecture decision, or a normative
   project rule (not code-enforceable)?** → **documentation**: a design decision →
   `docs/architecture.md` / `docs/patterns-applied.md` (ADR-style); a normative rule
   the orchestrator must follow → `AGENTS.md` Architecture/Security Rules.
3. **Is it a reusable named procedure an agent invokes when applicable (can
   legitimately not fire)?** → **procedure** (`.codex/skills/<name>/`).
4. **Is it an evolving heuristic / observed pattern / not-yet-codified learning?**
   → **semantic knowledge** (`knowledge/<domain>/`).
5. **Spans multiple concerns?** → **mirror, designate one primary** (code primary if
   any; the derived view carries `Source of truth: <primary>`).
- **SPECIAL — refines a specific agent's role/contract/guardrails?** → **agent**
  (`agents/<name>/AGENT.md`), per `agent-as-contract-not-code`.

**The rule↔skill trap (most-misfiled boundary, `rule-is-not-skill`):**
fires-always-regardless-of-LLM = **rule** (code/AGENTS.md); fires-only-when-
orchestrator-chooses = **skill**. A safety/enforcement insight is NEVER a skill.

**rule home sub-decision:** code-enforceable → `scripts/security/` gate (primary) +
optional `AGENTS.md` pointer; not code-enforceable (advisory/process) → `AGENTS.md`
rule (primary).

---

## Architecture — 3-phase pipeline (+ prerequisite)

### Phase 0 — Prerequisite (mechanical; user pre-approved)
- Merge the doc/lesson **assets only** (capture-reliability spec, lessons updates,
  this design) from `feat/capture-reliability` → local `main`. NOT
  `readiness-gate.mjs` code.
- Delete the local `feat/capture-reliability` branch. (`main` daemon stays
  known-good; no code change ships.)

### Phase 1 — HARVEST + CLASSIFY (delegated to a sub-agent; keeps main context clean)
Inputs: full `tasks/lessons.md` + `docs/superpowers/{specs,plans}`; the KB
`confirmed/` (read-only rubric); the current browser-flow tree (to detect what is
already homed).

The sub-agent extracts durable insights worth promoting (filters out one-off
debugging trivia) and, **for each, emits this record:**
```
- insight:        <1-2 sentence durable takeaway>
- 삽질(origin):   <which wrong-turn/failure surfaced it — concrete>
- covered(결과):  <what it fixed/prevents once applied>
- source:         <lessons.md date(s) / spec file(s)>
- KIND:           knowledge | rule | skill | agent | structure | artifact
- rubric:         <which confirmed principle classifies it this way>
- proposed home:  <exact target path + form, per the rubric table>
- already-homed?: <yes+where (skip) | partial (augment X) | no (new placement)>
```
Output: a **prioritized list** grouped by KIND, each with the 삽질→covered history
(MANDATORY — the user selects from it) and an `already-homed?` dedup verdict
against the *existing project structure* (not the KB).

### Phase 2 — SELECT (user)
User reads the list (with history) and picks which insights to actually re-home,
and confirms/adjusts the proposed home for each.

### Phase 3 — PLACE (re-home each selected insight in its proper form)
For each selected insight, in the browser-flow repo:
- **knowledge** → write/append a `knowledge/<domain>/` entry.
- **rule** → add a `scripts/security/` gate (if code-enforceable) OR a bullet in
  `AGENTS.md` Architecture/Security Rules (advisory).
- **skill** → create/update `.codex/skills/<name>/`.
- **agent** → update the relevant `agents/<name>/AGENT.md`.
- **structure** → update `AGENTS.md` (Repository Layers / Architecture Rules)
  and/or `docs/architecture.md` / `docs/patterns-applied.md`.
- **already-homed=partial** → augment the existing home, don't duplicate.
- Commit per coherent group (atomic-commit-traceability).
- The originating `lessons.md` entry stays (append-only history); re-homing does
  not delete it — it promotes a COPY into the enforced/used home.

---

## Boundaries / honesty gates
- **Two repos, one-directional:** folder-structure is READ-ONLY here (rubric
  reference). All writes are in browser-flow. No new KB confirmed/candidate docs.
- **Dedup against the live project, not the KB:** if an insight is already
  embodied (in code / an AGENT.md / a knowledge file / an AGENTS.md rule), skip
  or augment — never re-add.
- **KIND honesty:** apply `rule-is-not-skill` strictly — a constraint that must
  fire regardless of orchestrator choice is a rule (code/AGENTS.md), not a skill.
  A procedure invoked on a condition is a skill. Don't mis-file.
- **Project-specific stays project-specific:** these land in browser-flow homes
  (that's the point); generality is not required here (unlike a KB entry).

## "Testing" (validate the re-homing worked)
- Each placed insight is in a home whose KIND matches the rubric (spot-check
  against `artifact-placement-decision-framework`).
- No insight is placed as a flat "notes" doc — every one lands as rule/knowledge/
  agent/skill/structure in its canonical form.
- `tsc --noEmit` + `npm test` still green if any code/gate was added (e.g. a
  security gate). AGENTS.md still passes `validate-skill.mjs` if touched.
- No duplication: `already-homed` items were skipped/augmented, not re-created.

## Out of scope
- Creating KB confirmed/candidate entries; the KB's 4-persona/5-dim scoring
  pipeline (that was the misread v1). Promoting one-off debugging trivia. Code
  behavior changes beyond adding rule-gates for selected rule-insights.
  `readiness-gate.mjs` stays unmerged.
