# `bf compose` — primary-run composition with integrated live learning

**Date:** 2026-05-26
**Status:** design (approved direction, pending user spec review)

## Goal

Add a new `bf compose` capability that starts from an existing **primary run**,
reuses the strongest already-known workflow/page knowledge first, and fills only
the missing portion by **direct CDP interaction learning**. The output is a new,
verified workflow run artifact, not an in-place mutation of the source run.

This is the first practical implementation of the user's "atomic fn" direction:
composition is not JSON splicing. It is goal-driven reuse + learning + verification.

## Fixed decisions

These decisions were explicitly fixed during brainstorming and are part of the
accepted scope for v1:

1. `bf compose` starts from exactly one required `--run-id <primaryRunId>`.
2. v1 includes **interactive live learning**, not just read-only exploration.
   Learning may perform `click`, `fill`, `select`, and `submit` when the active
   execution context permits them.
3. v1 does **not** support multi-run composition as an execution feature.
4. Multi-run composition must still be represented in the design as a future
   extension point:
   - composed outputs record `primaryRunId`
   - composed outputs record `sourceRuns[]`
   - later steps may attribute individual segments to different source runs
5. Multi-run composition must be left visible in:
   - backlog / roadmap
   - `README.md`
6. The design rules in
   `/Users/cielo-iamdt/Downloads/folder-structure/confirmed`
   govern this feature not only for agent design, but also for rules, gates,
   hooks, validators, artifact placement, and knowledge promotion decisions.

## Governing principles

The following confirmed principles are normative for this feature. They are not
nice-to-have references; they constrain the implementation shape.

| Principle | Compose consequence |
|---|---|
| `agent-as-contract-not-code` | Any `composer-agent` surface defines judgment contract only. Procedural loops, replay, gates, retries, and persistence live in `scripts/`. |
| `rule-is-not-skill` | Safety and policy enforcement for compose must live in deterministic code hooks/gates, never only in skill instructions. |
| `code-over-prompt-for-repetitive-tasks` | Reuse selection, graph reconnect checks, checkpoint evaluation, and broken classification are code, not repeated LLM work. |
| `artifact-vs-knowledge` | Compose session records are episodic `artifacts/`; only stable cross-run patterns may be promoted to `knowledge/`. |
| `3-tier-observability-model` | Compose must preserve raw telemetry, evidence artifacts, and reports as separate tiers. |
| `subagent-per-task-isolation` | Any subagent used by compose receives only task-relevant projected input, never the orchestrator's accumulated history. |
| `orchestrator-gated-context-distribution` | The orchestrator/runtime holds the full compose artifact and passes projected views to subagents; subagents return decision artifacts only. |
| `plan-as-control-structure` | Compose executes through checkpoints with halt/replan-or-broken behavior, not as an unchecked script. |
| `multi-layered-safety-via-code` | Role/gate/rule/hook layers must exist at the runtime boundary for safety-critical compose behavior. |
| `constraint-hierarchy-over-accumulation` | Do not bloat prompts with growing prohibition lists; structural constraints belong in validators/hooks, recurring failures belong in knowledge. |

Repo-local authority still applies:
- [AGENTS.md](/Users/cielo-iamdt/projects/browser-flow/AGENTS.md)
- [roadmap.md](/Users/cielo-iamdt/projects/browser-flow/docs/roadmap.md:658)

## User-facing command surface

The new public CLI surface is:

```bash
bf compose --run-id <primaryRunId> --request "<natural language request>"
```

Behavior:

- `--run-id` is required in v1.
- `--request` is required and is interpreted as a goal/selection request over an
  existing workflow plus missing-gap live learning.
- The command emits a **new run**, preserving the source run intact.
- The derived run must eventually follow the existing `generate` / `verify`
  pipeline before it can be considered complete.

The command does **not** support:

- `bf compose` from only `--start-url`
- composing from multiple source runs in one invocation
- bypassing verification

## Core model

### Primary-run composition

The primary run is the composition anchor. It supplies:

- the starting workflow
- `segments[]`
- `inputs[]`
- existing `atomicFp` / locator metadata
- related page graph entries in `knowledge/pages/`
- related scraping knowledge in `knowledge/scraping/`
- registry context for already-promoted reusable flows

The compose runtime tries to reuse as much as possible from this anchor before
learning anything new.

### Atomic composition as reuse + reconnect + learn

Composition proceeds in this priority order:

1. Reuse already verified/replayable path portions when they satisfy the request
2. Reuse primary-run segments and steps
3. Reconnect to known page-node graph or known reusable path from the current state
4. Enter live learning only for the unresolved gap

The system learns the minimum needed to reconnect to a known graph or to reach
the requested target state. Compose is therefore **goal-driven**, not open-ended.

## Architecture overview

