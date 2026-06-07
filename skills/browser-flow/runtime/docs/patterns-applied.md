# Confirmed Patterns — Applied to browser-flow

Scope: this document maps the twelve confirmed patterns from
`folder-structure/confirmed/` (paper-backed, quality-gated, production-grade in their source projects)
to concrete files and directories in this repository. It is the authoritative
**human-facing** record of which patterns are wired, which are partial, and
where remaining work is scheduled.

Source of truth for runtime enforcement: the code under `scripts/` and
the agent definitions under `agents/`. This document is a derived view —
when it disagrees with code or with `agents/{name}/AGENT.md`, the runtime
artifact wins.

Last reviewed: 2026-05-19 (post-Phase-29 close — Phases 1–29
applied; artifact Zod migration thread closed, governance gate
fired once at Phase 27 and cleared)

---

## Status legend

- ✅ **applied** — runtime artifacts already satisfy the pattern
- 🟡 **partial** — some surface satisfies the pattern; gaps remain
- 🔴 **missing** — pattern is not yet realized; scheduled in a phase below
- ⚪ **N/A** — pattern's preconditions do not apply to browser-flow

---

## Summary table

| # | Pattern | Status | Primary location in browser-flow | Target phase |
|---|---------|--------|----------------------------------|--------------|
| 1 | agent-directory-structure | ✅ | `agents/`, `scripts/`, `artifacts/`, `knowledge/`, `docs/` | Phase 7 + Phase 9 |
| 2 | skill-surface-types | ✅ | `.codex/skills/browser-flow/SKILL.md` (`surface: repo_skill`); linkage check in `validate-skill.mjs` | Phase 3 |
| 3 | artifact-placement-decision-framework | ✅ | every artifact in the repo; promotion path in Governance Schedules | Phase 2 + Phase 14 |
| 4 | constraint-hierarchy-over-accumulation | ✅ | `agents/{name}/AGENT.md`, `prompt.md`; constraint review in Governance Schedules | Phase 5 + Phase 14 |
| 5 | orchestrator-gated-context-distribution | ✅ | `.codex/skills/browser-flow/prompt.md`, `scripts/lib/schema-versions.mjs`, `scripts/lib/schemas.mjs` | Phase 3 + Phase 12 + Phase 19 + Phase 23 + Phase 25 + Phase 26 + Phase 28 + Phase 29 |
| 6 | phase-vs-lane-execution | ✅ | pipeline is strict 4-phase serial | Phase 9 (docs) |
| 7 | purpose-scoped-authority | ✅ | every artifact header (`Scope:` + `Source of truth:` back-pointers) | Phase 2 |
| 8 | subagent-per-task-isolation | ✅ | `prompt.md` Phase Entry Protocol + self-identification (architectural caveat: single-LLM walk, not spawned subagents) | Phase 3 |
| 9 | evaluation-as-behavioral-specification | ✅ | `agents/{name}/AGENT.md` Behavioral Contract (P / I / G / R + test mapping) | Phase 4 |
| 10 | harness-hill-climbing | ✅ | refactor execution (atomic per phase); eval audit in Governance Schedules | Phase 0–10 process rule + Phase 14 |
| 11 | per-agent-knowledge-patterns | ✅ | `knowledge/{agent-type}/...`, `knowledge/_template.semantic.md` | Phase 7 + Phase 13 |
| 12 | artifact-vs-knowledge | ✅ | `.gitignore` already separates them | (kept) |
| 13 | knowledge-update-strategies | ✅ | `agents/{name}/knowledge-pattern.md` (canonical labels: A / B(N=3) / B+prediction-error) | Phase 7 |
| 14 | multi-layered-safety-via-code | ✅ | `scripts/security/`, AGENT.md Safety Layers (Role/Gate/Rule/Hook rows), prompt.md | Phase 5 + Phase 11 |

(14 rows because patterns 12 and 13 are sibling confirmed patterns in
`confirmed/memory/`.)

---

## Per-pattern detail

### 1. agent-directory-structure ✅
Principle: separate by ownership/lifecycle into `agents/` (runtime code or
definitions, depending on local mapping), `skills/`, `artifacts/`,
`knowledge/`, `docs/`. Gitignore policy follows regenerability.

