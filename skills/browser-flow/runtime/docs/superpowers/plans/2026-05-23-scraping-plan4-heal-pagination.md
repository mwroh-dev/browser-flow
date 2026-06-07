# Plan 4 — Extraction-Heal + Pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **Discipline (Plan 1–3 lesson):** run `npx tsc --noEmit` immediately after adding each new `.mjs` — node:test PASS ≠ tsc PASS.

**Goal:** Close value prop #4 (self-repair / notify) and multi-page extraction.
When `bf extract` runs a config and golden-probe returns `drift`, it emits an
extract-heal-request; the extract-heal-agent re-derives a config; `bf extract-heal
--apply` force-writes the durable config and **verifies** the heal against the
drifted snapshot. Pagination: a deterministic multi-snapshot extractor over the
captured pages.

**Architecture:** Mirror the `heal` subsystem (request → agent → result → `--apply`),
but extraction-heal needs no runner regenerate/cleanup/rerun — it force-writes the
durable scraping config (Plan 3 `writeScrapingKnowledge(..., {force:true})`) and
re-runs the config against the snapshot to confirm. Drift is detected in the
deterministic `bf extract` command (golden-probe), NOT the live runner. Pagination
extraction is `runExtractorPaged(htmls[], config)` over captured page snapshots.

**Tech Stack:** Node ESM, `zod@^4`, `node:test`. Builds on Plans 1–3. No new deps.

**Spec:** `docs/superpowers/plans/2026-05-23-scraping-agent-spec.md` — decision ②③, §3.7 (heal contracts), §5 (Plan 4).

**Honest seam:** the LIVE CDP replay loop (clicking "next" to capture pages beyond
those recorded, and auto-emitting heal-request during a live replay) is browser-
dependent and is NOT in this plan. Plan 4 delivers the deterministic core that such
a loop would call, fully unit-tested. This is stated in §Out-of-scope and must be
reported as not-browser-verified.

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `scripts/lib/schema-versions.mjs` | modify | add `extractHealResult: 1` |
| `scripts/lib/schemas.mjs` | modify | add `ExtractHealResultV1` + `parseExtractHealResult` |
| `scripts/lib/config.mjs` | modify | add `extractHealRequestPath` + `extractHealResultPath` to `getRunPaths` |
| `scripts/extract/pager.mjs` | create | `runExtractorPaged(htmls, config)` + `readAllSnapshotsHtml(manifestPath, snapshotsDir)` |
| `scripts/extract/extract-heal.mjs` | create | `buildExtractHealRequest(...)` (pure) + `runExtractHealCommand` (read req / `--apply`) |
| `scripts/commands/extract.mjs` | modify | drift → emit extract-heal-request (in `--reuse` and `--apply`); add `--paged` |
| `scripts/cli.mjs` | modify | register `extract-heal`; note `--paged` |
| `.codex/skills/extract-heal-agent/SKILL.md` | create | drift-repair sub-agent contract |
| `tests/extract/extract-heal.test.mjs` | create | schema + buildRequest + command tests |
| `tests/extract/pager.test.mjs` | create | paged extraction tests |
| `tests/extract/extract-command.test.mjs` | modify | drift→emit + `--paged` tests |

**Test commands:** `node --import=./tests/_setup.mjs --test tests/extract/<file>.test.mjs`; full `npm test`; types `npx tsc --noEmit`.

---

## Task 1: ExtractHealResultV1 schema + version + paths

