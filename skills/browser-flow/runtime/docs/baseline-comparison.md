# Baseline Comparison — Playwright codegen vs browser-flow

Scope: `synthetic` fixture only. The remaining four fixtures (`docs`,
`stateful`, `submit`, `secret`) are out of scope; extending the
comparison is a future candidate.

Last reviewed: 2026-05-19.

## What this document answers

Is `npx playwright codegen` + manual editing — the cheapest off-the-shelf
alternative — a good substitute for the browser-flow pipeline on a single
small workflow?

The pipeline has an internal test suite (see `npm run check`), a trace-grading eval, a
governance gate, and a false-positive guard (`tests/e2e/
false-positive-guard.test.mjs`). None of that compares against the *next-
best alternative*. This document closes that gap for one fixture.

## Methodology

Both paths target the same observable behavior:
- fill `[data-bf="name-input"]` with a string value,
- click `[data-bf="launch"]` (the "Run Demo" button),
- land on `/synthetic/result?name=...`,
- see the text "Workflow Complete" in `[data-bf-evidence="result"]`.

**Path A — Playwright codegen** (`docs/baseline/codegen-synthetic.spec.ts`)

Live recording. The fixture server was started by this session
(`scripts/fixtures/site-server.mjs`); the operator ran
`npx playwright codegen http://127.0.0.1:<port>/synthetic`, performed
the workflow in the recorder, and copied the Inspector's emitted code
verbatim. No edits.

**Path B — browser-flow pipeline** (`docs/baseline/runner-synthetic.mjs`)

