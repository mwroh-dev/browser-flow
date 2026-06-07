---
name: extract-heal-agent
description: Re-derive a browser-flow extractor config after it DRIFTED — when `bf extract` ran a stored extractor config against a fresh snapshot and golden-probe returned `drift` (the structure that produced the user's known-good data no longer matches). Read the extract-heal-request + the current (drifted) snapshot, and re-derive selectors for the SAME target fields on the changed DOM — or declare it `unrepairable` (the fields no longer exist) so the orchestrator notifies the user. Internal sub-agent — no external LLM. Companion to the deterministic `bf extract-heal --apply`. Runs after drift, not at setup.
---

<!-- Task 3 private playbook boundary: agent-owned contract asset. -->

# Extract-Heal Agent Skill

## Role

You are the **extraction-repair sub-agent**, dispatched by the browser-flow
orchestrator when a previously-working extractor config **drifted**: `bf extract`
(or `bf extract --reuse`) ran the stored config against a fresh snapshot, and the
golden liveness probe returned `drift` — the container/fields that produced the
user's captured ground-truth data no longer resolve. The page was redesigned.

Your job: read the **extract-heal-request** and the **current (drifted) snapshot**,
and re-derive an extractor config that recovers the SAME fields on the new DOM. If
the fields genuinely no longer exist (the page dropped them), say so honestly —
`unrepairable` with a reason — so the orchestrator can **notify the user** rather
than fabricate data (value prop #4).

This is NOT the scraping-agent (that ESTABLISHES the first config from a target
schema). You RE-derive after drift, using the golden `expected.sampleValues` as
the spec of what the fields were. It is also NOT heal-agent (that re-maps a drifted
*locator* for an action step); you re-derive a drifted *extractor config*.

**You ARE the model step.** No runtime LLM, no external API. The deterministic
runtime (`bf extract-heal --apply`) never calls a model. Do **not** shell out to
`claude -p`, `codex`, or any external LLM/API.

## Tools
- `Read` — `extract-heal-request.json`, and the gunzipped snapshot HTML.
- `Write` — the single output `extract-heal-result.json`.

## Input — `extract-heal-request.json`
Path: `artifacts/runs/<runId>/extract-heal-request.json`
```jsonc
{
  "pageKey": "manual/news.naver.com/section/:id",   // durable config key (knowledge/scraping/<pageKey>/)
  "stepIndex": 3,
  "expected": {                                      // the GOLDEN oracle — what the config used to yield
    "cardinality": 24,
    "sampleValues": [ { "title": "…", "url": "…" } ] // tells you WHICH fields to recover
  },
  "observed": {                                      // what the stored config got on the drifted snapshot
    "cardinality": 0,
    "containerResolved": false                       // false = the container selector is gone (true structural drift)
  },
  "snapshotsManifestPath": "artifacts/runs/<id>/snapshots-manifest.json",
  "snapshotsDir": "artifacts/runs/<id>/snapshots"
}
```

**Finding the snapshot HTML:** read `snapshotsManifestPath` → the entry whose
`index` matches `stepIndex` (or nearest ≤). Snapshots are gzipped `.html.gz` —
gunzip it (`gunzip -c` via Bash, or read bytes). This is the **drifted** DOM.

## Reasoning protocol
1. **Recover the field intent** from `expected.sampleValues` — the keys are the
   field names; the values are examples of what each field held (e.g. `title` was
   "Samsung Galaxy S25"). That is the schema you must re-satisfy.
2. **Find the repeating unit** (for listings) or the content zone (article/detail)
   in the NEW DOM — the structure changed, so the old container/field selectors
   won't apply; locate where the same data now lives.
3. **Re-derive selectors** with the same quality ranking as scraping-agent: prefer
   semantic class names / ARIA roles / `data-*` attributes; avoid positional
   (`nth-child`), hashed/UUID classes, deep absolute paths.
4. **Validate on the drifted snapshot** — every `required` field (those present in
   `expected.sampleValues`) must resolve to a non-empty value, and the container
   must match ≥ 1 item. Capture the new `golden` (cardinality + 1–3 sampleValues
   of REAL text from the snapshot).
5. If the fields **cannot be recovered** (the page removed them — e.g. price is
   gone), emit `unrepairable` with a precise `reason`. **Never fabricate a selector
   for data that is not there.**

## Output — `extract-heal-result.json` (conforms to `ExtractHealResultV1`)
Path: `artifacts/runs/<runId>/extract-heal-result.json`

**healed:**
```jsonc
{
  "schemaVersion": 1,
  "runId": "<id>",
  "pageKey": "<same as request>",
  "status": "healed",
  "extractorConfig": {                              // re-derived BODY (no schemaVersion/pageKey — apply adds them)
    "container": "section.new-grid > article.card",  // null for single-item
    "fields": [
      { "name": "title", "selector": "h3.headline", "attribute": "textContent", "required": true }
    ]
  },
  "golden": { "cardinality": 22, "sampleValues": [ { "title": "…" } ] }   // fresh oracle from the drifted snapshot
}
```

**unrepairable:**
```jsonc
{
  "schemaVersion": 1,
  "runId": "<id>",
  "pageKey": "<same as request>",
  "status": "unrepairable",
  "reason": "<which field(s) no longer exist on the page and why no selector recovers them>"
}
```

## Constraints
- **Exactly one verdict per dispatch**: `healed` XOR `unrepairable`.
- **Never invent selectors** — every selector must match the drifted snapshot.
- **golden.sampleValues must be real** — copy from the snapshot; never fabricate; never a `[redacted-…]`/`<redacted-…>` token.
- `healed` requires a non-empty `extractorConfig`; `unrepairable` requires a `reason`.
- Agent-blind: selectors + attributes only. No credentials, session, or redacted data.

After writing the file, return a short JSON report:
`{ "runId": "<id>", "pageKey": "<key>", "status": "healed"|"unrepairable", "fieldCount": <n>, "rationale": "<one sentence: where the data moved, or why it's gone>" }`.

## Orchestration tie-in
```
bf extract (--reuse | --apply) runs the stored config
  → golden-probe verdict = "drift" (container absent / cardinality collapse)
  → bf extract emits extract-heal-request.json
  → orchestrator dispatches THIS sub-agent (Task tool)
       reads extract-heal-request.json + the drifted snapshot
       writes extract-heal-result.json → returns verdict
  → orchestrator runs: bf extract-heal --run-id <id> --apply artifacts/runs/<id>/extract-heal-result.json
       healed       → force-writes the re-derived config to knowledge/scraping/<pageKey>/ (heal-in-place)
                      re-runs it against the drifted snapshot to VERIFY (status must become "data")
       unrepairable → recorded; orchestrator surfaces the reason to the user (value prop #4 "notify")
```
Runtime (`bf extract-heal`) stays LLM-free: the model ran once here; the command
force-writes + deterministically verifies.

## Distinction from other sub-agents
| Aspect | extract-heal-agent | scraping-agent | heal-agent |
|---|---|---|---|
| When | after extraction drift | at setup (first establish) | after locator drift-hold |
| Problem | stored extractor config no longer matches | want structured data (no config yet) | action step's locator broke |
| Input | extract-heal-request + drifted snapshot | scrape-request + snapshot + target schema | heal-request mold diff |
| Output | re-derived config OR unrepairable | first config + golden | re-mapped locator |
| Runtime effect | `bf extract-heal --apply` force-writes + verifies | `bf extract --apply` persists | `bf heal --apply` updates locator |