**Files:** `scripts/lib/schema-versions.mjs`, `scripts/lib/schemas.mjs`, `scripts/lib/config.mjs`, `tests/extract/extract-heal.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/extract-heal.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseExtractHealResult } from "../../scripts/lib/schemas.mjs";
import { getRunPaths } from "../../scripts/lib/config.mjs";

test("parseExtractHealResult: valid healed parses", () => {
  const r = parseExtractHealResult({
    schemaVersion: 1, runId: "x", pageKey: "k", status: "healed",
    extractorConfig: { container: "ul.l > li", fields: [{ name: "t", selector: "a" }] },
    golden: { cardinality: 3 }
  });
  assert.equal(r.status, "healed");
});

test("parseExtractHealResult: valid unrepairable parses", () => {
  const r = parseExtractHealResult({ schemaVersion: 1, runId: "x", pageKey: "k", status: "unrepairable", reason: "price field removed" });
  assert.equal(r.status, "unrepairable");
});

test("parseExtractHealResult: healed without extractorConfig throws", () => {
  assert.throws(() => parseExtractHealResult({ schemaVersion: 1, runId: "x", pageKey: "k", status: "healed" }), /extract-heal-result/);
});

test("parseExtractHealResult: unrepairable without reason throws", () => {
  assert.throws(() => parseExtractHealResult({ schemaVersion: 1, runId: "x", pageKey: "k", status: "unrepairable" }), /extract-heal-result/);
});

test("getRunPaths exposes extract-heal artifact paths", () => {
  const p = getRunPaths("demo");
  assert.match(p.extractHealRequestPath, /demo\/extract-heal-request\.json$/);
  assert.match(p.extractHealResultPath, /demo\/extract-heal-result\.json$/);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3a: version** — in `scripts/lib/schema-versions.mjs`, add to BOTH objects after `scrapeResult`:
```js
  scrapeResult: 1,
  extractHealResult: 1
});
```
and
```js
  scrapeResult: Object.freeze([1]),
  extractHealResult: Object.freeze([1])
});
```

- [ ] **Step 3b: schema** — append to `scripts/lib/schemas.mjs` (after `parseScrapeResult`):
```js
// Phase NNN: ExtractHealResult — output of the extract-heal-agent (Plan 4).
// "healed" carries a re-derived extractor-config body (force-written to the
// durable store); "unrepairable" carries a reason (surfaced to the user — the
// schema no longer exists on the page, value prop #4 "notify"). Mirrors HealResultV1.
const ExtractHealResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.extractHealResult),
    runId: z.string().min(1),
    pageKey: z.string().min(1),
    status: z.enum(["healed", "unrepairable"]),
    extractorConfig: z
      .object({ container: z.string().min(1).nullable(), fields: z.array(ExtractorFieldShape).min(1) })
      .passthrough()
      .optional(),
    golden: z
      .object({
        cardinality: z.number().int().nonnegative().optional(),
        sampleValues: z.array(z.record(z.string(), z.unknown())).optional()
      })
      .passthrough()
      .optional(),
    reason: z.string().optional()
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.status === "healed" && !v.extractorConfig) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "healed status requires extractorConfig" });
    }
    if (v.status === "unrepairable" && !v.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unrepairable status requires a reason" });
    }
  });

