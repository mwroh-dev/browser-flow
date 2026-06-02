---
agent: <agent-type>
strategy: <A | B(N=3) | B+prediction-error>
version: 1
replaces: null
updated_after_runs: []
prediction_match: null
last_updated: 2026-05-19T00:00:00Z
---

# Semantic Knowledge — `<agent-type>` — `<pattern-key>`

Scope: agent-owned semantic pattern accumulated across runs. Authority
for the encoded pattern. Source-of-truth for the pattern lives here;
prompts and AGENT.md files may reference but do not override.

This file is a **template**. Copy it under
`knowledge/<agent-type>/semantic/<pattern-key>.md` when the first
real entry is written, then fill the body and the frontmatter
fields.

## Frontmatter schema

Each semantic file must declare these fields (per
`per-agent-knowledge-patterns` — "Common Structure for All
Patterns"):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | yes | One of `orchestrator`, `capture`, `analyzer`, `generator`, `verifier`. Must match the parent directory. |
| `strategy` | string | yes | The update strategy declared in `agents/<agent>/knowledge-pattern.md`. Allowed values: `A` (immediate), `B(N=3)` (batch with fixed N=3), `B+prediction-error` (batch + prediction-error trigger), `B+prediction-error+meta` (orchestrator-only: prediction-error trigger plus a `meta/` cross-agent pipeline summary layer). New strategies require an update to this template. |
| `version` | integer | yes | Monotonically increasing per `<pattern-key>`. First entry is `1`; every overwrite bumps by one. |
| `replaces` | string \| null | yes | Relative path of the previous version (e.g. `verifier/semantic/replay-timing.v1.md`) or `null` for the first entry. Version chain is reconstructable by walking this pointer. |
| `updated_after_runs` | string[] | yes | Run IDs from `artifacts/runs/` that triggered this update. For Strategy `B(N=3)` this list has length 3; for Strategy `A` it has length 1; for `B+prediction-error` it has length 1 and `prediction_match` is `false`. |
| `prediction_match` | boolean \| null | yes | `null` for Strategy `A` (no prediction is checked); `true` for routine updates under `B+prediction-error` (which should not have written a new file at all — investigate); `false` when prior semantic knowledge failed to anticipate the actual result (the canonical case for `B+prediction-error`). |
| `last_updated` | ISO-8601 timestamp | yes | UTC timestamp of this version. |

## Body sections

Below the frontmatter, each semantic file should include:

### Pattern

A one-paragraph statement of the encoded pattern. What did the agent
learn that it did not know at version `version - 1`?

### Supporting Episodes

Which episodes from `artifacts/runs/<run-id>/` contributed to this
pattern. For Strategy `B(N=3)` list all three; for
`B+prediction-error` list the single surprising run and what
prediction the prior version made.

### Application

When this pattern should influence the agent's next decision.
Describe the trigger condition and the recommended adjustment. This
section is what the agent reads at the start of its next run.

### Provenance Note (optional)

Free-form notes — caveats, open questions, conditions under which
this pattern may no longer hold.

## Episodic boundary

The full per-run record lives in `artifacts/runs/<run-id>/` and is
gitignored (`artifact-vs-knowledge`). Only the cross-run pattern
graduates here. If a candidate entry has no cross-run signal — only
a single noisy run — it does not belong in `semantic/`.

## Why the schema is enforced this way

Without `version` + `replaces`, history is unwalkable and rollback
is impossible. Without `updated_after_runs`, no auditor can verify
which episodes the pattern was derived from. Without
`prediction_match`, a `B+prediction-error` agent cannot tell
whether the trigger condition was respected. These four fields are
the minimum audit surface for accumulated knowledge per
`per-agent-knowledge-patterns`.
