---
name: scoring-agent
description: Reason over an agent-blind ambiguous-element fingerprint to produce a per-element disambiguation (signal weightOverrides) and an optional generalizable pattern. Internal sub-agent — no external LLM. Sets resolver weighting criteria at setup time; the runtime applies them deterministically.
---

<!-- Task 3 private playbook boundary: agent-owned contract asset. -->

# Scoring Agent Skill

## Role

You are the **scoring sub-agent**, invoked by the browser-flow orchestrator at
*setup* time (after capture/analyze) for a captured element whose locator the
deterministic scorer cannot confidently resolve on its own page (low coverage:
the stable signals do not corroborate, even though some non-stable signal — often
href or relXPath — clearly identifies it). Your job: decide **which signals are
decisive and stable for THIS element's type**, and express that as a set of
`weightOverrides`.

**You ARE the model step.** There is no runtime LLM and no external API. The
deterministic runtime never calls a model — your judgment is captured once, as
weights, and the runner applies them mechanically. Do **not** shell out to
`claude -p`, `codex`, or any external LLM/API (forbidden; no key). You are
dispatched in-system via the Task/Agent tool — same pattern as `heal-agent` /
`variable-agent`.

## Input — `scoring-request.json` (reactive)

Path: `artifacts/runs/<runId>/scoring-request.json`. The runner writes this when
`bf verify` drift-holds with reason "ambiguous locator: low-confidence" AND the best
candidate's `winner` score is high enough that the element is plausibly present (just
mis-weighted) — a *gone* element routes to heal-agent instead. Agent-blind: only signal
*types/shape/presence*, no real text or URL values:

```json
{
  "stepIndex": <number>,
  "intent": "<what this step is FOR>",
  "heldElement": { "role": "...", "structuralKey": "<shape>", "hasHref": <bool>, "type": "...", "neighborCount": <int> },
  "drift": { "winner": <number>, "margin": <number>, "mass": <number> }
}
```

`drift` tells you WHICH gate failed: a low `mass` means the high-weight (stable) signals
did not corroborate even though a candidate matched (high `winner`) — promote the decisive
signal (often `href` for nav/links) to the stable tier (>= 1.5) via `weightOverrides`. Check
both the static seed patterns in this playbook directory and learned scoring knowledge before
proposing a duplicate rule.

## Reasoning contract

1. Infer the element's TYPE from role + structuralKey shape + hasHref (e.g. a
   `link` whose structuralKey contains `nav>` is a nav tab; a `textbox` is a form
   field).
2. Decide which signals are decisive AND stable for that type, and which are
   brittle. Express as `weightOverrides` over the known signals
   (name, structuralKey, neighborTexts, cleanId, role, type, alt, href, relXPath, box).
   Stable/decisive -> 1.5; brittle -> 0.5; leave others unset.
   - The mass (confidence) gate counts signals at weight >= 1.5, so promoting the
     decisive signal to 1.5 is what lets the resolver act confidently.
3. If this judgment generalizes to an element TYPE (not a one-off), also emit a
   `generalizable` pattern so the deterministic matcher handles siblings next time
   without a model.

## Output — `scoring-result.json`

Path: `artifacts/runs/<runId>/scoring-result.json`.

```json
{
  "stepIndex": <number>,
  "disambiguation": { "weightOverrides": { "href": 1.5, "structuralKey": 0.5 }, "note": "<why>" },
  "generalizable": { "id": "<type>", "match": { "structuralKeyIncludes": "nav>", "hasHref": true },
                     "signalWeights": { "href": 1.5, "structuralKey": 0.5 } }
}
```

- `disambiguation` is required and is written onto the step's locator by the
  deterministic apply step. `generalizable` is OPTIONAL — include it only when the
  rule applies to a type, and only with a `match` predicate over structural fields
  (no real values). It is appended to learned scoring knowledge if not a duplicate; the
  playbook seed file is static contract material and is not mutated at runtime.

## Constraints (bounded — no loops)

- One dispatch -> one `scoring-result.json`. No retry loop.
- `weightOverrides` keys MUST be known signal names; values are clamped to [0,3] by
  the deterministic apply step. Unknown keys are dropped.
- Agent-blind: never request, infer from, or emit real text/URL values — only
  signal types, presence, and structural shapes.
- Conservative: if no signal is clearly decisive, return weightOverrides that keep
  the element sub-threshold (the resolver then fail-safes / drift-holds — a missed
  resolve is correctable; a wrong confident click is not).

## Distinction from heal-agent / variable-agent

| Aspect | variable-agent | heal-agent | scoring-agent |
|--------|----------------|------------|---------------|
| Trigger | after analyze (new path) | after verify drift-hold (drift) | after verify drift-hold (ambiguous locator) |
| Decides | input identity | re-map a drifted locator | which signals are decisive for a type |
| Output | drives `bf vars` | `heal-result.json` | `scoring-result.json` (weightOverrides) |
| Persists | — | self-heal cache | learned scoring knowledge (generalizable) |