/**
 * Parse + validate an extract-heal-result.json document.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseExtractHealResult(input, artifactPath = "<inline>") {
  const result = ExtractHealResultV1.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "extract-heal-result");
  }
  return result.data;
}
```

- [ ] **Step 3c: paths** — in `scripts/lib/config.mjs`, after `extractResultPath`:
```js
    extractResultPath: resolve(runRoot, "extract-result.json"),
    extractHealRequestPath: resolve(runRoot, "extract-heal-request.json"),
    extractHealResultPath: resolve(runRoot, "extract-heal-result.json")
  };
```
(move the closing `};` accordingly — `extractResultPath` was the last entry).

- [ ] **Step 4: Run — expect PASS (5/5)**
- [ ] **Step 5: tsc** — `npx tsc --noEmit; echo "EXIT=$?"` — expect 0 (use `?.`/`String()` on optional fields if any surface).
- [ ] **Step 6: Commit**
```bash
git add scripts/lib/schema-versions.mjs scripts/lib/schemas.mjs scripts/lib/config.mjs tests/extract/extract-heal.test.mjs
git commit -m "feat(extract): ExtractHealResultV1 schema + extract-heal artifact paths"
```

---

## Task 2: pagination — runExtractorPaged + readAllSnapshotsHtml

**Files:** `scripts/extract/pager.mjs`, `tests/extract/pager.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/pager.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { runExtractorPaged, readAllSnapshotsHtml } from "../../scripts/extract/pager.mjs";

const CONFIG = { container: "ul.l > li.i", fields: [{ name: "t", selector: "a.t", required: true }] };
const page = (items) => `<ul class="l">${items.map((x) => `<li class="i"><a class="t">${x}</a></li>`).join("")}</ul>`;

test("runExtractorPaged concatenates rows across pages", () => {
  const out = runExtractorPaged([page(["A", "B"]), page(["C"]), page(["D", "E"])], CONFIG);
  assert.equal(out.pages, 3);
  assert.equal(out.cardinality, 5);
  assert.deepEqual(out.rows.map((r) => r.t), ["A", "B", "C", "D", "E"]);
});

test("readAllSnapshotsHtml gunzips every manifest entry in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "pager-"));
  const snapsDir = join(dir, "snapshots");
  mkdirSync(snapsDir, { recursive: true });
  writeFileSync(join(snapsDir, "000.html.gz"), gzipSync(Buffer.from(page(["A"]))));
  writeFileSync(join(snapsDir, "001.html.gz"), gzipSync(Buffer.from(page(["B"]))));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, entries: [
    { index: 0, url: "u0", timestamp: 1, filename: "000.html.gz" },
    { index: 1, url: "u1", timestamp: 2, filename: "001.html.gz" }
  ] }));
  const htmls = readAllSnapshotsHtml(manifestPath, snapsDir);
  assert.equal(htmls.length, 2);
  assert.match(htmls[0], />A</);
  assert.match(htmls[1], />B</);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — create `scripts/extract/pager.mjs`:
```js
// Phase NNN: deterministic pagination extraction. The replay layer captures one
// snapshot per page (the user's recorded "next" clicks); this runs ONE config
// over all captured page snapshots and concatenates the rows. Pure + LLM-free.
// (Decision ③: the loop lives in the live replay; this is the deterministic core
// it calls. Unbounded live "click next" beyond captured pages is out of scope.)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { readJson } from "../lib/fs.mjs";
import { runExtractor } from "./extractor.mjs";

/**
 * @param {string[]} htmls
 * @param {{ container: string|null, fields: any[] }} config
 * @returns {{ rows: Record<string, unknown>[], cardinality: number, pages: number }}
 */
export function runExtractorPaged(htmls, config) {
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  let pages = 0;
  for (const html of Array.isArray(htmls) ? htmls : []) {
    const r = runExtractor(html, config);
    for (const row of r.rows) rows.push(row);
    pages += 1;
  }
  return { rows, cardinality: rows.length, pages };
}

/**
 * @param {string} manifestPath
 * @param {string} snapshotsDir
 * @returns {string[]}  one HTML string per manifest entry, in listed order
 */
export function readAllSnapshotsHtml(manifestPath, snapshotsDir) {
  const manifest = /** @type {{ entries?: Array<{ filename: string }> }} */ (readJson(manifestPath));
  const entries = Array.isArray(manifest && manifest.entries) ? manifest.entries : [];
  return entries.map((e) => {
    const file = resolve(snapshotsDir, e.filename);
    const buf = readFileSync(file);
    return e.filename.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  });
}
```

- [ ] **Step 4: Run — expect PASS (2/2)**
- [ ] **Step 5: tsc** — `npx tsc --noEmit; echo "EXIT=$?"` — expect 0.
- [ ] **Step 6: Commit**
```bash
git add scripts/extract/pager.mjs tests/extract/pager.test.mjs
git commit -m "feat(extract): runExtractorPaged + readAllSnapshotsHtml (deterministic multi-page core)"
```

---

## Task 3: drift → emit extract-heal-request (in bf extract)

**Files:** `scripts/extract/extract-heal.mjs` (buildExtractHealRequest only for now), `scripts/commands/extract.mjs`, `tests/extract/extract-command.test.mjs`

- [ ] **Step 1: Write the test** (append to `tests/extract/extract-command.test.mjs`):
```js
import { existsSync } from "node:fs";

