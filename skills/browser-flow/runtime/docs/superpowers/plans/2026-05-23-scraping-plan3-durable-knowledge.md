# Plan 3 — Durable Scraping Knowledge + Cross-Flow Reuse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist the extractor config + golden oracle to a durable, committed,
structure-keyed store (`knowledge/scraping/<pageKey>/`) so a second flow landing
on the same page reuses it with **zero tokens** (no agent) — realizing value
props #1 (token-0 after capture) and #3 (cross-flow reuse).

**Architecture:** A scraping knowledge domain **separate** from the page-node
graph (decision ①), keyed by the SAME structural identity (`derivePageKey`, shared
util — not a dependency on page-node logic). `bf extract --apply` persists
config+golden **first-write-wins** (Q2: promotion gate deferred; heal updates
in place in Plan 4). New: `bf extract --reuse` runs the durable config against a
new run's snapshot, LLM-free.

**Tech Stack:** Node ESM, `zod@^4`, `node:test`. Builds on Plans 1–2. No new deps.

**Spec:** `docs/superpowers/plans/2026-05-23-scraping-agent-spec.md` — decision ①, §3.2/§3.3 (config + golden), §5 (Plan 3).

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `scripts/lib/config.mjs` | modify | `getScrapingRoot()` (env-isolated, mirrors `getPagesRoot`) + `scrapingPaths(pageKey)` → `{ scrapingDir, configPath, goldenPath }` |
| `tests/_setup.mjs` | modify | set `BROWSER_FLOW_SCRAPING_PATH` (test isolation, same pattern as pages) |
| `scripts/extract/scraping-store.mjs` | create | `writeScrapingKnowledge(pageKey, config, golden, {force})` (first-write-wins) + `readScrapingConfig(pageKey)` + `readGolden(pageKey)` (read-or-null) |
| `scripts/commands/extract.mjs` | modify | `--apply` persists durable config+golden; add `--reuse` (token-0 second run) |
| `scripts/cli.mjs` | modify | help line note for `--reuse` |
| `tests/extract/scraping-paths.test.mjs` | create | path tests |
| `tests/extract/scraping-store.test.mjs` | create | store tests |
| `tests/extract/extract-command.test.mjs` | modify | append durable-persist + reuse tests |

**Test commands:** `node --import=./tests/_setup.mjs --test tests/extract/<file>.test.mjs`; full `npm test`; types `npx tsc --noEmit`.

---

## Task 1: getScrapingRoot + scrapingPaths + test isolation env

**Files:** `scripts/lib/config.mjs`, `tests/_setup.mjs`, `tests/extract/scraping-paths.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/scraping-paths.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { scrapingPaths } from "../../scripts/lib/config.mjs";

test("scrapingPaths maps a pageKey to config + golden under the scraping root", () => {
  const p = scrapingPaths("manual/news.naver.com/section");
  assert.match(p.scrapingDir, /scraping\/manual\/news\.naver\.com\/section$/);
  assert.match(p.configPath, /manual\/news\.naver\.com\/section\/config\.json$/);
  assert.match(p.goldenPath, /manual\/news\.naver\.com\/section\/golden\.json$/);
});

test("scrapingPaths rejects an empty pageKey", () => {
  assert.throws(() => scrapingPaths(""), /pageKey/);
});
```

- [ ] **Step 2: Run — expect FAIL** (`scrapingPaths` not exported). NOTE: also confirms isolation env is wired — if it throws the "Test isolation guard" error instead, Step 4 (the `_setup.mjs` edit) is required first.

- [ ] **Step 3a: add the isolation env** — in `tests/_setup.mjs`, after the `BROWSER_FLOW_PAGES_PATH` line, add:
```js
// Phase NNN: per-test-run scraping-config fixture. Same isolation pattern as the
// page-node store — without it, `npm test` would write extractor configs/goldens
// into the committed `knowledge/scraping/` tree.
process.env.BROWSER_FLOW_SCRAPING_PATH = join(fixtureRoot, "scraping");
```

- [ ] **Step 3b: add root + paths** — in `scripts/lib/config.mjs`, after `getPagesRoot()` (and before `pagePaths`), add:
```js
/**
 * Phase NNN: scraping-config store root. Separate knowledge domain from the
 * page-node graph (structure) — this holds content-extraction configs. Tests
 * override via BROWSER_FLOW_SCRAPING_PATH (same guard as the pages store).
 */
export function getScrapingRoot() {
  assertTestOverridePresent("BROWSER_FLOW_SCRAPING_PATH", "the scraping-config store");
  const override = process.env.BROWSER_FLOW_SCRAPING_PATH;
  return override ? resolve(override) : resolve(repoRoot, "knowledge", "scraping");
}

/**
 * Phase NNN: per-page extractor-config + golden paths. pageKey may contain `/`
 * segments — the directory layout mirrors that structure (same as pagePaths).
 * @param {string} pageKey
 */
export function scrapingPaths(pageKey) {
  const sanitized = String(pageKey || "").replace(/^\/+|\/+$/g, "");
  if (!sanitized) {
    throw new Error("scrapingPaths requires a non-empty pageKey.");
  }
  const scrapingDir = resolve(getScrapingRoot(), sanitized);
  return {
    pageKey: sanitized,
    scrapingDir,
    configPath: resolve(scrapingDir, "config.json"),
    goldenPath: resolve(scrapingDir, "golden.json")
  };
}
```