browser-flow (after Phase 7 + Phase 9): five directories exist plus
`scripts/` (runtime tools — local mapping decision: `agents/` holds
**definitions only**, `scripts/` holds **runtime tools**, per
Anthropic three-tier model used in commit `014a7d1`). Phase 7
structured `knowledge/` per `{agent-type}/{episodic,semantic[,meta]}/`.
Phase 9 added `agents/` to `docs/architecture.md` Layer Map and wired
`npm run check` to run `validate-skill` so the layout cannot drift
silently.

### 2. skill-surface-types ✅
Principle: every skill declares its surface (`local_module`, `repo_skill`,
`codex_subagent`, `model_replay`); validators must read the declaration
before applying file checks.

browser-flow (after Phase 3): `.codex/skills/browser-flow/SKILL.md`
declares `surface: repo_skill`. `validate-skill.mjs` enforces the
required file set for that surface **and** the 5-agent projected-view
linkage — `prompt.md` must reference each agent's `AGENT.md` +
`openai.yaml` and declare the Phase Entry Protocol section so the
linkage between skill surface and agent identities is structurally
locatable. The five `agents/{name}/AGENT.md` files remain agent
artifacts (different scope, see `purpose-scoped-authority`).

### 3. artifact-placement-decision-framework ✅
Principle: apply the 5-question test (runtime / docs / procedure /
semantic-knowledge / cross-cutting) before placing a new artifact.
Define an explicit promotion path so semantic knowledge can graduate
to procedure and code.

browser-flow (after Phase 2 + Phase 14): every artifact header
declares its `Scope:`, and cross-cutting items name a primary layer
with a back-pointer (security policy primary = `scripts/security/`;
derived view = `.codex/skills/browser-flow/references/
security-policy.md`). Phase 14 added the Promotion Path entry under
Governance Schedules (`semantic → procedure → code` trigger:
referenced in 3+ independent decision contexts).

### 4. constraint-hierarchy-over-accumulation ✅
Principle: 2–4 hard constitutional invariants at the top; everything else
distributed to judgment, code, or knowledge via the four-question test
(constitutional / judgment / structural / pattern). Schedule periodic
reviews so the threshold does not drift toward accumulation.

browser-flow (after Phase 5 + Phase 14): `prompt.md` lists 2
constitutional invariants (local-only, green-reports-before-success)
— within the budget. Each AGENT.md's Safety Layers section now
classifies items into Constitutional / Structural / Rule /
Judgment, with Phase 11 adding explicit Role / Gate rows. Phase 14
added the Constraint Set Review entry under Governance Schedules
with four trigger conditions (new prohibition proposed, count
would exceed 4, classification debate, every 5 phases).

### 5. orchestrator-gated-context-distribution ✅
Principle: the orchestrator holds the full artifact and delivers
**role-scoped projected views** to each subagent. Pull, not push.
Taxonomy stays local. Outputs are decision artifacts, not reasoning logs.
Result artifact schemas must be versioned.

browser-flow today (after Phase 3 + Phase 12 + Phase 19 + Phase
23 + Phase 25–26 + Phase 28–29): `prompt.md` declares an explicit
projected view per phase under "Pipeline — Phase Entry Protocol"
— each phase entry loads exactly the relevant AGENT.md,
openai.yaml, and reference(s). The Known-Limit gap on schema
versioning is fully closed by a four-rung promotion ladder
captured in `tasks/lessons.md`:

1. **Phase 12** — `schemaVersion` field added to all five result
   artifacts (`workflow.json`, `path.yaml`, `recipe.yaml`,
   `verification.json`, `security.json`).
2. **Phase 19** — `assertSchemaVersion()` reader-side floor at
   the two in-`scripts` workflow.json readers.
3. **Phase 23** — Zod `WorkflowArtifact` discriminated union
   replaces the version-only floor at the workflow read sites
   with field-level shape validation.
4. **Phases 25–29** — `VerificationArtifact` (Phase 25),
   `SecurityArtifact` (Phase 26), `PathYamlArtifact` (Phase 28),
   `RecipeYamlArtifact` (Phase 29). The recipe schema additionally
   encodes policy via `z.literal(true)` constraints on
   `localOnly` and the four `verification.requires*` fields —
   a producer that emits a non-compliant recipe fails the parse
   at write time (defense in depth on top of
   `scripts/security/local-only.mjs`).

All five artifacts are now Zod-bound at the producer site;
`tests/reports/schema-versions.test.mjs` pins each contract with
positive + negative cases.

### 6. phase-vs-lane-execution ✅
Principle: dispatch topology follows the dependency graph. Independent
nodes run as lanes (parallel); dependent nodes form phases (serial).