The existing e2e test (`tests/e2e/full-loop.test.mjs`, "full loop passes
for the synthetic fixture") was executed once. The resulting
`artifacts/runs/<run-id>/generated/runner.mjs` was copied verbatim into
this docs tree as a frozen reference. The header in the snapshot
explains why it is not executable from its committed location.

Both files have a header comment block declaring their provenance and
their non-executability from `docs/baseline/`. They are reference
material; they are not run.

## Lines of code

| File | Header lines | Code lines | Total |
|------|--------------|------------|-------|
| `codegen-synthetic.spec.ts` | 18 | 12 | 30 |
| `runner-synthetic.mjs` | 19 | 419 | 438 |

The 35× code-size delta is misleading on its own — almost every line in
the runner is enforcing a guarantee that Path A does not even
articulate. The next section quantifies that.

## Guarantee matrix

For each property the workflow should satisfy, what does the artifact
verify?

| Guarantee | Path A (codegen) | Path B (browser-flow runner) |
|-----------|------------------|------------------------------|
| Replay reaches the final URL | ❌ implicit (no assertion) | ✅ explicit (`expectedFinalUrl` check + `waitForExpectedUrl`) |
| Expected network call fires | ❌ not captured | ✅ explicit (`expectedNetwork`: POST `/api/complete?mode=synthetic` status 200) |
| Result evidence text is present | ❌ surrogate: clicks on text (does not assert) | ✅ explicit (`expectedEvidence`: `data-bf-evidence="result"` contains "Workflow Complete") |
| Selector still resolves to the same field identity | ❌ no check | ✅ fill-path mismatch / action-path mismatch (`fieldName`, `text`, `href` comparison) |
| Form identity check (if submit) | ❌ no concept | ✅ submit-path mismatch (`formIdentitySelector`, `formId`, `formName`, `formAction`, `formMethod`) |
| Secret values are not echoed verbatim | ❌ raw input value present in script | ✅ secret-flagged steps read from `BROWSER_FLOW_SECRET_0`, with a `secret-missing` failure class |
| Isolated replay profile | ❌ uses shared dev profile | ✅ fresh `mkdtempSync(tmpdir(), …)` per replay, removed in `finally` |
| Truthful-replay verification artifact | ❌ none | ✅ `reports/verification.json` written every replay |
| Output is registered as a verified workflow | ❌ no concept | ✅ `knowledge/registry/workflows.json` upsert with `status: "verified"` |
| Trace emission (trajectory-level eval input) | ❌ no concept | ✅ `trace.jsonl` with one `started` + one `completed` per phase |
| Sanitization of report (URLs / evidence text) | ❌ no concept | ✅ `sanitizeReport` redacts URL/text before writing JSON |

Eleven properties. Path A satisfies zero. Path B satisfies all eleven.

## Parity checklist — what Path A would need to match Path B

To bring `codegen-synthetic.spec.ts` to parity with the runner, the
following manual edits are required.

- [ ] Add an `expect(page.url()).toBe(...)` for the final URL.
- [ ] Capture and assert the `/api/complete?mode=synthetic` POST and its
      `200` status (e.g., `page.on('response', …)` + post-flow check).
- [ ] Replace the `getByText('Hello, 테스트').click()` and
      `getByRole('heading', { name: 'Workflow Complete' }).click()` lines
      with `expect(...).toBeVisible()` / `toContainText(...)` against
      `[data-bf-evidence="result"]`.
- [ ] Remove the four `page.locator('html').click()` lines (recorded
      noise from the operator clicking the page chrome).
- [ ] Mint a fresh user-data-dir per replay or `test.use({ storageState:
      undefined })`; do not rely on the dev profile.
- [ ] Replace the literal `'테스트'` with a parameter or env-driven
      value; add a check that the value is not logged when it is a
      secret.
- [ ] Wrap the script in a runnable harness that writes a structured
      report file (Playwright test runner alone does not produce one in
      the shape the rest of the pipeline expects).
- [ ] Add a registry write for the verified flow.
- [ ] Emit a phase-ordering trace.

The first six items are work a developer could plausibly do with LLM
help (productivity delta). **The last three have no off-the-shelf
equivalent in codegen** — they are not optimizations of Path A; they are
capabilities of browser-flow that Path A simply does not offer.

## Codegen noise — what the recording captured but should not have

The operator confirmed that the four `page.locator('html').click()`
calls and the three `getByText(...).click()` / `getByRole('heading',
…).click()` calls were **not** intentional workflow steps. They were
either accidental page-chrome clicks (the `html` clicks) or manual
visual verifications (the user clicked on text to check it was there).

Codegen has no way to distinguish "user is doing the workflow" from
"user is checking that the workflow worked." All clicks become script
steps. This is a structural property of an action-recording tool, not
a bug in this particular recording.

The browser-flow capture daemon does not record raw clicks; it records
selector-attached events and filters them through the analyzer's event-
selection heuristics (see `knowledge/analyzer/semantic/event-selection-
heuristics.md`, the ExpeL seed): 200 ms duplicate-navigation
rule, submit identity requirement, atomic two-output rule. The runner
for the synthetic flow has three steps (`goto`, `fill`, `click`) and no
"clicked-on-the-result-text" steps. The filter is doing real work that
codegen does not even attempt.

## LLM-turn estimate (bounded, not measured)

A developer starting from `codegen-synthetic.spec.ts` and asking an LLM
for help could plausibly reach a *partial* parity (the first six
checklist items) in roughly **3–6 LLM turns** of editing and review,
assuming the developer already knows Playwright assertion APIs. The
last three checklist items (verification report shape, registry write,
trace emission) require either inventing equivalents from scratch or
adopting browser-flow itself.

A real measurement would be a controlled experiment (paired session,
token counter, single operator, both paths). That is **not** what this
phase produces. The 3–6 turn figure is an order-of-magnitude statement
and is labeled here as such.

The more important number is structural: **9 of 11 guarantees in Path B
are not constructible from Path A's output with any number of LLM
turns** — they require running a separate pipeline. Only the first two
columns of the guarantee matrix are reachable by editing Path A.

## Limitations

- Single fixture (`synthetic`). The remaining four are explicitly out
  of scope.
- Path A is a single recording session. A more rigorous baseline would
  average across multiple operators and multiple recording attempts.
- The LLM-turn estimate is bounded, not measured. See above.
- The runner snapshot is from one run; if the pipeline were to be
  meaningfully changed (a future refactor), this snapshot would
  drift and should be regenerated.

## Conclusion

For the `synthetic` fixture, Playwright codegen alone produces a 12-line
script that performs the user's actions and verifies none of them. The
browser-flow pipeline produces a 419-line runner that performs the same
actions and verifies eleven distinct properties about the outcome, plus
maintains a registry of verified flows and emits a trajectory trace.
Two of the eleven properties (final URL, evidence text) are closable
from codegen with manual editing or LLM help; nine require running a
pipeline like browser-flow.

The 35× line-count delta is not the productivity story — the
guarantee delta is. browser-flow is not a faster way to produce a
codegen script; it is a structurally different artifact that codegen
does not produce at any time budget.
