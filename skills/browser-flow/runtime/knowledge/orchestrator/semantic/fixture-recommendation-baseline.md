---
agent: orchestrator
strategy: B+prediction-error+meta
version: 1
replaces: null
updated_after_runs: []
prediction_match: null
last_updated: 2026-05-19T00:00:00Z
---

# Semantic Knowledge — `orchestrator` — `fixture-recommendation-baseline`

Scope: orchestrator-owned baseline for which bundled fixture to
recommend given a user's stated workflow goal. Authority for the
first-pass recommendation surfaced in the orchestrator's
`Recommendation` step (per `.codex/skills/browser-flow/prompt.md`
"Interaction Posture"). Source-of-truth for fixture choice
rationale.

## Pattern

User goals map to fixtures along three axes — interaction kind,
session requirement, and security sensitivity:

| User goal phrasing | Recommended fixture | Why |
|---------------------|--------------------|----|
| "Quick prototype / smoke test / hello world" | `synthetic` | Smallest captured path, fastest verify, deterministic. |
| "Form fill and submit" | `submit` | Has `data-bf` selectors on every field + a labeled submit. |
| "Multi-step workflow with logged-in state" | `stateful` | The only fixture that exercises in-memory session storage and post-login navigation. |
| "Password / credential entry" | `secret` | The only fixture with `[type="password"]` and the redaction path exercised. |
| "Documentation site / article navigation" | `docs` | Client-side rendered evidence — exercises the render-wait path. |
| "Real site I have running locally" | `manual` | The only fixture that takes an external local URL. |

## Supporting Episodes

Seeded from inspection of `scripts/fixtures/` (the six bundled
fixtures and their site-server definitions) and the orchestrator
interaction posture in
`.codex/skills/browser-flow/prompt.md`. No single real
recommendation episode is authoritative — these are the
operator's defaults to anchor first-pass recommendations.

First automated `updated_after_runs` entry expected when the
prediction-error trigger fires (the orchestrator recommended one
fixture and the user corrected to another, or the
recommendation routed to a re-capture). The user-correction
signal is the prediction-error event for this knowledge.

## Application

On user goal received, before recommending re-capture vs reuse:

1. Read `knowledge/registry/workflows.json` for any existing
   verified workflow matching the goal (reuse path — no fixture
   needed).
2. If no reuse candidate, classify the goal phrasing into one of
   the rows above. If multiple rows match (e.g., both "form
   submit" and "password"), the security-sensitive choice wins
   (`secret` > others), per the constraint hierarchy
   (constitutional invariant: no raw secrets persisted).
3. If no row matches, default to `synthetic` and emit a note
   that the recommendation is the default fallback. This
   triggers the prediction-error pathway when the user corrects
   it.

## Provenance Note

Confidence: operator-level. The fixture set is small (6) and the
mapping is deliberate rather than discovered. The
prediction-error trigger will fire most often on `manual` (where
the operator's intent is hardest to predict) and on edge cases
where two fixtures overlap (`docs` vs `submit` for documentation
sites that have forms).

## Meta layer note

This file lives in `knowledge/orchestrator/semantic/`, not in
`knowledge/orchestrator/meta/`. `meta/` is reserved for
cross-agent pipeline performance summaries (e.g., "verifier
fails 40% of the time on `stateful`"); this entry is a
per-agent semantic pattern about recommendation choice.