browser-flow: pipeline is strict 4-phase serial (capture → analyze →
generate → verify); each phase consumes the previous phase's artifact.
No lane opportunity exists in the runtime pipeline.

Note: the **refactor itself** (this work) uses lanes for independent
phases (Phase 1 + Phase 2; Phase 6 + Phase 7 + Phase 8). The pipeline's
runtime topology and the refactor's process topology are independent
concerns.

Phase 9 records the topology decision in `docs/architecture.md`.

### 7. purpose-scoped-authority ✅
Principle: no single source of truth; each artifact type holds scoped
authority over its own domain (code → enforcement, spec → intent,
knowledge → learned patterns, docs → rationale). Multiple authoritative
artifacts with managed correspondences are sound; silent divergence is
the defect.

browser-flow (after Phase 2): every primary artifact (`AGENTS.md`,
`docs/architecture.md`, each `agents/{name}/AGENT.md`,
`scripts/security/*` reference doc, `knowledge/README.md`,
`.codex/skills/browser-flow/SKILL.md` + `prompt.md`) declares
`Scope: ...` in its header. Derived views (e.g.
`.codex/skills/browser-flow/references/security-policy.md`) declare
`Source of truth: ...` pointing back to the primary
(`scripts/security/`). Managed correspondence is enforced through
`validate-skill.mjs` (linkage) and through `AGENTS.md`'s explicit
authority table for the Skill ↔ Agent boundary.

### 8. subagent-per-task-isolation ✅
Principle: subagent prompts must be self-contained; orchestrator history
must not bleed into a subagent's context (context pollution / rot).

browser-flow (after Phase 3): the runtime uses a single LLM walking
through phases, not spawned subagents — the architectural caveat is
that true OS-level subagent isolation is not available without an
architecture change. The project's mitigation is **explicit self-
identification at each phase entry**: `prompt.md` "Pipeline — Phase
Entry Protocol" requires the LLM to load the projected view (the
phase's `AGENT.md` + `openai.yaml` + phase-specific reference) and
self-identify with the phrase `agent identity` before invoking the
callable tool. `validate-skill.mjs` enforces both the projected-view
references and the `agent identity` phrase. Prior-phase context
re-anchors at each phase entry, the closest in-architecture
equivalent to fresh-subagent dispatch.

### 9. evaluation-as-behavioral-specification ✅
Principle: an eval is the agent's behavioral specification, written
before implementation. Each agent declares a contract: Preconditions,
Invariants, Governance policies, Recovery.

browser-flow (after Phase 4): each `agents/{name}/AGENT.md` declares a
`## Behavioral Contract` section with **Preconditions / Invariants /
Governance / Recovery** plus an explicit **Tests covering this
contract** mapping back to the `tests/` files that protect each
contract item. The 50-test (now 52-test) suite is no longer
implicitly tied to agent invariants — every test traces to a named
contract item in one of the five AGENT.md files. Phase 10's 5-agent
linkage matrix verified the mapping (all 50 cells YES). New behavior
added beyond Phase 14 is required to write the contract item before
the test under the Eval Audit governance schedule.

### 10. harness-hill-climbing ✅
Principle: eval-fail → trace → classify → patch **one** harness element →
re-run → regression check. Atomicity is the method, not a guideline.
Audit the eval suite periodically so regression cases do not decay
into stale baselines.

browser-flow (process rule across Phase 0–14): every phase in this
refactor changes exactly one dimension and runs `npm run check`
before commit. The pre-flight baseline (Phase 0) caught a
consequence (`scripts/lint.mjs` was orphaned by an earlier
multi-element commit `014a7d1`). Phase 14 added the Eval Audit
entry under Governance Schedules — every 10 phases beyond Phase 14
(Phase 24, 34, …) or on a major capability change, the eval suite
is re-validated against Behavioral Contract items in each
AGENT.md.

### 11. per-agent-knowledge-patterns ✅
Principle: each agent type has a declared knowledge strategy; the store
follows `knowledge/{agent-type}/{episodic,semantic[,meta]}/` with
versioned semantic files containing `version` / `replaces` /
`updated_after_runs` / `prediction_match` fields.