- [ ] **Step 4: Run — expect PASS (2/2)**
Run: `node --import=./tests/_setup.mjs --test tests/extract/scraping-paths.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add scripts/lib/config.mjs tests/_setup.mjs tests/extract/scraping-paths.test.mjs
git commit -m "feat(extract): scrapingPaths + getScrapingRoot (separate knowledge domain, test-isolated)"
```

---

## Task 2: scraping-store (first-write-wins persist + read-or-null)

**Files:** `scripts/extract/scraping-store.mjs`, `tests/extract/scraping-store.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/scraping-store.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { writeScrapingKnowledge, readScrapingConfig, readGolden } from "../../scripts/extract/scraping-store.mjs";

const KEY = () => `manual/test.example/${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CONFIG = { schemaVersion: 1, pageKey: "x", container: "ul.l > li", fields: [{ name: "t", selector: "a" }] };
const GOLDEN = { cardinality: 3, sampleValues: [{ t: "First" }] };

test("readScrapingConfig returns null when none stored", () => {
  assert.equal(readScrapingConfig(KEY()), null);
});

test("writeScrapingKnowledge persists config + golden; readers return them", () => {
  const key = KEY();
  const res = writeScrapingKnowledge(key, { ...CONFIG, pageKey: key }, GOLDEN);
  assert.equal(res.written, true);
  const cfg = readScrapingConfig(key);
  assert.equal(cfg.pageKey, key);
  assert.equal(cfg.fields.length, 1);
  const g = readGolden(key);
  assert.equal(g.cardinality, 3);
  assert.equal(g.pageKey, key); // store stamps pageKey + capturedAt
  assert.equal(typeof g.capturedAt, "string");
});

test("writeScrapingKnowledge is first-write-wins (keeps existing without force)", () => {
  const key = KEY();
  writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "first" }, GOLDEN);
  const res = writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "second" }, GOLDEN);
  assert.equal(res.written, false);
  assert.equal(res.kept, true);
  assert.equal(readScrapingConfig(key).container, "first");
});

test("writeScrapingKnowledge with force overwrites (heal-in-place path)", () => {
  const key = KEY();
  writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "first" }, GOLDEN);
  const res = writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "second" }, GOLDEN, { force: true });
  assert.equal(res.written, true);
  assert.equal(readScrapingConfig(key).container, "second");
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)
- [ ] **Step 3: Implement** — create `scripts/extract/scraping-store.mjs`:
```js
// Phase NNN: durable scraping-knowledge store. Separate domain from the
// page-node graph (decision ①): config.json (ExtractorConfigV1) + golden.json
// (drift oracle), keyed by structural pageKey under knowledge/scraping/<key>/.
// first-write-wins by default — the agent establishes once; heal (Plan 4) passes
// { force: true } to update in place. Committed knowledge (survives runs).

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { scrapingPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";

/**
 * @param {string} pageKey
 * @param {Record<string, any>} config  full ExtractorConfigV1
 * @param {{ cardinality?: number, sampleValues?: any[] }} golden
 * @param {{ force?: boolean }} [opts]
 * @returns {{ written: boolean, kept?: boolean, pageKey: string }}
 */
export function writeScrapingKnowledge(pageKey, config, golden, opts = {}) {
  const paths = scrapingPaths(pageKey);
  if (!opts.force && existsSync(paths.configPath)) {
    return { written: false, kept: true, pageKey: paths.pageKey };
  }
  mkdirSync(dirname(paths.configPath), { recursive: true });
  writeJson(paths.configPath, config);
  writeJson(paths.goldenPath, {
    schemaVersion: 1,
    pageKey: paths.pageKey,
    capturedAt: new Date().toISOString(),
    cardinality: (golden && golden.cardinality) ?? 0,
    sampleValues: (golden && golden.sampleValues) ?? []
  });
  return { written: true, pageKey: paths.pageKey };
}

/**
 * @param {string} pageKey
 * @returns {Record<string, any>|null}
 */
export function readScrapingConfig(pageKey) {
  const paths = scrapingPaths(pageKey);
  return existsSync(paths.configPath) ? readJson(paths.configPath) : null;
}

/**
 * @param {string} pageKey
 * @returns {Record<string, any>|null}
 */
export function readGolden(pageKey) {
  const paths = scrapingPaths(pageKey);
  return existsSync(paths.goldenPath) ? readJson(paths.goldenPath) : null;
}
```

