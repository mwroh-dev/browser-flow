---
agent: analyzer
strategy: B(N=3)
version: 1
replaces: null
updated_after_runs: []
prediction_match: null
last_updated: 2026-05-19T00:00:00Z
---

# Semantic Knowledge — `analyzer` — `event-selection-heuristics`

Scope: analyzer-owned event-selection rules accumulated from
operator inspection of captured CDP event streams across the
existing fixture set. Authority for which event types graduate
into the compiled `path.yaml`. Source-of-truth for these rules
lives here; the analyzer's prompt and AGENT.md may reference but
do not override.

## Pattern

The analyzer should treat the following CDP event sequences as
non-meaningful for workflow compilation and exclude them:

1. **Duplicate navigation propagation.** A `navigate` event whose
   `timestamp` falls within 200 ms of a preceding `click` on the
   same selector is the browser's own URL update for that click,
   not a user action. Including it produces a path with a
   redundant `goto` step.
2. **Submit-without-input noise.** A `submit` event without any
   preceding `input` events on form fields in the same window is
   either automation-injected (test runners, bots) or a stale
   page state. The capture is rejected at compile time
   (`scripts/analyze/compile.mjs` throws
   "Unable to derive truthful submit identity") and the run is
   reported as a fixture issue.
3. **Form action without identifier.** A `submit` event whose
   `formIdentitySelector`, `formId`, `formName`, and
   `formAction` are all empty is a synthetic submission and
   cannot be replayed truthfully — the analyzer must fail closed
   rather than emit a partial action.

## Supporting Episodes

Seeded from operator inspection of all fixtures shipped in
`scripts/fixtures/` (`synthetic`, `docs`, `stateful`, `submit`,
`secret`) plus the test-time runs in `tests/analyze/compile.test.mjs`
and `tests/e2e/full-loop.test.mjs`. The 200 ms threshold matches
the actual click→propagated-navigation window observed in
synthetic+docs runs against the bundled site-server fixture; no
single run is authoritative — the value was chosen because
captured timestamps in 50+ tests cluster below it.

First automated `updated_after_runs` entry expected once
`B(N=3)` synthesis fires on real (non-test) episodic records
accumulated in `knowledge/analyzer/episodic/`. Until then this is
a hand-authored seed per ExpeL cold-start bootstrap
(arXiv:2308.10144).

## Application

Before emitting a step into `path.yaml`:

- For each `navigate` event, check the immediately preceding
  event. If it is a `click` on the same selector and the
  timestamp delta is `≤ 200 ms`, set the click's `expectUrl` to
  the navigation target and do NOT emit a separate `goto` step.
  This is already the behavior in `scripts/analyze/compile.mjs`
  (the `lastAction.expectUrl = …` branch); this rule documents
  the threshold rationale.
- For each `submit` event, refuse compile if all four submit
  identity fields are absent and the selector is a plain element
  name. Surface to the orchestrator with
  `Unable to derive truthful submit identity` so the user can
  re-capture cleanly.

## Provenance Note

Confidence: operator-level (hand-authored seed, not
cross-episode-verified). The 200 ms threshold is the most likely
candidate for prediction-error firing once
`B(N=3)` synthesis runs — if real captures show clusters at
larger windows, this version will be replaced with a `version: 2`
entry whose `replaces` points back here.