browser-flow (after Phase 7 + Phase 13): each agent has a
`knowledge-pattern.md` (strategy declaration). Phase 7 created
`knowledge/{orchestrator,capture,analyzer,generator,verifier}/
{episodic,semantic[,meta]}/` as `.gitkeep` placeholders. Phase 13
added `knowledge/_template.semantic.md` documenting the required
frontmatter schema (the four fields above plus `agent`, `strategy`,
`last_updated`) and the body-section conventions (Pattern,
Supporting Episodes, Application). `knowledge/README.md` now points
to the template as the authoritative schema for the first real
semantic file written under any agent. `registry/workflows.json`
remains intentionally cross-agent — moving it under
`orchestrator/semantic/` would create false single-agent ownership
(`purpose-scoped-authority`).

### 12. artifact-vs-knowledge ✅
Principle: artifacts/ is gitignored episodic evidence; knowledge/ is
committed semantic learning. Never reverse.

browser-flow: `.gitignore` line `artifacts/`, `knowledge/` committed.
Each `knowledge-pattern.md` names the Episodic Boundary.

(Kept; revisited in Phase 7 only to confirm new agent-typed directories
respect the same boundary.)

### 13. knowledge-update-strategies ✅
Principle: Strategy A (immediate) for verifiable outputs; Strategy B
(N=3 batch) for abstract reasoning; B + prediction-error for stable
policy; orchestrator gets a meta layer on top.

browser-flow (after Phase 7 + Phase 13): each
`agents/{name}/knowledge-pattern.md` declares the strategy using the
canonical labels — orchestrator: `B + prediction-error + meta`;
capture & verifier: `B + prediction-error`; analyzer & generator:
`B (N=3)`. Labels are grep-friendly for audit. The `strategy` field
in the semantic-file template (`knowledge/_template.semantic.md`,
Phase 13) constrains each future semantic file to the same vocabulary
so the strategy declared by the agent and the strategy actually used
in writing semantic entries cannot drift apart.

(Runtime mechanism that drives `B (N=3)` synthesis and
prediction-error comparison is still a placeholder — semantic
directories hold only `.gitkeep` until agents actually write across
runs. This is intentional per `agent-directory-structure` "Known
Limit: Premature migration adds overhead.")

### 14. multi-layered-safety-via-code ✅
Principle: enforce policy via Role → Gate → Rule → Hook (Hook only is
deterministic). Prompt instructions cannot enforce safety.

browser-flow: Hook layer is live (`scripts/security/local-only.mjs`,
`scripts/security/scan-artifacts.mjs`, `scripts/sanitize/*`). Phase 5
classified existing constraints into Constitutional / Structural /
Rule / Judgment levels with Hook-bound items. Phase 11 added explicit
`Role` and `Gate` rows to every agent's Safety Layers table so the
four named safety layers (Role / Gate / Rule / Hook) are structurally
complete:
- Role rows map to each agent's `openai.yaml` (`role_type` +
  `guardrails`).
- Gate rows map to the per-phase scope check (capture: local-URL
  rejection at `prepare`; analyzer/generator/verifier: input
  precondition checks; orchestrator: Phase Entry Protocol projected
  view).
- `validate-skill.mjs` now enforces `| Role` and `| Gate` row
  presence inside each agent's `## Safety Layers` section.

---

## How this map is used

When a later phase says "apply pattern N to file F," consult this map to
verify (a) the pattern is the right one and (b) the file is in the
expected layer for that pattern. If a future change creates an artifact
that does not fit any of the 14 entries above, either update this map or
mark the artifact for re-placement.

The map itself is documentation-layer (Q2 → `docs/`). It does not
enforce; it explains. Enforcement is the validator's job
(`.codex/skills/browser-flow/scripts/validate-skill.mjs`), extended in
Phase 3 and Phase 6.

---

## Governance Schedules

Three Known-Limit recommendations from confirmed patterns require
operational rules — when to re-evaluate the artifact layer
mapping, when to audit the constraint set, when to audit the eval
suite — rather than one-time runtime changes. **Phase 14 documented
the schedules; Phase 22 made them executable** — `.governance/state.json`
tracks `last_constraint_review_phase` and `last_eval_audit_phase`;
`validate-skill.mjs` reads the current phase from `tasks/phases/`
filenames and hard-throws when either delta crosses its interval
threshold (constraint review: 5 phases; eval audit: 10 phases).

