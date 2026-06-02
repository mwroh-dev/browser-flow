---
agent: capture
strategy: B+prediction-error
version: 1
replaces: null
updated_after_runs: []
prediction_match: null
last_updated: 2026-05-19T00:00:00Z
---

# Semantic Knowledge — `capture` — `fixture-empty-capture-risk`

Scope: capture-owned predictions about which fixtures are prone
to empty captures (the `done` callable receives zero meaningful
events) and what the capture agent should signal back to the
orchestrator before time is spent compiling and verifying. Source
-of-truth for early-warning capture-quality signals.

## Pattern

Three fixture types carry a non-zero empty-capture risk and
warrant the capture agent surfacing a warning to the orchestrator
before `done` returns:

1. **`secret` fixture without keyboard interaction.** The secret
   fixture's password-bearing path requires actual keyboard input
   events. If the operator demonstrates the path with paste
   (Cmd+V) or with autofill, CDP may emit a single `input` event
   with the full value rather than per-character keypress events,
   and the secret-redaction step in `scripts/sanitize/` may not
   trigger correctly.
2. **`stateful` fixture without prior login step.** The stateful
   fixture assumes a logged-in session. If the operator opens the
   fixture in a fresh isolated profile (which is what `prepare`
   creates), there is no session and the fixture's "logged-in"
   path is unreachable. The capture finishes successfully but
   produces an empty navigation chain.
3. **Window blur during demo.** If the operator switches windows
   during the demo, CDP stops emitting events on the captured
   target. The `done` callable will return with whatever events
   accumulated before the blur — frequently a partial path.

## Supporting Episodes

Seeded from operator observation of the bundled fixtures in
`scripts/fixtures/` and the capture test
`tests/observe/prepare-done.test.mjs`. Behaviors above are
reproducible by hand against the bundled local site-server; no
single recorded episode is authoritative — these are the failure
modes the capture agent should predict and warn about, per the
`B + prediction-error` strategy.

First automated `updated_after_runs` entry expected when the
prediction-error trigger fires (the capture agent predicted a
clean run, but the analyze phase reported truncated input). Until
then this is a hand-authored seed per ExpeL cold-start bootstrap
(arXiv:2308.10144).

## Application

After `prepare` succeeds and before `done` returns to the
orchestrator, the capture agent should:

- For `secret` fixture: emit an `awaiting_capture` note that the
  operator should type the password by hand (no paste, no
  autofill) so per-key sanitization fires.
- For `stateful` fixture: emit an `awaiting_capture` note that a
  login step must be captured first; if the operator skips this,
  the analyze phase's "Unable to derive required transition gate"
  failure is the predicted outcome and should not be reported as
  a verify-side bug.
- On `done`: if `events.length === 0` or contains no `input`
  events for fixtures that require them, surface
  `empty_capture_warning` to the orchestrator with the predicted
  cause from this list. The orchestrator's recommendation can
  then suggest re-capture before spending time on analyze.

## Provenance Note

Confidence: operator-level (hand-authored seed). The first
genuine prediction-error event — an empty capture that none of
the three patterns above explain — will trigger a `version: 2`
update with the new failure mode added.