test("runExtractCommand --reuse drift emits extract-heal-request", async () => {
  const pageKey = `manual/drift.example/${Date.now()}`;
  // durable config whose container is ABSENT in the new snapshot → drift
  writeScrapingKnowledge(pageKey, { schemaVersion: 1, pageKey, container: "ul.gone > li", fields: [{ name: "t", selector: "a", required: true }] }, { cardinality: 5, sampleValues: [{ t: "X" }] });
  const runId = `extract-drift-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(`<div class="other">no list here</div>`)));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "u", timestamp: 1, filename: "001.html.gz" }] });

  const out = R(await runExtractCommand({ runId, stepIndex: 1, reuse: true }));
  assert.equal(out.status, "drift");
  assert.equal(existsSync(runPaths.extractHealRequestPath), true);
  const req = R(readJson(runPaths.extractHealRequestPath));
  assert.equal(req.pageKey, pageKey);
  assert.equal(req.observed.containerResolved, false);
  assert.equal(req.expected.cardinality, 5);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3a: implement buildExtractHealRequest** — create `scripts/extract/extract-heal.mjs`:
```js
// Phase NNN: extraction-heal — the deterministic half of the drift-repair loop
// (decision ②, value prop #4). Drift is detected by golden-probe inside bf extract;
// this builds the heal-request the extract-heal-agent consumes, and bf extract-heal
// --apply force-writes the re-derived config + verifies it against the drifted
// snapshot. No runner regenerate/cleanup/rerun — extraction is not in the runner.

import { existsSync } from "node:fs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseExtractHealResult } from "../lib/schemas.mjs";
import { writeScrapingKnowledge, readGolden } from "./scraping-store.mjs";
import { readSnapshotHtml } from "./snapshot-read.mjs";
import { runExtractor } from "./extractor.mjs";
import { classify } from "./golden-probe.mjs";

/**
 * @param {string} pageKey
 * @param {number} stepIndex
 * @param {{ cardinality?: number, sampleValues?: any[] }|null} golden
 * @param {{ cardinality: number, containerResolved: boolean }} extraction
 * @param {string} manifestPath
 * @param {string} snapshotsDir
 */
export function buildExtractHealRequest(pageKey, stepIndex, golden, extraction, manifestPath, snapshotsDir) {
  return {
    pageKey,
    stepIndex,
    expected: { cardinality: (golden && golden.cardinality) ?? 0, sampleValues: (golden && golden.sampleValues) ?? [] },
    observed: { cardinality: extraction.cardinality, containerResolved: extraction.containerResolved },
    snapshotsManifestPath: manifestPath,
    snapshotsDir
  };
}
```

- [ ] **Step 3b: wire emit-on-drift into bf extract** — in `scripts/commands/extract.mjs`:
  (a) import:
```js
import { buildExtractHealRequest } from "../extract/extract-heal.mjs";
```
  (b) add a helper near the top of the module (after imports):
```js
/** Emit an extract-heal-request when an extraction drifts. */
function emitHealOnDrift(runPaths, pageKey, stepIndex, golden, extraction) {
  const req = buildExtractHealRequest(pageKey, stepIndex, golden, extraction, runPaths.snapshotsManifestPath, runPaths.snapshotsDir);
  writeJson(runPaths.extractHealRequestPath, req);
  return req;
}
```
  (c) in the `--reuse` branch, after `const result = verdict(extraction, golden);` and before building `out`, add:
```js
    if (result.status === "drift" && pageKey) emitHealOnDrift(runPaths, pageKey, input.stepIndex, golden, extraction);
```
  (d) in the `--apply` branch, after `const result = verdict(extraction, scrapeResult.golden);` and before building `out`, add:
```js
    if (result.status === "drift" && applied.pageKey) emitHealOnDrift(runPaths, applied.pageKey, /** @type {number} */ (applied.stepIndex), scrapeResult.golden, extraction);
```

- [ ] **Step 4: Run — expect PASS** (whole extract-command file green)
- [ ] **Step 5: tsc** — expect 0.
- [ ] **Step 6: Commit**
```bash
git add scripts/extract/extract-heal.mjs scripts/commands/extract.mjs tests/extract/extract-command.test.mjs
git commit -m "feat(extract): emit extract-heal-request on golden-probe drift"
```

---

## Task 4: bf extract-heal command (read / --apply force-write + verify)

**Files:** `scripts/extract/extract-heal.mjs` (add command), `scripts/commands/extract-heal.mjs`, `scripts/cli.mjs`, `tests/extract/extract-heal.test.mjs`

- [ ] **Step 1: Write the test** (append to `tests/extract/extract-heal.test.mjs`):
```js
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { readScrapingConfig } from "../../scripts/extract/scraping-store.mjs";
import { runExtractHealCommand } from "../../scripts/commands/extract-heal.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
/** @param {any} r */ const RH = (r) => r;

test("runExtractHealCommand no --apply: returns the heal-request", async () => {
  const runId = `eh-read-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.extractHealRequestPath, { pageKey: "k", stepIndex: 1, expected: {}, observed: {}, snapshotsManifestPath: runPaths.snapshotsManifestPath, snapshotsDir: runPaths.snapshotsDir });
  const out = RH(await runExtractHealCommand({ runId }));
  assert.equal(out.extractHealRequest.pageKey, "k");
});

test("runExtractHealCommand --apply healed: force-writes durable config + verifies", async () => {
  const pageKey = `manual/heal.example/${Date.now()}`;
  const runId = `eh-apply-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(`<section class="new"><div class="card"><h3>Healed</h3></div></section>`)));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "u", timestamp: 1, filename: "001.html.gz" }] });
  writeJson(runPaths.extractHealRequestPath, { pageKey, stepIndex: 1, expected: { cardinality: 1 }, observed: { cardinality: 0, containerResolved: false }, snapshotsManifestPath: runPaths.snapshotsManifestPath, snapshotsDir: runPaths.snapshotsDir });
  // re-derived config the agent produced (matches the NEW dom)
  writeJson(runPaths.extractHealResultPath, {
    schemaVersion: 1, runId, pageKey, status: "healed",
    extractorConfig: { container: "section.new > div.card", fields: [{ name: "title", selector: "h3", required: true }] },
    golden: { cardinality: 1, sampleValues: [{ title: "Healed" }] }
  });

  const out = RH(await runExtractHealCommand({ runId, applyPath: runPaths.extractHealResultPath }));
  assert.equal(out.status, "healed");
  assert.equal(out.verify.status, "data");
  assert.equal(out.verify.cardinality, 1);
  // durable config force-overwritten
  const cfg = RH(readScrapingConfig(pageKey));
  assert.equal(cfg.container, "section.new > div.card");
});