Baseline reset: Phase 22 is now the operational baseline.
`last_constraint_review_phase = 22` and `last_eval_audit_phase = 22`
because Phase 22 itself ran both audits as part of its
introduction (see `tasks/phases/phase-22-governance-gate.md`).
The next scheduled review fires at Phase 27 (constraint review)
and Phase 32 (eval audit). The original Phase-14-anchored
schedule (Phase 19 / Phase 24) is superseded by this rebase —
those audits never ran formally; the Phase 22 audit covered the
same surface in one pass.

Phase 14 documents
these schedules here so future contributors can find them without
re-deriving from the source patterns.

### Promotion Path (`artifact-placement-decision-framework`)

The source pattern's Known Limit: "Without an explicit promotion
trigger, knowledge accumulates indefinitely without becoming
executable. Define a promotion condition for each step."

Trigger: a `knowledge/` semantic entry — or a recurring AGENT.md
guideline — is referenced as relevant in **3 or more independent
decision contexts** (independent runs, PR reviews, incidents,
debugging sessions).

Action — `semantic → procedure`: copy the encoded pattern into the
relevant phase's reference document under
`.codex/skills/browser-flow/references/`. The reference is loaded
as a projected view at phase entry, so the procedure starts
informing decisions immediately.

Action — `procedure → code`: when the procedure must hold as an
invariant across all contexts (not adapt to context), encode it in
the appropriate Hook-layer file under `scripts/security/` or the
relevant phase script, and add a regression test under `tests/`
that fails closed on bypass.

Tracker: each semantic entry's frontmatter `updated_after_runs`
field (see `knowledge/_template.semantic.md`). When the list
crosses 3 distinct contexts, the entry becomes a procedure
candidate — open a phase that performs the promotion or records
the deliberate decision to keep it semantic.

### Constraint Set Review (`constraint-hierarchy-over-accumulation`)

The source pattern's Known Limit: "What counts as constitutional
requires judgment… Teams will disagree, and the threshold will
drift toward accumulation without periodic audits. Schedule
explicit reviews of the top-level constraint set."

Trigger (any one):
- A new prohibition is proposed for the Constitutional Invariants
  list in `.codex/skills/browser-flow/prompt.md`.
- The constitutional invariant count would exceed **4** after the
  proposed addition.
- A debate arises about whether an existing constraint is
  constitutional vs context-dependent.
- A scheduled checkpoint every **5 phases** (Phase 15, 20, 25 …).

Action: apply the four-question test (Constitutional / Judgment /
Structural / Pattern) from the source pattern to every prohibition
in `prompt.md` Constitutional Invariants section. Push
non-constitutional bans into the appropriate enforcement layer:
- Judgment → positive posture in `prompt.md`
- Structural → validator, hook, or test under `scripts/security/`
  or `tests/`
- Pattern → semantic knowledge entry under
  `knowledge/<agent>/semantic/`

Tracker: the count of items under the
`## Constitutional Invariants` heading in
`.codex/skills/browser-flow/prompt.md`. Currently **2**
(local-only, both-reports-green) — well within the budget.

### Eval Audit (`harness-hill-climbing`)

The source pattern's Known Limit: "Regression suites become stale
as agent behavior evolves. Eval cases that were edge cases at
baseline become common paths over time. Audit the eval suite
after every 10 iterations or major capability change."

Trigger (any one):
- Every **10 phases** beyond Phase 14 (so: Phase 24, 34, 44 …).
- A new agent role is added or an existing role's responsibility
  scope shifts (e.g. analyzer gains a new compilation gate).
- A new pipeline phase is added or removed.
- A new fixture type or security gate is introduced.

Action: for each test under `tests/`, verify:
1. The test still encodes the right behavioral specification —
   the AGENT.md Behavioral Contract item it protects has not
   shifted.
2. The test exercises the same dimension it did at baseline —
   silent semantic drift in the assertion target is the most
   common decay path.
3. No new behavior is missing eval coverage. Cross-reference each
   Behavioral Contract bullet against the test set; gaps become
   eval candidates.

Owner: the phase that triggers the audit. The audit's output is a
`tasks/phases/phase-<N>-eval-audit.md` documenting what was
re-validated, what was removed, and what was added — same
artifact shape as Phase 0–14.

### Why these schedules live here

The three rules are Known Limits of three different confirmed
patterns. Putting them in three separate doc files would scatter
the operational surface; putting them inside the source pattern
docs would couple project process to upstream pattern definitions.
`docs/patterns-applied.md` is the existing project-local map of
pattern → file — the schedules are the project-local resolution
of the patterns' open governance items, so they belong here.