- [ ] **Step 4: Run — expect PASS (4/4)**
- [ ] **Step 5: Commit**
```bash
git add scripts/extract/scraping-store.mjs tests/extract/scraping-store.test.mjs
git commit -m "feat(extract): durable scraping-store (first-write-wins + force, read-or-null)"
```

---

## Task 3: bf extract --apply persists durable knowledge

**Files:** `scripts/commands/extract.mjs`, `tests/extract/extract-command.test.mjs`

- [ ] **Step 1: Write the test** (append to `tests/extract/extract-command.test.mjs`):
```js
import { readScrapingConfig, readGolden } from "../../scripts/extract/scraping-store.mjs";

test("runExtractCommand --apply persists durable config + golden by pageKey", async () => {
  const runId = `extract-durable-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const pageKey = `manual/durable.example/${runId}`;
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001-list.html.gz"), gzipSync(Buffer.from(
    `<ul class="l"><li class="i"><a class="t">First</a></li><li class="i"><a class="t">Second</a></li></ul>`
  )));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "https://x/list", timestamp: 1, filename: "001-list.html.gz" }] });
  writeJson(runPaths.scrapeResultPath, {
    schemaVersion: 1, runId, stepIndex: 1, status: "extracted", pageType: "listing",
    extractorConfig: { container: "ul.l > li.i", fields: [{ name: "title", selector: "a.t", required: true }] },
    golden: { cardinality: 2, sampleValues: [{ title: "First" }] }, pagination: { kind: "none" }
  });

  const out = R(await runExtractCommand({ runId, applyPath: runPaths.scrapeResultPath }));
  assert.equal(out.status, "data");
  // durable knowledge persisted by pageKey
  const cfg = R(readScrapingConfig(pageKey));
  assert.equal(cfg.pageKey, pageKey);
  assert.equal(cfg.container, "ul.l > li.i");
  const g = R(readGolden(pageKey));
  assert.equal(g.cardinality, 2);
});
```

- [ ] **Step 2: Run — expect FAIL** (no durable persist yet)
- [ ] **Step 3: Implement** — in `scripts/commands/extract.mjs`:
  (a) add import at top:
```js
import { writeScrapingKnowledge } from "../extract/scraping-store.mjs";
```
  (b) in the `--apply` branch, after `writeJson(runPaths.extractResultPath, out);` and before `return out;`, insert:
```js
  // Decision ①: persist to the durable scraping-knowledge domain (first-write-wins),
  // keyed by the step's structural pageKey, so a later flow on the same page reuses
  // it with zero tokens. Skip when pageKey is empty.
  if (applied.pageKey) {
    const persisted = writeScrapingKnowledge(applied.pageKey, config, scrapeResult.golden || {});
    out.durable = persisted;
  }
```

- [ ] **Step 4: Run — expect PASS** (this file's tests all green)
- [ ] **Step 5: Commit**
```bash
git add scripts/commands/extract.mjs tests/extract/extract-command.test.mjs
git commit -m "feat(extract): --apply persists durable scraping knowledge by pageKey"
```

---

## Task 4: bf extract --reuse (token-0 second run)

**Files:** `scripts/commands/extract.mjs`, `scripts/cli.mjs`, `tests/extract/extract-command.test.mjs`

- [ ] **Step 1: Write the test** (append):
```js
import { writeScrapingKnowledge } from "../../scripts/extract/scraping-store.mjs";

