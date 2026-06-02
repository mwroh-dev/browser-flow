---
agent: verifier
strategy: B+prediction-error
version: 2
replaces: verifier/semantic/replay-flake-causes.v1.md
updated_after_runs:
  - loop-20260604-091912
  - loop-20260604-092245
  - loop-20260604-092716
prediction_match: false
last_updated: 2026-06-04T07:08:28Z
---

# Semantic Knowledge — `verifier` — `replay-flake-causes`

Scope: verifier-owned attribution for replay failures that are
NOT genuine workflow defects — flake caused by timing, state, or
selector instability. Authority for classifying a failed replay
into a category that feeds back into the upstream agent's
knowledge rather than being reported as a workflow bug.

## Pattern

Four replay-failure causes recur and should NOT be treated as
truthful workflow defects:

1. **State race on `stateful` fixture.** The fixture writes to
   in-memory session storage at click time, then the next
   `navigate` reads it. If the replay's network transition fires
   before the in-memory write completes, the next page sees
   stale state and the `expectedEvidence` selector finds
   nothing. Verifier should classify as "timing flake" and feed
   back to the capture agent's `fixture-empty-capture-risk`
   knowledge — re-capture with explicit settle wait.
2. **DOM render race on `docs` fixture.** The docs fixture uses
   client-side rendering for the result panel; the `data-bf-
   evidence` element appears 50–100 ms after the
   `expectedNetwork` response. If the verifier's evidence check
   fires immediately on `networkidle`, it sees the element
   missing. Classify as "render race" and feed back to the
   generator's `selector-stability-by-fixture` knowledge —
   prefer ARIA `role` + accessible name (which Playwright will
   wait for) over `[data-bf-evidence=…]`.
3. **Secret-redaction false positive on `secret` fixture.**
   `scripts/security/scan-artifacts.mjs` HIGH_ENTROPY_PATTERN
   matches the demo password `letmein0123456789` style values
   used in the secret fixture's success-page banner. A green
   replay can still produce a `security.json` finding because
   the success page itself renders a high-entropy-looking token.
   Classify as "redaction false positive — fixture banner" and
   feed back to the security-policy reference, not to the
   runtime sanitizer.
4. **Stateful surface over-constrained by unrelated exact network.**
   Modern CSR/SSR pages often update a visual surface through a
   stateful control plus one or more rendered resources. If analysis
   already produced a high-confidence `stateful-surface-proof` for a
   layered control surface, verifier must not also require an
   automatically selected, top-level exact `expectedNetwork` GET that
   happened near the same boundary. That duplicate proof can drift
   independently of the selected control and rendered surface, causing
   a truthful replay to report `not_verified` even after the action path
   and provider proof passed. Classify this as "proof-model
   overconstraint" and feed back to analyzer proof selection, not to
   timeout tuning or broader verifier tolerance.

## Code-Encoded Hypotheses

The following hypotheses from the Naver weather precipitation loop have
graduated from session notes into runtime code. They are intentionally
generic; none depends on Naver-specific host names, paths, classes, or
query parameters.

| Hypothesis | Runtime encoding | Commit |
|---|---|---|
| Compound surface labels must not be the shared source for capture identity, replay resolution, and skeleton summaries. | Replay identity fields (`identityKey`, `identityShape`, `textParts`, `controlKind`) are captured separately from skeleton entries; resolver scoring uses replay identity rather than skeleton display text. | `1044952 fix: split replay identity projection` |
| A provider primer/reveal step is not useful unless it has an actionable target and leads to a concrete downstream control. | Analyzer prefers concrete reveal targets; generator rejects non-actionable provider primers instead of treating a broad surface state as a clickable proof target. | `81e57ea fix: prefer concrete reveal targets`, `47bf969 fix: require actionable provider primer targets` |
| Stateful rendered surfaces should not be globally gated by a coincidental exact network GET when a high-confidence stateful proof already owns the provider transaction. | `scripts/analyze/compile.mjs` suppresses auto-selected top-level `verification.expectedNetwork` only for high-confidence `stateful-surface-proof` on layered/rendered surfaces with provider context and state-proof replay strategy; exact network proofs remain available elsewhere. | `b69c87f fix: avoid duplicate exact network proof for stateful surfaces` |

## Supporting Episodes

Seeded from inspection of `scripts/verify/verify-run.mjs` failure
paths and the false-positive guard tests in
`tests/e2e/false-positive-guard.test.mjs`. The first three causes
above are reproducible by hand against the bundled fixtures; no
single real-world episode is authoritative.

The fourth cause was promoted after the Naver weather precipitation
loop produced a prediction error against the earlier verifier model:
the path and stateful provider proof could pass while an unrelated
auto-selected exact network proof still forced `not_verified`.

- `loop-20260604-091912` — replay executed all six steps, passed
  stateful proof, and left `workflow.verification.expectedNetwork`
  unset after the fix.
- `loop-20260604-092245` — repeated the same final `강수예측` state
  under a fresh live run.
- `loop-20260604-092716` — third consecutive live run with the same
  proof shape.

## Application

On replay failure, before reporting `verification_failed` to the
orchestrator:

- Read the failure category from the verifier's gate result
  (`action-path` / `transition` / `evidence` / `security`).
- Cross-reference with this knowledge file's pattern list to see
  if the failure fits a known flake category. If yes, surface
  to the orchestrator with `flake_cause: <category>` and an
  upstream-feedback pointer (capture, generator, or
  security-policy).
- If no match, this is a genuine new failure mode — record the
  episode in `knowledge/verifier/episodic/` so the
  prediction-error trigger fires on synthesis and writes a
  later version of this file with the new category appended.
- When a stateful surface proof has already passed, inspect whether
  any failing exact network assertion was auto-selected as a global
  `verification.expectedNetwork` rather than explicitly tied to the
  user intent. If yes, treat the failure as proof-model
  overconstraint. The next analyzer decision should remove the
  duplicate global proof, not increase timeouts or loosen target
  resolution.

## Provenance Note

Confidence: operator-level for the three categories. They were
identified from reading the verify-run code and false-positive
test cases, not from production replay statistics. Real replay
runs may surface a fourth cause that this seed does not
anticipate — by design (this is what the prediction-error
trigger detects).
