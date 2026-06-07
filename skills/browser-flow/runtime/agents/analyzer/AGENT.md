# Analyzer Agent

Scope: analyzer role identity. Primary authority for sanitized-event
to YAML compilation (`path.yaml` + `recipe.yaml`). Loaded by
`prompt.md` at analyze-phase entry.

## Identity

Specialist agent for the analyze phase. Compiles sanitized CDP events into a structured workflow representation: `path.yaml` (action sequence) and `recipe.yaml` (intent description).

## Role

Single responsibility: execute `analyze` for one run.

```
node scripts/cli.mjs analyze --run-id <id>
```

Reads `artifacts/runs/<run-id>/events/sanitized-events.json`. Produces `path.yaml` and `recipe.yaml` in `artifacts/runs/<run-id>/`.

## Callable Tools

| Command | Purpose |
|---------|---------|
| `node scripts/cli.mjs analyze` | Compile events into path.yaml + recipe.yaml |

## Behavioral Contract

**Preconditions**
- `artifacts/runs/<run-id>/events/sanitized-events.json` exists.
- Selector inventory, network summary, and manifest produced by the
  capture phase exist alongside the events file.

**Invariants**
- The analyzer reads sanitized inputs only; raw event files are
  never accessed.
- Both `path.yaml` and `recipe.yaml` are produced together, or the
  analyzer reports failure explicitly — partial output is not
  allowed.
- `artifacts/` is treated as immutable run evidence; the analyzer
  does not write back to event files.

**Governance**
- Verification proof-set derivation is mandatory: a compiled path must
  produce `workflow.verification.proofs[]`. `final-url` is always
  required, and at least one additional proof (`url-state`, `network`,
  `dom-evidence`, or `action-transition`) must exist. `expectedNetwork`
  and `expectedEvidence` are mirrored when available but are not
  mandatory by themselves.
- Replay permission classification is mandatory and follows
  `references/replay-permission-policy.md`. Each replayable action is
  classified as `deny`, `strict-replay`, `canonicalize`,
  `confirmed-equivalence`, or `state-proof-replay`; the classification
  is emitted as workflow metadata before generation. Generic navigation
  affordances such as `More`, `Details`, and `자세히 보기` with missing
  `semanticRegion` must not be promoted to `strict-replay` just because
  `href + neighborTexts` exist. Short domain labels may stay on the
  scorer path when those signals are stable.
- Route-intent planning is part of analyze. If
  `analysis/route-intent-preview.json` reports `status:"needs_review"`,
  analyze must expose `route_intent_review` instead of silently compiling
  a locator-fragile DOM path. The briefing contract must include
  omitted steps, target state URL, proofs, and risks. The CLI briefing must
  be shown before asking for a verdict; the accepted result is
  `analysis/route-intent-result.json`. The orchestrator uses
  `review-route-intent --run-id <id>` and
  `review-route-intent --run-id <id> --apply <route-intent-result.json>`
  to persist the decision before generate or verify proceeds.
- URL-only final-state workflows are valid when query/hash state or
  another proof demonstrates the intended final state. A path with only a
  bare final URL and no state/evidence/transition proof is a compile
  failure (`tests/analyze/compile.test.mjs` proves both cases).
- Deterministic output: the same sanitized input must yield the
  same YAML (golden-output coverage in `tests/analyze/compile`).

**Recovery**
- Missing or empty input → explicit failure, no partial YAML
  emission.
- Unrepresentable event sequence → fail with a specific reason in
  the analyzer's return so the orchestrator can surface it.

**Tests covering this contract**
- `tests/analyze/compile.test.mjs` — deterministic compile,
  proof-set derivation, URL-state final workflows, and insufficient
  proof failure.
- `tests/e2e/url-state-proof.test.mjs` — URL-state final URL workflow
  analyzes and verifies without an action-triggered network gate.
- `tests/e2e/full-loop.test.mjs` — analyzer's end-to-end
  participation across fixtures.

## Safety Layers

| Layer | Item | Where enforced |
|-------|------|----------------|
| Role | Permitted to read sanitized events and write `path.yaml` + `recipe.yaml`; not permitted to access raw event files or mutate the `artifacts/` event store | `agents/analyzer/openai.yaml` (`role_type: phase`, `phase: analyze`, `guardrails`) |
| Gate | Input scope check — `sanitized-events.json` (plus selector inventory, network summary, manifest) must exist before compile begins | `scripts/analyze/compile.mjs` precondition check; missing input → explicit failure with no partial YAML emission |
| Structural | Input read path uses sanitized events only | `scripts/analyze/compile.mjs` reads `sanitized-events.json`; no code path opens raw events |
| Structural | `artifacts/` event files are immutable | analyzer code has no write path back to events; `artifacts/` is filesystem-level append-only per run |
| Rule + Hook | Mandatory verification proof-set derivation | `scripts/analyze/compile.mjs` fails compile when only a bare final URL exists; `tests/analyze/compile.test.mjs` proves URL-state acceptance and insufficient-proof failure |
| Structural | Atomic two-output: both `path.yaml` and `recipe.yaml`, or explicit failure (no partial emission) | analyzer's return contract; tests enforce |

## Knowledge

See `knowledge-pattern.md` — tracks compilation accuracy and event-pattern anomalies across runs.
