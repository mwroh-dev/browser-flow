# Scraping / Extraction Subsystem — Design Spec

> **Status:** SPEC (design-level). Not yet decomposed into granular TDD task plans.
> Approval gate: review this spec before any code. Per-subsystem granular plans
> (writing-plans format, bite-sized TDD) follow spec approval — one plan at a time
> (`harness-hill-climbing`: one change per iteration).

**Goal:** Let the orchestrator extract structured data from a captured page by
generating a reusable, deterministic extractor **once** (LLM at setup), then
running it **forever at zero token cost** (`bf extract`, no LLM, no browser),
with drift surfaced by a golden liveness probe.

**Architecture:** Mirror the existing `scope` subsystem exactly. A sub-agent
(`scraping-agent`, single `SKILL.md`, Task/Agent dispatch, no external LLM) reads
a gunzipped DOM snapshot + a target schema and emits an `extractorConfig`
(linkedom selectors) plus a **golden sample** (the user's known-good result as
the drift oracle). `bf extract` runs the config deterministically via **linkedom**
(already a dependency). Configs persist in `knowledge/scraping/<pageKey>/`
(committed, cross-flow reusable, keyed by `derivePageKey`) — a domain **separate**
from the page-node structure graph. Drift = runtime golden-probe failure (mirrors
the runner's `heldAtSegment` evidence failure); repair mirrors heal's
request→result→apply three-file pattern.

**Tech Stack:** Node ESM (`.mjs`), `linkedom@^0.18.12` (HTML parse), `zod@^4`
(schemas), `node:zlib` `gunzipSync` (snapshots are `.html.gz`), `node:test` +
`node:assert/strict` (tests). No new dependencies.

---

## 1. Locked Design Decisions

These three were resolved with the user before this spec. They are binding.

### ① Storage — scraping is a domain SEPARATE from the page-node graph

Duck-typing separation: the page-node graph cares about **structure** ("what kind
of page"); scraping cares about the **content/instance** ("today's data"). News:
yesterday's vs today's content differs, layout is identical → the two axes are
orthogonal, so the two domains do not depend on each other.

- **적립 (accumulate, committed):** `knowledge/scraping/<pageKey>/config.json` +
  `golden.json`. Durable, accumulates across runs, survives deployments.
- **사용 (use, ephemeral, gitignored):** `artifacts/runs/<id>/extract-result.json`
  — the data this run actually pulled. Regenerated each run.
- **The one shared point:** the storage **key** is structural identity, computed by
  the existing `derivePageKey(rawUrl, fixture)` (`scripts/lib/page-key.mjs:47`).
  We reuse the **keying function** (so layout-stable / content-volatile pages map
  to one config), NOT the page-node graph's consumption logic. Shared utility, not
  a dependency.

Rationale: prevents the "N copies diverge silently" defect
(`purpose-scoped-authority`) while NOT coupling scraping to the unfinished
page-node consumption layer (no scope explosion).

### ② Drift — golden liveness probe, conditional + 3-state, all deterministic

The user's capture is ground truth: at capture they got real data, so we hold a
**golden sample** (cardinality + sampleValues + the known-good query). Empty
results alone cannot distinguish "true zero today" from "selector drifted" — the
golden sample is the oracle that disambiguates.

Runtime contract (pure, token 0):
```
run extractorConfig → rows
  rows non-empty                                  → status "data"          (return rows)
  rows empty:
    retry(2)                                      (transient guard; live-replay only)
    container selector RESOLVES (≥1 in DOM)       → status "confident-zero" (page intact, genuinely 0)
    container selector ABSENT                     → status "drift"          (emit heal-request, report user)
  cardinality dropped ≥ threshold vs golden       → status "drift"          (suspicious; escalate)
```

3-state return so chained flows (A→B) never silently propagate empty as valid:
`{ data | confident-zero | drift }`. The golden probe is **conditional** — fires
only on empty/suspicious primary result, never on every run (no redundant cost).
Drift trigger is a **runtime** signal (mirrors `heldAtSegment`), NOT `bf doctor`
(operator-facing). `doctor` staleness is a complementary enrichment signal only.

### ③ Pagination — setup-time LLM classification; loop lives in replay

Pagination is the user's **intent** captured at Q&A, not a recorded button-mash
macro. Page 1 structure == page N structure (same layout) → one page-1 config
covers all pages. The setup LLM (scraping-agent) **classifies**:
- **simple** → emit a deterministic loop directive (`while next exists & page<limit:
  extract, click-next`); runtime loop runs in **replay** (which holds the live
  browser), token 0.
- **complex/conditional** → flag for LLM orchestration (main model composes pages,
  value prop #2); tokens by nature.

`extractorConfig` carries **no** `pagination` field (a static-snapshot extractor
cannot click "next" — that field would be a non-executable lie,
`schema-valid-not-runtime-executable`). Pagination intent lives at flow level
(`scrape-result.pagination`), consumed by the replay loop, not the extractor.

---

## 2. Constitution Compliance Map (30 principles)

Source: `/Users/cielo-iamdt/Downloads/folder-structure/confirmed/`.

| # | Principle | How this design satisfies it |
|---|-----------|------------------------------|
| 1 | artifact-vs-knowledge | config/golden → `knowledge/scraping/` (committed); per-run data → `artifacts/runs/` (gitignored) [①] |
| 2 | purpose-scoped-authority | one config per pageKey = single source; no silent divergence across flows [①] |
| 3 | agent-directory-structure | regenerable→gitignore (run data), accumulating→commit (config). Mirrors `knowledge/pages/` |
| 4 | code-over-prompt | LLM emits config once at setup; `bf extract` runs deterministically, 0 model calls. Break-even ~17 runs |
| 5 | knowledge-update-strategies | Strategy B + prediction-error: config updates only on golden-probe drift, not every success [②] |
| 6 | lessons-as-anti-pattern-registry | drift failures append one-line lessons to `knowledge/scraping/failures.md` |
| 7 | agent-as-contract-not-code | scraping-agent SKILL = declarative I/O contract; no retry/loop logic embedded |
| 8 | purpose-scoped-authority (agent) | agent authoritative over selector derivation only; not over what-to-extract (schema) or when-to-heal |
| 9 | subagent-per-task-isolation | each dispatch self-contained: snapshot + schema + (for heal) diff. No dialogue history |
| 10 | per-agent-knowledge-patterns | reasoning agent → Strategy B, N≥3 before promoting an episodic config to durable |
| 11 | schema-valid-not-runtime-executable | 4 gates: Shape (zod) / Semantic (valid selector + field∈schema) / **Fact (selector matches snapshot)** / Supportability (linkedom can run it). Gate-3 = container resolution [②] |
| 12 | 3-tier-observability | raw (artifacts/runs telemetry) → evidence (extract-result.json) → report (drift/success aggregates) |
| 13 | failure-logging-anti-survivorship | log empty/drift/no-schema runs equally; failed snapshots become regression fixtures |
| 14 | multi-layered-safety-via-code | Role (read-only) / Gate (allowlist) / Rule (never extract redacted) / Hook (drop `<redacted-…>` in code) |
| 15 | skill-surface-types | scraping-agent = single `SKILL.md`, no manifest (matches scope-agent/heal-agent) |
| 16 | rule-is-not-skill | "never emit redacted", "selector must match" = code gates (fire always); "generate config" = skill (fires when dispatched) |
| 17 | evaluation-before-implementation | §6 eval cases defined before any task; each plan is TDD (test first) |
| 18 | evaluation-as-behavioral-spec | tests assert the trace (container resolves → rows → 3-state), not just final output |
| 19 | dual-polarity-evaluation | §6 golden cases (listing/article/confident-zero) + red cases (drift/no-schema/redacted/bad-selector) |
| 20 | atomic-commit-traceability | each TDD step = one verifiable change; subsystems split into independently shippable plans |
| 21 | front-loaded-specification | this spec front-loads contracts, acceptance, out-of-scope before delegation |
| 22 | phase-vs-lane-execution | capture→agent→config→extract is a serial phase; multi-page extractions are a lane (parallel) |
| 23 | plan-as-control-structure | runtime checkpoints (gate→extract→golden-probe); on divergence, replan (heal), not blind retry |
| 24 | constraint-hierarchy | 1–2 hard invariants (no redacted/credential extraction); rest = code gates + knowledge patterns [②③] |
| 25 | human-checkpoint-by-design | drift → report to user; no-schema → surface gap; never fabricate (value prop #4) [②] |
| 26 | direction-maintenance | 3-state return defeats "consistent empty JSON = false reliability" [②] |
| 27 | orchestrator-gated-context | agent gets only snapshot + schema + pageKey; not full replay history |
| 28 | prompt-ambiguity-as-root-cause | ambiguous schema/duplicate containers → agent returns no-schema with reason, not a guess |
| 29 | structured-seed-directive | SKILL.md seed = direction/constraints/priorities/prohibitions (selector quality ranking) |
| 30 | harness-hill-climbing | plans built one subsystem at a time; one change per TDD iteration |

---

## 3. Data Contracts

All Zod schemas added to `scripts/lib/schemas.mjs`, versions to
`scripts/lib/schema-versions.mjs`. Mirror `ScopeResultV1` / `HealResultV1` style
(`schemaVersion: z.literal(...)`, `.passthrough()`, discriminated union export +
`parseXxx` reader).

### 3.1 `SCHEMA_VERSIONS` additions (`scripts/lib/schema-versions.mjs`)
```js
scrapeResult: 1,
extractHealResult: 1,
// (ACCEPTED_VERSIONS gets the matching [1] entries)
```

### 3.2 `ExtractorConfigV1` — the reusable artifact (stored in knowledge/)
```jsonc
{
  "schemaVersion": 1,
  "pageKey": "manual/news.naver.com/section/:id",   // derivePageKey
  "container": "div.list_body",                       // null for single-item (article/detail)
  "fields": [
    {
      "name": "title",
      "selector": "a.news_tit",                       // relative to container when container != null
      "attribute": "textContent",                     // "textContent" | any HTML attribute name
      "required": true,
      "fallbackSelector": null,                       // tried if selector yields nothing
      "transform": null                               // null | "trim" | "parseInt" | "parseFloat"
    }
  ]
}
```

### 3.3 `golden.json` — the drift oracle (stored in knowledge/, decision ②)
```jsonc
{
  "schemaVersion": 1,
  "pageKey": "manual/news.naver.com/section/:id",
  "capturedAt": "2026-05-23T...Z",
  "cardinality": 24,                                  // item count at capture (container children)
  "sampleValues": [ { "title": "...", "url": "..." } ],// first 1–3 real rows from the capture snapshot
  "queryRef": { "stepIndex": 3, "url": "https://..." } // the known-good invocation to re-probe at runtime
}
```

### 3.4 `scrape-request.json` — agent input (mirror scope-request)
```jsonc
{
  "runId": "<id>",
  "candidates": [
    { "stepIndex": 3, "pageKey": "<key>",
      "targetSchema": { "fields": [ { "name": "title", "description": "headline", "required": true } ] } }
  ],
  "snapshotsManifestPath": "artifacts/runs/<id>/snapshots-manifest.json",
  "snapshotsDir": "artifacts/runs/<id>/snapshots"
}
```

### 3.5 `ScrapeResultV1` — agent output (mirror ScopeResultV1)
```jsonc
{
  "schemaVersion": 1,
  "runId": "<id>",
  "stepIndex": 3,
  "status": "extracted",                              // "extracted" | "no-schema"
  "pageType": "listing",                              // "listing"|"article"|"detail"|"search"
  "extractorConfig": { /* §3.2 minus pageKey (added on apply) */ },
  "golden": { "cardinality": 24, "sampleValues": [ /* real rows */ ] },
  "pagination": { "kind": "none" },                   // "none"|"simple"|"complex" (decision ③)
  //   simple → { kind, nextSelector, limit }
  //   complex → { kind, note }
  "reason": "<why nothing extractable>",              // required when status="no-schema"
  "note": "<short rationale>"
}
```

### 3.6 `Step.extraction` — workflow.json reference (NOT inline config)
Added to `Step` schema in `schemas.mjs` (the schema is `.passthrough()`):
```jsonc
"extraction": {
  "pageKey": "<key>",                                 // → knowledge/scraping/<key>/config.json
  "status": "extracted",                              // "extracted" | "no-schema"
  "pagination": { "kind": "none" }
}
```

### 3.7 `extract-heal-request.json` / `ExtractHealResultV1` (mirror heal)
```jsonc
// request (emitted by runtime on status="drift")
{ "pageKey": "<key>", "stepIndex": 3,
  "expected": { "cardinality": 24, "sampleValues": [...] },   // from golden
  "observed": { "cardinality": 0, "containerResolved": false },
  "liveSnapshotPath": "artifacts/runs/<id>/snapshots/..." }

// ExtractHealResultV1 (sub-agent output)
{ "schemaVersion": 1, "runId": "<id>", "pageKey": "<key>",
  "status": "healed",                                          // "healed" | "unrepairable"
  "extractorConfig": { /* re-derived */ },
  "reason": "<required when unrepairable — e.g. 'price field removed from page'>" }
```
`unrepairable` ⇒ surface to user (value prop #4 "변경점 알림"), never fabricate.

---

## 4. File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `scripts/extract/extractor.mjs` | create | **pure** linkedom runner: `(html, config) → { status, rows, cardinality, containerResolved }`. The deterministic core. No LLM, no browser |
| `scripts/extract/golden-probe.mjs` | create | **pure** 3-state disambiguation: `(primary, golden) → "data"|"confident-zero"|"drift"` |
| `scripts/extract/extract-apply.mjs` | create | **pure** apply: `(workflow, scrapeResult) → { workflow, config, golden }`; writes `step.extraction`, returns config+golden for knowledge persist |
| `scripts/commands/extract.mjs` | create | `bf extract` command (2-tier export). No `--apply`: emit scrape-request. `--apply <result>`: apply + persist to knowledge + regenerate. `--run` : execute config on snapshot, write extract-result |
| `scripts/commands/extract-heal.mjs` | create | `bf extract-heal` (mirror `heal.mjs`): read request / `--apply` re-derived config |
| `scripts/lib/scraping-paths.mjs` | create | `scrapingPaths(pageKey) → { configPath, goldenPath, failuresPath }` under `knowledge/scraping/<key>/` (mirror `pagePaths`); honor `BROWSER_FLOW_PAGES_PATH`-style env for test isolation |
| `scripts/lib/schemas.mjs` | modify | add `ExtractorConfigV1`, `ScrapeRequestV1`, `ScrapeResultV1`, `ExtractHealResultV1`, `Step.extraction`; add `parseScrapeResult`, `parseExtractHealResult` |
| `scripts/lib/schema-versions.mjs` | modify | add `scrapeResult: 1`, `extractHealResult: 1` (+ ACCEPTED_VERSIONS) |
| `scripts/cli.mjs` | modify | register `extract`, `extract-heal`; add help lines |
| `.codex/skills/scraping-agent/SKILL.md` | modify | fix: cheerio→**linkedom**; snapshots are **`.html.gz`** (gunzip); **remove** `pagination` from extractorConfig; add **golden** emission; add **pagination classification** (simple/complex); add **selector quality ranking** seed |
| `.codex/skills/extract-heal-agent/SKILL.md` | create | drift-repair sub-agent (mirror heal-agent): reads extract-heal-request, emits ExtractHealResult, honest `unrepairable` |
| `tests/extract/*.test.mjs` | create | per-subsystem tests (node:test) |

`bf extract` setup is **intent-driven** (orchestrator passes target schema from
user Q&A) — unlike `scope` it is NOT auto-flagged by `compile.mjs`. So
`compile.mjs` is **not** modified.

---

## 5. Subsystem Decomposition (4 independently shippable plans)

Per writing-plans Scope Check, this is multi-subsystem. Build in order; each
plan ships working, tested software on its own. Granular TDD expansion happens
per plan, after this spec is approved, one at a time.

### Plan 1 — Deterministic extractor core (FOUNDATION)
`extractor.mjs` + `golden-probe.mjs` + `ExtractorConfigV1` schema. Pure functions,
linkedom, gunzip. Fully TDD-able with static HTML fixtures. No LLM, no browser, no
storage. Delivers: given a config + snapshot → 3-state structured result.
**Independently testable. Highest value, lowest risk. Start here.**

### Plan 2 — Setup path: scraping-agent + scrape-request/result + `bf extract`
SKILL.md fixes, `ScrapeRequest/ResultV1`, `extract.mjs` (emit + apply),
`extract-apply.mjs`, `Step.extraction`, SCHEMA_VERSIONS. Depends on Plan 1's
config schema. Delivers: orchestrator can dispatch the agent and apply a config.

### Plan 3 — Durable storage + golden persistence + structural keying
`scraping-paths.mjs`, `knowledge/scraping/<key>/` persistence, golden.json,
artifact→knowledge promotion. Depends on Plan 1+2. Delivers: cross-flow reuse,
token-0 on second run.

### Plan 4 — Extraction-heal (drift repair) + pagination
`extract-heal.mjs`, `extract-heal-agent` SKILL, runtime golden-probe wiring into
replay, pagination (setup classification + replay loop). Depends on all.
Delivers: value prop #4 (self-repair / notify) + multi-page.

---

## 6. Evaluation Cases (dual-polarity, defined before implementation)

**Golden (must pass):**
1. Listing: container `ul.list` + relative field selectors → N rows with correct values.
2. Article: `container=null`, single-zone fields (`h1` title, `article` body) → 1 row.
3. Confident-zero: container resolves, 0 children → status `confident-zero` (not drift).
4. Fallback selector: primary selector empty, `fallbackSelector` hits → value returned.
5. Transform: `transform:"parseFloat"` on `"₩1,290"` → numeric (after strip).

**Red (must fail / refuse):**
6. Drift: container absent in snapshot → status `drift` (emit heal-request).
7. No-schema: no reliable selectors for the target schema → agent returns `no-schema` + reason (no guess).
8. Redacted: a `<redacted-…>` value is never emitted as data (code hook drops it).
9. Bad selector: invalid CSS → Gate-2 (Semantic) rejects before execution.
10. Cardinality collapse: golden 24 → live 1 (≥ threshold drop) → status `drift`.

---

## 7. Risks & Open Questions

- **R1 (linkedom selector parity):** linkedom supports `querySelectorAll` but not
  every CSS4 selector. Gate-4 (Supportability) must catch unsupported selectors at
  apply time. Plan 1 must test the selector subset linkedom actually runs.
- **R2 (pagination in replay):** Plan 4 wires the loop into the replay runner,
  which is CDP-direct (`scripts/cdp/`). Bounded by `limit`; no unbounded loop
  (safety posture). Needs a max-iteration cap + per-page atomic checkpoint.
- **R3 (golden re-probe cost in live replay):** the golden re-probe re-navigates
  the captured query. Acceptable because it fires only on empty/suspicious. For
  pure `bf extract` on a snapshot, structural container-resolution is the oracle
  (no re-nav needed).
- **Q1:** `knowledge/scraping/<key>/` vs folding under `knowledge/pages/<key>/extraction/`.
  Spec chooses a **separate** top-level domain (decision ①, decoupling). Confirm.
- **Q2:** Promotion gate (episodic→durable, Strategy B N≥3) — deferred to a later
  iteration (first-write-wins in Plan 3). Confirm deferral.

---

## 8. Handoff

On spec approval, expand **Plan 1** to granular TDD tasks (writing-plans format,
bite-sized steps with full code). Do not expand Plans 2–4 until Plan 1 lands
(`harness-hill-climbing`). Plan 1 alone is shippable, testable, zero-risk
foundation.
