---
agent: generator
strategy: B(N=3)
version: 1
replaces: null
updated_after_runs: []
prediction_match: null
last_updated: 2026-05-19T00:00:00Z
---

# Semantic Knowledge — `generator` — `selector-stability-by-fixture`

Scope: generator-owned heuristics for which selector strategy to
prefer when emitting `runner.mjs` Playwright steps, organized by
fixture type. Authority for selector strategy choice; the
verifier's replay attribution uses this to classify replay
failures (selector vs timing vs state).

## Pattern

The bundled fixtures expose different selector stability
profiles:

1. **`synthetic`, `docs`, `submit`** — `data-bf="<key>"` and
   `data-bf-evidence="<key>"` attributes are present on every
   interactive element. Generated runner should prefer
   `[data-bf="…"]` selectors over CSS classes or text content
   because these attributes are deliberately set by the fixture
   site-server and do not change across runs.
2. **`stateful`** — `data-bf` attributes are present, but the
   page also has CSS class names that change between session
   states (logged-in vs logged-out). Generated runner must NOT
   use class-based selectors for any element under
   `stateful/result/*`. Stick to `[data-bf=…]` or ARIA roles.
3. **`secret`** — password fields use `type="password"` rather
   than `data-bf` for the field itself (the field is deliberately
   not labeled to discourage automation tooling). Generated
   runner should use `[type="password"]` for the password field
   and `data-bf="…"` for surrounding fields and the submit
   button.
4. **`manual`** — operator-captured workflows on arbitrary local
   targets. No `data-bf` guarantee. Generated runner should
   prefer ARIA `role` + `name` selectors over text content (which
   may be localized) and over CSS classes (which may be
   stylesheet-driven).

## Supporting Episodes

Seeded from inspection of `scripts/fixtures/site-server.mjs` and
the generated runners in test-time runs of
`tests/generate/runner.test.mjs` and `tests/e2e/full-loop.test.mjs`.
The `data-bf` attribute convention is a deliberate fixture-design
choice documented in the site-server source; for `manual` the
stability profile is inferred, not observed across multiple real
captures.

First automated `updated_after_runs` entry expected when
`B(N=3)` synthesis fires across 3 genuine generation episodes for
the same fixture (e.g., 3 `submit` runs in
`knowledge/generator/episodic/`).

## Application

Before emitting a step's selector field in `runner.mjs`:

- Look up the fixture from `manifest.fixture`. Choose the
  selector source order from this file's table:
  - `synthetic` / `docs` / `submit`: `data-bf` → `data-bf-evidence`
    → ARIA → text content (last resort).
  - `stateful`: `data-bf` → ARIA. Never CSS classes.
  - `secret`: `[type="password"]` for the password input, then
    `data-bf` for everything else.
  - `manual`: ARIA `role` + `name` → `data-bf` if present →
    avoid text content.
- Record the chosen strategy in the runner's emitted comment so
  the verifier can attribute replay failures back to selector
  choice (existing convention; this rule documents the
  rationale).

## Provenance Note

Confidence: operator-level for fixtures `synthetic` / `docs` /
`submit` / `stateful` / `secret` (their site-server source
defines the contract). Confidence: speculative for `manual`
(no aggregate evidence from real captures yet). First real
prediction-error from a `manual` run will likely refine this
section.