```text
bf compose
  -> read primary run + related knowledge
  -> compose-request artifact
  -> projected view for composer-agent
  -> composer-agent returns structured compose decision
  -> deterministic reuse selection
  -> gap detected?
       yes -> live learning loop (CDP click/fill/select/submit)
       no  -> assemble directly
  -> workflow assembly
  -> generate
  -> verify
  -> compose summary report
```

## Runtime / agent boundary

### `composer-agent`

`composer-agent` is an internal sub-agent skill whose job is strictly limited to:

- parse the natural language request
- identify requested inclusion/exclusion/target intent
- express the request as a structured decision artifact

It does **not**:

- decide safety policy
- execute browser actions
- choose final reusable candidates by itself
- mutate workflow files directly
- write final reports

Expected output shape:

```json
{
  "requestIntent": {
    "targetState": "...",
    "mustKeep": ["..."],
    "maySkip": ["..."],
    "requiresData": true
  },
  "candidateHints": {
    "preferredSegments": [0, 1],
    "stopAfterSegment": 2
  },
  "notes": ["short rationale summary only"]
}
```

The orchestrator/runtime provides only a **projected view** to this sub-agent:

- workflow summary
- segment summary
- input summary
- known page graph summary
- request text

It must not pass:

- full orchestrator conversation history
- raw trace logs
- complete run directory contents
- safety taxonomy internals

### Deterministic runtime code

All execution mechanics belong in `scripts/compose/`:

- projected view building
- candidate indexing
- reuse selection
- live learning loop
- checkpoint gating
- workflow assembly
- compose summary generation
- policy enforcement hooks

## Checkpoint control structure

Compose is governed by checkpoints, not by a blind sequence.

Minimum checkpoints:

1. `request_structured`
2. `reusable_prefix_selected`
3. `learning_gap_resolved`
4. `workflow_generated`
5. `verification_passed`

At each checkpoint, the runtime compares expected state to actual state.

If a checkpoint fails:

- execution halts
- the compose task is marked `broken`
- a structured blocked reason is emitted
- no later checkpoint executes

Compose must not continue past a failed checkpoint under "best effort" logic.

## Reuse selection rules

Reuse selection is deterministic code. The LLM may hint, but code decides.

Rules:

1. Prefer existing verified/replayable path portions over fresh learning.
2. Prefer longer reusable prefixes when multiple candidates satisfy the same
   request intent.
3. Prefer reuse that keeps execution within the primary run's existing security
   context.
4. Re-enter live learning only at the exact first unresolved boundary.
5. After each learned step, check whether the current state can reconnect to:
   - a known page-node
   - a known reusable segment
   - the final requested verification target

If reconnect succeeds, exit learning and return to deterministic assembly.

## Live learning model

Live learning extends the current `explore` CDP path from read-only navigation
discovery to **goal-driven interactive execution**.

Allowed action classes in v1, subject to runtime policy hooks:

- `click`
- `fill`
- `select`
- `submit`
- short navigation replay needed to restore the current learning prefix

Loop shape:

1. Observe current page affordances / DOM / URL / available evidence
2. Select next candidate action according to the compose goal
3. Execute action via CDP
4. Wait for settle
5. Record resulting URL / DOM evidence / network evidence / action record
6. Derive or confirm `pageKey`
7. Check reconnect conditions
8. Continue or stop

Successful learned actions become new workflow steps plus compose-journal entries.

### Execution context inheritance

Live learning inherits the **primary run execution context**.

Examples:

- public-read primary run -> isolated session public-read learning
- future attached-browser primary run -> attached-browser learning in that same
  security model
- future named profile primary run -> profile-scoped learning in that same
  profile model

This rule keeps provenance, safety reasoning, and future multi-run conflict
resolution tractable.

## Broken-state classification

`broken` is not a generic failure bucket. At minimum the runtime must distinguish:

- `unreachable_goal`
  - the runtime has no grounded next action that can reach the requested target
- `policy_blocked`
  - a safety/rule/hook gate blocked the action or transition
- `graph_disconnect`
  - learning succeeded locally, but the result cannot reconnect to the known
    reusable graph or satisfy the requested verification target

These reasons belong in structured reports, not only human prose.

## File / directory placement

### New runtime code

- `scripts/commands/compose.mjs`
- `scripts/compose/`

Suggested runtime modules:

- `candidate-index.mjs`
- `projected-view.mjs`
- `reuse-selector.mjs`
- `learning-loop.mjs`
- `checkpoint-gates.mjs`
- `workflow-assembler.mjs`
- `compose-summary.mjs`

Exact filenames may shift during implementation, but the responsibilities above
must remain separated.

### New internal skill

- `.codex/skills/composer-agent/`

This is a private internal sub-agent surface, analogous to the existing
`variable-agent` / `scraping-agent` pattern.

### Artifact placement

Per composed run:

