---
agent: verifier
strategy: B+prediction-error
version: 1
replaces: null
updated_after_runs: []
prediction_match: null
last_updated: 2026-05-19T00:00:00Z
---

# Semantic Knowledge — `verifier` — `replay-flake-causes`

Scope: verifier-owned attribution for replay failures that are
NOT genuine workflow defects — flake caused by timing, state, or
selector instability. Authority for classifying a failed replay
into a category that feeds back into the upstream agent's
knowledge rather than being reported as a workflow bug.

## Pattern

Three replay-failure causes recur and should NOT be treated as
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

## Supporting Episodes

Seeded from inspection of `scripts/verify/verify-run.mjs` failure
paths and the false-positive guard tests in
`tests/e2e/false-positive-guard.test.mjs`. The three causes above
are reproducible by hand against the bundled fixtures; no single
real-world episode is authoritative.

First automated `updated_after_runs` entry expected when the
prediction-error trigger fires (a replay failure that fits none
of these three categories — a genuine new flake cause).

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
  `version: 2` of this file with the new category appended.

## Provenance Note

Confidence: operator-level for the three categories. They were
identified from reading the verify-run code and false-positive
test cases, not from production replay statistics. Real replay
runs may surface a fourth cause that this seed does not
anticipate — by design (this is what the prediction-error
trigger detects).