test("runExtractHealCommand --apply unrepairable: reports reason, no durable write", async () => {
  const pageKey = `manual/unrep.example/${Date.now()}`;
  const runId = `eh-unrep-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.extractHealRequestPath, { pageKey, stepIndex: 1, expected: {}, observed: {}, snapshotsManifestPath: runPaths.snapshotsManifestPath, snapshotsDir: runPaths.snapshotsDir });
  writeJson(runPaths.extractHealResultPath, { schemaVersion: 1, runId, pageKey, status: "unrepairable", reason: "price field removed from page" });
  const out = RH(await runExtractHealCommand({ runId, applyPath: runPaths.extractHealResultPath }));
  assert.equal(out.status, "unrepairable");
  assert.match(out.reason, /price field/);
  assert.equal(readScrapingConfig(pageKey), null);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3a: add runExtractHealCommand** — append to `scripts/extract/extract-heal.mjs`:
```js
/**
 * Phase NNN: bf extract-heal — deterministic half of the extraction-heal loop.
 * Reads extract-heal-request.json; on --apply force-writes the re-derived durable
 * config (status "healed") and re-runs it against the drifted snapshot to verify,
 * or surfaces the reason (status "unrepairable" → value prop #4 "notify user").
 *
 * @param {{ runId: string, applyPath?: string }} input
 * @param {{ readSnapshotHtml?: Function, runExtractor?: Function, classify?: Function }} [deps]
 */
export async function runExtractHealCommand(input, deps = {}) {
  const runPaths = getRunPaths(input.runId);
  if (!existsSync(runPaths.extractHealRequestPath)) {
    throw new Error("no extract-heal-request for run " + input.runId + " — no extraction drift was recorded");
  }
  const request = /** @type {Record<string, any>} */ (readJson(runPaths.extractHealRequestPath));
  if (!input.applyPath) {
    return { runId: input.runId, extractHealRequest: request };
  }

  const result = parseExtractHealResult(readJson(input.applyPath), input.applyPath);
  if (result.status === "unrepairable") {
    return { runId: input.runId, pageKey: result.pageKey, status: "unrepairable", reason: result.reason };
  }

  // healed: force-write the re-derived durable config (heal-in-place), then verify.
  const config = { schemaVersion: 1, pageKey: result.pageKey, ...result.extractorConfig };
  writeScrapingKnowledge(result.pageKey, config, result.golden || {}, { force: true });

  const readSnap = deps.readSnapshotHtml ?? readSnapshotHtml;
  const extract = deps.runExtractor ?? runExtractor;
  const verdict = deps.classify ?? classify;
  const html = readSnap(request.snapshotsManifestPath, request.snapshotsDir, request.stepIndex);
  const extraction = extract(html, config);
  const verify = verdict(extraction, result.golden || readGolden(result.pageKey));
  return { runId: input.runId, pageKey: result.pageKey, status: "healed", verify: { status: verify.status, cardinality: extraction.cardinality } };
}
```

- [ ] **Step 3b: command wrapper** — create `scripts/commands/extract-heal.mjs`:
```js
import { getStringOption } from "../lib/args.mjs";
import { runExtractHealCommand } from "../extract/extract-heal.mjs";

export { runExtractHealCommand };

/** @param {Record<string, string | boolean>} options */
export function extractHealCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf extract-heal requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  return runExtractHealCommand({ runId, applyPath });
}
```

- [ ] **Step 3c: CLI** — in `scripts/cli.mjs`:
  (a) import:
```js
import { extractHealCommand } from "./commands/extract-heal.mjs";
```
  (b) help line after the `extract` line:
```
  extract-heal  Re-derive a drifted extractor config — --run-id <id> [--apply <extract-heal-result.json>] (value prop #4)
```
  (c) dispatch after the `extract` block:
```js
  if (command === "extract-heal") {
    process.stdout.write(`${JSON.stringify(await extractHealCommand(options), null, 2)}\n`);
    return;
  }
```

- [ ] **Step 4: Run — expect PASS** (extract-heal.test.mjs all green)
- [ ] **Step 5: tsc** — expect 0.
- [ ] **Step 6: Commit**
```bash
git add scripts/extract/extract-heal.mjs scripts/commands/extract-heal.mjs scripts/cli.mjs tests/extract/extract-heal.test.mjs
git commit -m "feat(extract): bf extract-heal — force-write re-derived config + verify (value prop #4)"
```

---

## Task 5: bf extract --paged (multi-page over captured snapshots)

**Files:** `scripts/commands/extract.mjs`, `tests/extract/extract-command.test.mjs`

- [ ] **Step 1: Write the test** (append):
```js
test("runExtractCommand --reuse --paged: extracts across all captured snapshots", async () => {
  const pageKey = `manual/paged.example/${Date.now()}`;
  writeScrapingKnowledge(pageKey, { schemaVersion: 1, pageKey, container: "ul.l > li.i", fields: [{ name: "t", selector: "a.t", required: true }] }, { cardinality: 2, sampleValues: [{ t: "A" }] });
  const runId = `extract-paged-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  const page = (items) => `<ul class="l">${items.map((x) => `<li class="i"><a class="t">${x}</a></li>`).join("")}</ul>`;
  writeFileSync(join(runPaths.snapshotsDir, "000.html.gz"), gzipSync(Buffer.from(page(["A", "B"]))));
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(page(["C", "D", "E"]))));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [
    { index: 0, url: "u0", timestamp: 1, filename: "000.html.gz" },
    { index: 1, url: "u1", timestamp: 2, filename: "001.html.gz" }
  ] });

  const out = R(await runExtractCommand({ runId, stepIndex: 1, reuse: true, paged: true }));
  assert.equal(out.status, "data");
  assert.equal(out.pages, 2);
  assert.equal(out.cardinality, 5);
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — in `scripts/commands/extract.mjs`:
  (a) import:
```js
import { runExtractorPaged, readAllSnapshotsHtml } from "../extract/pager.mjs";
```
  (b) extend the `--reuse` branch: after loading `config` + `golden`, branch on `input.paged`:
```js
    if (input.paged) {
      const htmls = (deps.readAllSnapshotsHtml ?? readAllSnapshotsHtml)(runPaths.snapshotsManifestPath, runPaths.snapshotsDir);
      const pagedOut = runExtractorPaged(htmls, config);
      const pagedResult = (deps.classify ?? classify)({ rows: pagedOut.rows, cardinality: pagedOut.cardinality, containerResolved: pagedOut.cardinality > 0 }, golden);
      const out = { runId: input.runId, stepIndex: input.stepIndex, pageKey, status: pagedResult.status, rows: pagedOut.rows, cardinality: pagedOut.cardinality, pages: pagedOut.pages, reused: true };
      writeJson(runPaths.extractResultPath, out);
      return out;
    }
```
  (place this immediately after `const golden = readGolden(pageKey);` and before the single-snapshot `readSnap` lines).
  (c) extend `@param` typedef with `paged?: boolean` and add `deps.readAllSnapshotsHtml?` ; in `extractCommand`, parse `const paged = getBooleanOption(options, "paged");` and pass it.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: tsc** — expect 0.
- [ ] **Step 6: Commit**
```bash
git add scripts/commands/extract.mjs tests/extract/extract-command.test.mjs
git commit -m "feat(extract): bf extract --paged multi-page extraction over captured snapshots"
```

---

## Task 6: extract-heal-agent SKILL.md

**Files:** `.codex/skills/extract-heal-agent/SKILL.md`

- [ ] **Step 1: Create the skill** — write `.codex/skills/extract-heal-agent/SKILL.md` mirroring scope-agent/heal-agent: single SKILL.md, Task/Agent dispatch, no external LLM. Contract:
  - **Role:** dispatched when `bf extract` recorded a `drift` (extract-heal-request.json). Read the request + the **current (drifted) snapshot**; re-derive an extractor config for the SAME target fields on the changed DOM.
  - **Input:** `extract-heal-request.json` — `{ pageKey, stepIndex, expected{cardinality,sampleValues}, observed{cardinality,containerResolved}, snapshotsManifestPath, snapshotsDir }`. The `expected.sampleValues` tell you WHAT the fields were (the schema to re-satisfy).
  - **Tools:** Read (request + gunzipped `.html.gz` snapshot), Write (`extract-heal-result.json`).
  - **Output (`ExtractHealResultV1`):** `healed` with a re-derived `extractorConfig` body (container+fields) + fresh `golden` (run it on the drifted snapshot), OR `unrepairable` with a `reason` (the fields no longer exist on the page — do NOT fabricate selectors; this surfaces to the user, value prop #4).
  - **Reasoning:** match the `expected.sampleValues` field semantics to new DOM locations; prefer semantic/ARIA/data-* selectors (same quality ranking as scraping-agent); validate every required field resolves on the drifted snapshot before emitting `healed`.
  - **Constraints:** never emit `<redacted-…>`/`[redacted-…]`; healed requires a non-empty `extractorConfig`; unrepairable requires a `reason`.
  - **Orchestration tie-in:** `bf extract` drift → `extract-heal-request.json` → dispatch this agent → `extract-heal-result.json` → `bf extract-heal --run-id <id> --apply <result>` (force-writes durable config + verifies).
  - **Distinction:** vs scraping-agent (establishes the FIRST config) — this RE-derives after drift; vs heal-agent (re-maps a drifted *locator*) — this re-derives a drifted *extractor config*.

- [ ] **Step 2: Verify** — `grep -c "ExtractHealResultV1\|unrepairable\|extract-heal-request" .codex/skills/extract-heal-agent/SKILL.md` (expect ≥ 3); confirm no "cheerio".
- [ ] **Step 3: Commit**
```bash
git add .codex/skills/extract-heal-agent/SKILL.md
git commit -m "docs(skill): extract-heal-agent — drift-repair sub-agent contract"
```

---

## Task 7: Full-suite regression + typecheck

- [ ] **Step 1:** `npx tsc --noEmit > /tmp/tsc-p4.txt 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp/tsc-p4.txt` — expect 0 (should already be clean from per-task tsc).
- [ ] **Step 2:** `npm test > /tmp/bf-p4.txt 2>&1; echo "EXIT=$?"` then `grep -E "^# (tests|pass|fail)" /tmp/bf-p4.txt` and `grep -E "^not ok" /tmp/bf-p4.txt` — expect 0 real failures (only the known-flaky `verify-breadth-enrichment` may flake; re-run it isolated to confirm).
- [ ] **Step 3:** Commit any fixup.

---

## Self-Review

- **Spec coverage:** §3.7 ExtractHealResultV1 → Task 1. decision ② drift→heal-request→agent→apply (force-write + verify) → Tasks 3–4, 6. value prop #4 unrepairable→notify → Task 4. decision ③ pagination deterministic core → Tasks 2, 5.
- **Type consistency:** `parseExtractHealResult`; `buildExtractHealRequest(pageKey, stepIndex, golden, extraction, manifestPath, snapshotsDir)`; `runExtractHealCommand({runId, applyPath}, deps) → {status, verify?}`; `runExtractorPaged(htmls, config) → {rows, cardinality, pages}`; `runExtractCommand` gains `paged?` + `out.pages`.
- **tsc-early discipline:** every code task ends with `tsc --noEmit` (Plan 1–3 lesson).
- **Placeholders:** none.

## Out of scope (the honest live-replay seam)

The LIVE CDP replay-runner integration is NOT in this plan and is therefore
**not browser-verified**: (a) auto-running `bf extract`/golden-probe inside the
generated runner during a live replay, (b) the unbounded "click next until no more"
loop that captures pages beyond those recorded, (c) auto-dispatching the
extract-heal-agent mid-replay. Plan 4 ships the deterministic, unit-tested core
that this integration calls (`runExtractor`, `runExtractorPaged`, golden-probe,
`buildExtractHealRequest`, `bf extract-heal`). Wiring it into `scripts/cdp/` +
`generate-runner.mjs` with fixture-server e2e is a follow-up plan.