test("runExtractCommand --reuse: runs the durable config on a NEW run's snapshot (no agent)", async () => {
  const pageKey = `manual/reuse.example/${Date.now()}`;
  // seed durable knowledge (as if a prior flow established it)
  writeScrapingKnowledge(pageKey, { schemaVersion: 1, pageKey, container: "ul.l > li.i", fields: [{ name: "title", selector: "a.t", required: true }] }, { cardinality: 2, sampleValues: [{ title: "First" }] });

  // a fresh run that lands on the same page
  const runId = `extract-reuse-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(
    `<ul class="l"><li class="i"><a class="t">Alpha</a></li><li class="i"><a class="t">Beta</a></li><li class="i"><a class="t">Gamma</a></li></ul>`
  )));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "https://x/list", timestamp: 1, filename: "001.html.gz" }] });

  const out = R(await runExtractCommand({ runId, stepIndex: 1, reuse: true }));
  assert.equal(out.status, "data");
  assert.equal(out.cardinality, 3);
  assert.equal(out.rows[0].title, "Alpha");
  assert.equal(out.reused, true);
});

test("runExtractCommand --reuse throws when no durable config exists for the pageKey", async () => {
  const runId = `extract-reuse-miss-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: `manual/missing/${runId}` }] });
  await assert.rejects(() => runExtractCommand({ runId, stepIndex: 1, reuse: true }), /no durable/);
});
```

- [ ] **Step 2: Run — expect FAIL** (reuse not implemented)
- [ ] **Step 3: Implement** — in `scripts/commands/extract.mjs`:
  (a) add import:
```js
import { writeScrapingKnowledge, readScrapingConfig, readGolden } from "../extract/scraping-store.mjs";
```
  (replace the Task-3 import line so both are imported from one statement)
  (b) insert a `--reuse` branch in `runExtractCommand`, BEFORE the emit branch (`if (!input.applyPath)`):
```js
  if (input.reuse) {
    if (typeof input.stepIndex !== "number") throw new Error("bf extract --reuse requires --step <n>");
    const step = workflow.steps[input.stepIndex];
    const pageKey = (step && step.pageKey) || "";
    const config = readScrapingConfig(pageKey);
    if (!config) throw new Error(`no durable scraping config for pageKey "${pageKey}" — run setup (--apply) first`);
    const golden = readGolden(pageKey);
    const readSnap = deps.readSnapshotHtml ?? readSnapshotHtml;
    const extract = deps.runExtractor ?? runExtractor;
    const verdict = deps.classify ?? classify;
    const html = readSnap(runPaths.snapshotsManifestPath, runPaths.snapshotsDir, input.stepIndex);
    const extraction = extract(html, config);
    const result = verdict(extraction, golden);
    const out = { runId: input.runId, stepIndex: input.stepIndex, pageKey, status: result.status, rows: result.rows, cardinality: extraction.cardinality, reason: result.reason, reused: true };
    writeJson(runPaths.extractResultPath, out);
    return out;
  }
```
  (c) extend `extractCommand` options parsing:
```js
  const reuse = getBooleanOption(options, "reuse");
  return runExtractCommand({ runId, applyPath, schemaPath, stepIndex, reuse });
```
  and add `getBooleanOption` to the args import:
```js
import { getStringOption, getBooleanOption } from "../lib/args.mjs";
```
  and add `reuse?: boolean` to the `runExtractCommand` `@param` typedef.

- [ ] **Step 4: Update CLI help** — in `scripts/cli.mjs`, change the `extract` help line to mention reuse:
```
  extract   Emit/apply a scrape-result, or --reuse a durable config to extract with zero tokens — --run-id <id> --step <n> [--schema <f> | --apply <r> | --reuse]
```

- [ ] **Step 5: Run — expect PASS** + smoke:
```bash
node --import=./tests/_setup.mjs --test tests/extract/extract-command.test.mjs
node scripts/cli.mjs help | grep -A0 "extract "
```

- [ ] **Step 6: Commit**
```bash
git add scripts/commands/extract.mjs scripts/cli.mjs tests/extract/extract-command.test.mjs
git commit -m "feat(extract): bf extract --reuse runs durable config zero-token on a new run"
```

---

## Task 5: Full-suite regression + typecheck

- [ ] **Step 1:** `npx tsc --noEmit > /tmp/tsc-p3.txt 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp/tsc-p3.txt` — expect EXIT=0, 0 errors. (Watch the Plan-1 lesson: optional fields → `?.` / `String()`; narrow before use.)
- [ ] **Step 2:** `npm test > /tmp/bf-p3.txt 2>&1; echo "EXIT=$?"` then `grep -E "^# (tests|pass|fail)" /tmp/bf-p3.txt` and `grep -E "^not ok" /tmp/bf-p3.txt` — expect 0 real failures (only the known-flaky `verify-breadth-enrichment` may flake; verify in isolation if it appears).
- [ ] **Step 3:** Commit any fixup.

---

## Self-Review

- **Spec coverage:** decision ① durable separate domain → Tasks 1–2. §3.2 config persist + §3.3 golden persist → Tasks 2–3. cross-flow reuse / token-0 second run → Task 4. Q2 first-write-wins (+ force for heal) → Task 2.
- **Type consistency:** `scrapingPaths(pageKey) → {pageKey, scrapingDir, configPath, goldenPath}`; `writeScrapingKnowledge(pageKey, config, golden, {force?}) → {written, kept?, pageKey}`; `readScrapingConfig/readGolden → object|null`; `runExtractCommand` gains `reuse?: boolean` and `out.reused`/`out.durable`.
- **Test isolation:** `_setup.mjs` sets `BROWSER_FLOW_SCRAPING_PATH` so `npm test` never writes committed `knowledge/scraping/` (constitution artifact-vs-knowledge).
- **Placeholders:** none.

## Out of scope (Plan 4)

extraction-heal (drift repair, `writeScrapingKnowledge(..., {force:true})` from a heal-agent) + pagination runtime loop in replay.