```text
artifacts/runs/<newRunId>/
  compose/
    compose-request.json
    compose-plan.json
    compose-session.json
    compose-journal.jsonl
```

Reports:

```text
artifacts/runs/<newRunId>/reports/compose-summary.json
```

### Knowledge placement

v1 does **not** introduce a new `knowledge/compose/` store by default.

Reason:

- existing durable knowledge domains already exist:
  - `knowledge/registry/`
  - `knowledge/pages/`
  - `knowledge/scraping/`
- compose session data is episodic evidence, not semantic knowledge

If compose later accumulates its own stable cross-run semantic patterns, a
dedicated `knowledge/compose/` domain may be introduced explicitly.

## Safety model

Compose must follow code-enforced safety, not prompt-enforced safety.

Required layers:

- **Role:** compose runtime may only operate within declared compose capability
- **Gate:** check whether the requested composition stays within the inherited
  execution context and permitted action class
- **Rule:** evaluate policy such as auth/profile mismatch, forbidden promotion,
  or prohibited irreversible action under the active mode
- **Hook:** deterministic code-level enforcement at the moment of action

Safety-critical compose behaviors that must be code-enforced:

- action class permission during live learning
- context inheritance boundaries
- auth/profile mode mismatch
- promotion/registry eligibility
- irreversible / CUD restrictions when the active mode disallows them

These protections may be mirrored in prompts as defense in depth, but prompts
are never the only enforcement surface.

## State model

Compose reuses the existing task state framework.

Task file:

```text
artifacts/runs/<newRunId>/tasks/compose.json
```

Transitions:

- `pending`
- `in-progress`
- `complete`
- `broken`

Resume behavior is implementation work, but the design requires compose to use
the same resumable/broken framework as other long-lived tasks.

## Observability

Compose follows the 3-tier model.

### Tier 1 — raw telemetry

- browser/CDP action traces
- navigation results
- event streams produced during learning

### Tier 2 — evidence artifacts

- `compose-request.json`
- `compose-plan.json`
- `compose-session.json`
- `compose-journal.jsonl`

### Tier 3 — report

- `reports/compose-summary.json`

The summary report must be derivable from compose evidence artifacts without
requiring ad-hoc re-reading of raw telemetry in normal reporting flow.

## Verification contract

Compose is not complete when workflow assembly finishes.

Success requires:

1. workflow assembled
2. runner generated
3. verification passed
4. security report green under the active compose mode

`compose succeeded` without final verification/security success is not a valid
success state.

## Tests

Testing emphasis is on deterministic boundaries and enforcement hooks.

### Unit tests

Cover:

- projected view construction
- reusable candidate selection
- checkpoint evaluation
- broken classification
- workflow assembly
- `sourceRuns[]` / provenance metadata emission

### Rule / hook tests

Cover:

- action blocking under disallowed policy
- context inheritance mismatch blocking
- promotion blocking under invalid conditions
- irreversible/CUD enforcement where applicable

### Integration tests

Use synthetic/local fixtures to verify:

- reuse-only compose
- reuse + live learning compose
- learned interactive steps (`click`, `fill`, `submit`) become workflow steps and
  compose-journal entries
- reconnect from learned state back into known graph

### End-to-end tests

Assert that a composed run can proceed through:

- `compose`
- `generate`
- `verify`

and finishes with green verification/security artifacts.

## README and backlog requirements

Implementation must update `README.md` to state:

- `bf compose` exists
- v1 requires a primary `--run-id`
- v1 includes interactive live learning
- v1 does not yet support multi-run compose

Implementation must leave backlog/roadmap entries for at least:

- multi-run compose
- segment attribution from multiple source runs
- cross-run security context merge policy
- source-run conflict resolution when similar pages diverge

## Non-goals

- composing directly from only `--start-url`
- full multi-run composition in v1
- creating a new global compose knowledge domain before evidence justifies it
- replacing the existing `generate` / `verify` truthfulness pipeline
- moving safety decisions into prompts or subagent discretion

## Risks

- **Live learning overshoots scope**: mitigated by strict action hooks and
  inherited context gates.
- **Compose becomes an all-in-one monolith**: mitigated by keeping judgment,
  runtime execution, reports, and enforcement in separate layers.
- **False knowledge promotion**: mitigated by keeping session artifacts episodic
  until an explicit promotion rule exists.
- **Subagent context pollution**: mitigated by projected-view dispatch only.
- **Multi-run pressure leaks into v1**: mitigated by explicit non-goal status and
  visible backlog/README wording.

## Decision summary

The accepted v1 is:

- primary-run anchored
- live-learning enabled
- interactive actions included
- deterministic reuse/verification driven
- code-enforced for safety
- multi-run deferred but structurally anticipated

This is the smallest version that still matches the user's intended atomic
composition model.
