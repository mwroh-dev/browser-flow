# Plan 2 — Scraping Setup Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the end-to-end setup path for ONE run: orchestrator provides a target schema → `bf extract` emits a scrape-request → the scraping sub-agent returns a scrape-result → `bf extract --apply` validates it, stores the run-scoped extractor config, runs it against the capture snapshot (Gate-3 Fact check), and writes the extracted data + a `step.extraction` reference.

**Architecture:** Mirror the `scope` subsystem (`commands/scope.mjs` + `scope/scope-apply.mjs` + `ScopeResultV1`). New deterministic glue consumes Plan 1's `runExtractor` + `classify`. Durable cross-run knowledge storage is deferred to Plan 3 — Plan 2 stores config/data as **run artifacts** (`artifacts/runs/<id>/`, gitignored) so the loop is complete and testable on its own.

**Tech Stack:** Node ESM, `zod@^4`, `node:zlib` `gunzipSync`, `node:test`. Builds on Plan 1 (`scripts/extract/extractor.mjs`, `golden-probe.mjs`, `ExtractorConfigV1`). No new dependencies.

**Spec:** `docs/superpowers/plans/2026-05-23-scraping-agent-spec.md` §3 (contracts), §5 (Plan 2 scope).

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `scripts/lib/schema-versions.mjs` | modify | add `scrapeResult: 1` (+ ACCEPTED) |
| `scripts/lib/schemas.mjs` | modify | add `ScrapeResultV1` + `parseScrapeResult`; add `extraction` to `Step` |
| `scripts/lib/config.mjs` | modify | add extract artifact paths to `getRunPaths` |
| `scripts/extract/snapshot-read.mjs` | create | `readSnapshotHtml(manifestPath, snapshotsDir, stepIndex)` → gunzipped HTML |
| `scripts/extract/extract-apply.mjs` | create | `applyExtract(steps, scrapeResult)` → writes `step.extraction`, returns `{applied, stepIndex, pageKey}` |
| `scripts/commands/extract.mjs` | create | `bf extract` (emit scrape-request / `--apply`: validate→apply→run→write artifacts) |
| `scripts/cli.mjs` | modify | register `extract` + help line |
| `.codex/skills/scraping-agent/SKILL.md` | modify | cheerio→linkedom; `.html.gz` gunzip; remove `pagination` from config; add `golden` emission; add pagination classification |

**Test commands:** single file `node --import=./tests/_setup.mjs --test tests/extract/<file>.test.mjs`; full `npm test`; types `npx tsc --noEmit`.

---

## Task 1: ScrapeResultV1 schema + parser

**Files:**
- Modify: `scripts/lib/schema-versions.mjs`
- Modify: `scripts/lib/schemas.mjs` (append after `parseExtractorConfig`)
- Test: `tests/extract/scrape-result.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/scrape-result.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseScrapeResult } from "../../scripts/lib/schemas.mjs";

const EXTRACTED = {
  schemaVersion: 1, runId: "x", stepIndex: 2, status: "extracted", pageType: "listing",
  extractorConfig: { container: "ul.l > li", fields: [{ name: "title", selector: "a.t", required: true }] },
  golden: { cardinality: 3, sampleValues: [{ title: "A" }] },
  pagination: { kind: "none" }
};

test("parseScrapeResult: valid extracted result parses", () => {
  const r = parseScrapeResult(EXTRACTED);
  assert.equal(r.status, "extracted");
  assert.equal(r.extractorConfig.fields.length, 1);
});

test("parseScrapeResult: valid no-schema result parses", () => {
  const r = parseScrapeResult({ schemaVersion: 1, runId: "x", stepIndex: 2, status: "no-schema", reason: "no reliable selectors" });
  assert.equal(r.status, "no-schema");
});

test("parseScrapeResult: extracted without extractorConfig throws", () => {
  assert.throws(() => parseScrapeResult({ schemaVersion: 1, runId: "x", stepIndex: 2, status: "extracted" }), /scrape-result/);
});

test("parseScrapeResult: no-schema without reason throws", () => {
  assert.throws(() => parseScrapeResult({ schemaVersion: 1, runId: "x", stepIndex: 2, status: "no-schema" }), /scrape-result/);
});

test("parseScrapeResult: bad schemaVersion throws", () => {
  assert.throws(() => parseScrapeResult({ ...EXTRACTED, schemaVersion: 2 }), /scrape-result/);
});
```

- [ ] **Step 2: Run — expect FAIL** (`parseScrapeResult` not exported)
Run: `node --import=./tests/_setup.mjs --test tests/extract/scrape-result.test.mjs`

- [ ] **Step 3a: version** — in `scripts/lib/schema-versions.mjs`, change the `extractorConfig: 1` line added in Plan 1 (in BOTH objects):
```js
  extractorConfig: 1,
  scrapeResult: 1
});
```
and
```js
  extractorConfig: Object.freeze([1]),
  scrapeResult: Object.freeze([1])
});
```

- [ ] **Step 3b: schema** — append to `scripts/lib/schemas.mjs` (after `parseExtractorConfig`):
```js
// Phase NNN: ScrapeResult — output contract of the scraping sub-agent (Plan 2).
// status "extracted" carries an extractor-config body (container+fields) the
// agent verified against the snapshot + a golden sample (drift oracle);
// "no-schema" carries a reason. Mirrors ScopeResultV1; superRefine enforces the
// status↔field pairing (same shape as HealResultV1). The agent emits the config
// body WITHOUT schemaVersion/pageKey — bf extract --apply wraps it into a full
// ExtractorConfigV1 by adding those.
const ScrapeResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.scrapeResult),
    runId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    status: z.enum(["extracted", "no-schema"]),
    pageType: z.enum(["listing", "article", "detail", "search"]).optional(),
    extractorConfig: z
      .object({
        container: z.string().min(1).nullable(),
        fields: z.array(ExtractorFieldShape).min(1)
      })
      .passthrough()
      .optional(),
    golden: z
      .object({
        cardinality: z.number().int().nonnegative().optional(),
        sampleValues: z.array(z.record(z.string(), z.unknown())).optional()
      })
      .passthrough()
      .optional(),
    pagination: z.object({ kind: z.enum(["none", "simple", "complex"]) }).passthrough().optional(),
    reason: z.string().optional(),
    note: z.string().optional()
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.status === "extracted" && !v.extractorConfig) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "extracted status requires extractorConfig" });
    }
    if (v.status === "no-schema" && !v.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "no-schema status requires a reason" });
    }
  });

/**
 * Parse + validate a scrape-result.json document.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseScrapeResult(input, artifactPath = "<inline>") {
  const result = ScrapeResultV1.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "scrape-result");
  }
  return result.data;
}
```

- [ ] **Step 4: Run — expect PASS (5/5)**
- [ ] **Step 5: Commit**
```bash
git add scripts/lib/schema-versions.mjs scripts/lib/schemas.mjs tests/extract/scrape-result.test.mjs
git commit -m "feat(extract): ScrapeResultV1 schema + parseScrapeResult"
```

---

## Task 2: Step.extraction field

**Files:**
- Modify: `scripts/lib/schemas.mjs` (the `Step` object)
- Test: `tests/extract/scrape-result.test.mjs` (append)

- [ ] **Step 1: Write the test** (append):
```js
import { parseWorkflowArtifact } from "../../scripts/lib/schemas.mjs";

test("Step.extraction is accepted on a workflow step", () => {
  const wf = {
    schemaVersion: 1, id: "x",
    steps: [{ action: "goto", pageKey: "k", extraction: { pageKey: "k", status: "extracted", pagination: { kind: "none" } } }]
  };
  const parsed = parseWorkflowArtifact(wf);
  assert.equal(parsed.steps[0].extraction.status, "extracted");
});
```

- [ ] **Step 2: Run — likely PASS already** (Step is `.passthrough()`). If it passes, the field flows through untyped. We still add an explicit declaration for documentation + typed access.
Run: `node --import=./tests/_setup.mjs --test tests/extract/scrape-result.test.mjs`

- [ ] **Step 3: Add explicit field** — in `scripts/lib/schemas.mjs`, find the `Step` object and add `extraction` after `tabOrdinal`:
```js
    tabOrdinal: z.number().int().nonnegative().optional(),
    extraction: z
      .object({
        pageKey: z.string(),
        status: z.enum(["extracted", "no-schema"]),
        pagination: z.object({ kind: z.string() }).passthrough().optional()
      })
      .passthrough()
      .optional()
```
(Add a comma after `tabOrdinal: …optional()` — confirm the previous line ends without a trailing comma before editing.)

- [ ] **Step 4: Run — expect PASS (6/6 in this file)**
- [ ] **Step 5: Commit**
```bash
git add scripts/lib/schemas.mjs tests/extract/scrape-result.test.mjs
git commit -m "feat(extract): declare Step.extraction reference field"
```

---

## Task 3: extract artifact paths in getRunPaths

**Files:**
- Modify: `scripts/lib/config.mjs`
- Test: `tests/extract/run-paths.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/run-paths.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { getRunPaths } from "../../scripts/lib/config.mjs";

test("getRunPaths exposes scraping artifact paths", () => {
  const p = getRunPaths("demo-run");
  assert.match(p.scrapeRequestPath, /demo-run\/scrape-request\.json$/);
  assert.match(p.scrapeResultPath, /demo-run\/scrape-result\.json$/);
  assert.match(p.extractorConfigPath, /demo-run\/extractor-config\.json$/);
  assert.match(p.extractResultPath, /demo-run\/extract-result\.json$/);
});
```

- [ ] **Step 2: Run — expect FAIL** (paths undefined → `match` on undefined throws)
- [ ] **Step 3: Add paths** — in `scripts/lib/config.mjs`, change:
```js
    scopeRequestPath: resolve(runRoot, "scope-request.json"),
    scopeResultPath: resolve(runRoot, "scope-result.json")
  };
```
to:
```js
    scopeRequestPath: resolve(runRoot, "scope-request.json"),
    scopeResultPath: resolve(runRoot, "scope-result.json"),
    // Phase NNN: scraping extractor — request/result + run-scoped config + extracted data.
    scrapeRequestPath: resolve(runRoot, "scrape-request.json"),
    scrapeResultPath: resolve(runRoot, "scrape-result.json"),
    extractorConfigPath: resolve(runRoot, "extractor-config.json"),
    extractResultPath: resolve(runRoot, "extract-result.json")
  };
```

- [ ] **Step 4: Run — expect PASS (1/1)**
- [ ] **Step 5: Commit**
```bash
git add scripts/lib/config.mjs tests/extract/run-paths.test.mjs
git commit -m "feat(extract): scraping artifact paths in getRunPaths"
```

---

## Task 4: snapshot-read (gunzip by stepIndex)

**Files:**
- Create: `scripts/extract/snapshot-read.mjs`
- Test: `tests/extract/snapshot-read.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/snapshot-read.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readSnapshotHtml } from "../../scripts/extract/snapshot-read.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  const snapsDir = join(dir, "snapshots");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    entries: [
      { index: 0, url: "https://x/", timestamp: 1, filename: "000-root.html.gz" },
      { index: 2, url: "https://x/list", timestamp: 2, filename: "002-list.html.gz" }
    ]
  }));
  // mkdir snapshots and write two gzipped html files
  writeFileSync(join(dir, "_mk"), ""); // placeholder; create dir below
  return { dir, snapsDir };
}

test("readSnapshotHtml returns gunzipped HTML for an exact index", () => {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  const snapsDir = join(dir, "snapshots");
  // node:fs mkdirSync via writeFile in a created dir
  const { mkdirSync } = require ? require("node:fs") : {};
  // ESM-safe mkdir:
  import("node:fs").then(() => {});
  return Promise.resolve();
});
```

> NOTE: rewrite Step 1 cleanly (no `require` in ESM). Use the version below.

Replace the file with this clean version:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readSnapshotHtml } from "../../scripts/extract/snapshot-read.mjs";

/** @returns {{ manifestPath: string, snapsDir: string }} */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  const snapsDir = join(dir, "snapshots");
  mkdirSync(snapsDir, { recursive: true });
  writeFileSync(join(snapsDir, "000-root.html.gz"), gzipSync(Buffer.from("<html><body>root</body></html>")));
  writeFileSync(join(snapsDir, "002-list.html.gz"), gzipSync(Buffer.from("<html><body><ul><li>item</li></ul></body></html>")));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    entries: [
      { index: 0, url: "https://x/", timestamp: 1, filename: "000-root.html.gz" },
      { index: 2, url: "https://x/list", timestamp: 2, filename: "002-list.html.gz" }
    ]
  }));
  return { manifestPath, snapsDir };
}

test("readSnapshotHtml returns gunzipped HTML for an exact index", () => {
  const { manifestPath, snapsDir } = fixture();
  const html = readSnapshotHtml(manifestPath, snapsDir, 2);
  assert.match(html, /<li>item<\/li>/);
});

test("readSnapshotHtml falls back to nearest index <= stepIndex", () => {
  const { manifestPath, snapsDir } = fixture();
  const html = readSnapshotHtml(manifestPath, snapsDir, 1); // no index 1 → nearest below = 0
  assert.match(html, /root/);
});

test("readSnapshotHtml throws on empty manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "snap-empty-"));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, entries: [] }));
  assert.throws(() => readSnapshotHtml(manifestPath, dir, 0), /no snapshots/);
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)
- [ ] **Step 3: Implement** — create `scripts/extract/snapshot-read.mjs`:
```js
// Phase NNN: read a captured snapshot's HTML for a given step. Snapshots are
// gzipped (`<index>-<slug>.html.gz`) under artifacts/runs/<id>/snapshots/, indexed
// by the snapshots-manifest. Matches the step by snapshot index: exact, else the
// nearest entry with index <= stepIndex, else the first entry.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { readJson } from "../lib/fs.mjs";

/**
 * @param {string} manifestPath
 * @param {string} snapshotsDir
 * @param {number} stepIndex
 * @returns {string}
 */
export function readSnapshotHtml(manifestPath, snapshotsDir, stepIndex) {
  const manifest = /** @type {{ entries?: Array<{ index: number, filename: string }> }} */ (readJson(manifestPath));
  const entries = Array.isArray(manifest && manifest.entries) ? manifest.entries : [];
  if (entries.length === 0) throw new Error("no snapshots in manifest");

  let entry = entries.find((e) => e.index === stepIndex);
  if (!entry) {
    const below = entries
      .filter((e) => typeof e.index === "number" && e.index <= stepIndex)
      .sort((a, b) => b.index - a.index);
    entry = below[0] || entries[0];
  }

  const file = resolve(snapshotsDir, entry.filename);
  const buf = readFileSync(file);
  return entry.filename.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}
```

- [ ] **Step 4: Run — expect PASS (3/3)**
- [ ] **Step 5: Commit**
```bash
git add scripts/extract/snapshot-read.mjs tests/extract/snapshot-read.test.mjs
git commit -m "feat(extract): readSnapshotHtml gunzip by step index"
```

---

## Task 5: extract-apply (pure)

**Files:**
- Create: `scripts/extract/extract-apply.mjs`
- Test: `tests/extract/extract-apply.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/extract-apply.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { applyExtract } from "../../scripts/extract/extract-apply.mjs";

const STEPS = () => [{ action: "goto" }, { action: "click", pageKey: "manual/x/list" }];

test("applyExtract writes step.extraction for an extracted result", () => {
  const steps = STEPS();
  const out = applyExtract(steps, {
    stepIndex: 1, status: "extracted",
    extractorConfig: { container: "ul", fields: [{ name: "t", selector: "a" }] },
    pagination: { kind: "none" }
  });
  assert.equal(out.applied, true);
  assert.equal(out.pageKey, "manual/x/list");
  assert.equal(steps[1].extraction.status, "extracted");
  assert.equal(steps[1].extraction.pageKey, "manual/x/list");
  assert.deepEqual(steps[1].extraction.pagination, { kind: "none" });
});

test("applyExtract records no-schema without marking applied", () => {
  const steps = STEPS();
  const out = applyExtract(steps, { stepIndex: 1, status: "no-schema", reason: "none" });
  assert.equal(out.applied, false);
  assert.equal(steps[1].extraction.status, "no-schema");
});

test("applyExtract is a no-op for an out-of-range stepIndex", () => {
  const steps = STEPS();
  const out = applyExtract(steps, { stepIndex: 9, status: "extracted", extractorConfig: { container: null, fields: [{ name: "t", selector: "a" }] } });
  assert.equal(out.applied, false);
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)
- [ ] **Step 3: Implement** — create `scripts/extract/extract-apply.mjs`:
```js
// @ts-check
// Phase NNN: applyExtract — deterministic application of the scraping sub-agent's
// verdict onto a workflow step. Mirror of applyScope: the model produces the
// verdict, this code writes the step.extraction REFERENCE (pageKey + status +
// pagination). The extractor-config BODY itself is persisted separately by
// bf extract --apply (run artifact in Plan 2; knowledge/scraping in Plan 3).

/**
 * @param {Array<Record<string, any>>} steps
 * @param {{ stepIndex?: number, status?: string, pagination?: any }} scrapeResult
 * @returns {{ applied: boolean, stepIndex: number|undefined, pageKey: string }}
 */
export function applyExtract(steps, scrapeResult) {
  const stepIndex = scrapeResult ? scrapeResult.stepIndex : undefined;
  if (!scrapeResult) return { applied: false, stepIndex, pageKey: "" };
  const step = Array.isArray(steps) && typeof stepIndex === "number" ? steps[stepIndex] : undefined;
  if (!step) return { applied: false, stepIndex, pageKey: "" };

  const pageKey = step.pageKey || "";
  const status = scrapeResult.status === "extracted" ? "extracted" : "no-schema";
  step.extraction = {
    pageKey,
    status,
    pagination: scrapeResult.pagination || { kind: "none" }
  };
  return { applied: status === "extracted", stepIndex, pageKey };
}
```

- [ ] **Step 4: Run — expect PASS (3/3)**
- [ ] **Step 5: Commit**
```bash
git add scripts/extract/extract-apply.mjs tests/extract/extract-apply.test.mjs
git commit -m "feat(extract): applyExtract writes step.extraction reference"
```

---

## Task 6: bf extract emit path + CLI registration

**Files:**
- Create: `scripts/commands/extract.mjs`
- Modify: `scripts/cli.mjs`
- Test: `tests/extract/extract-command.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/extract/extract-command.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExtractCommand } from "../../scripts/commands/extract.mjs";

/** @param {any} r */ const R = (r) => r;

test("runExtractCommand no --apply: emits scrape-request with the target schema", async () => {
  const runId = `extract-emit-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: "manual/x/list" }] });
  const schemaPath = join(mkdtempSync(join(tmpdir(), "schema-")), "schema.json");
  writeFileSync(schemaPath, JSON.stringify({ fields: [{ name: "title", description: "headline", required: true }] }));

  const out = R(await runExtractCommand({ runId, stepIndex: 1, schemaPath }));
  assert.equal(out.candidates[0].stepIndex, 1);
  assert.equal(out.candidates[0].pageKey, "manual/x/list");
  assert.equal(out.candidates[0].targetSchema.fields[0].name, "title");
  const req = R(readJson(runPaths.scrapeRequestPath));
  assert.equal(req.candidates[0].targetSchema.fields[0].name, "title");
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)
- [ ] **Step 3: Implement command (emit path only for now)** — create `scripts/commands/extract.mjs`:
```js
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseScrapeResult } from "../lib/schemas.mjs";
import { applyExtract } from "../extract/extract-apply.mjs";
import { readSnapshotHtml } from "../extract/snapshot-read.mjs";
import { runExtractor } from "../extract/extractor.mjs";
import { classify } from "../extract/golden-probe.mjs";

/**
 * Phase NNN: bf extract — the scraping sub-agent's deterministic companion.
 * - no `--apply`: emit scrape-request.json (target schema + snapshot pointers)
 *   for the orchestrator to dispatch the scraping-agent against.
 * - `--apply <scrape-result.json>`: validate, write step.extraction, persist the
 *   run-scoped extractor-config, run it against the capture snapshot (Gate-3
 *   Fact), and write extract-result.json. LLM-free.
 *
 * @param {{ runId: string, applyPath?: string, schemaPath?: string, stepIndex?: number }} input
 * @param {{ readSnapshotHtml?: Function, runExtractor?: Function, classify?: Function }} [deps]
 */
export async function runExtractCommand(input, deps = {}) {
  const runPaths = getRunPaths(input.runId);
  const workflow = /** @type {{ steps: Record<string, any>[] } & Record<string, any>} */ (readJson(runPaths.workflowJsonPath));

  if (!input.applyPath) {
    if (typeof input.stepIndex !== "number") throw new Error("bf extract (emit) requires --step <n>");
    if (!input.schemaPath) throw new Error("bf extract (emit) requires --schema <path>");
    const targetSchema = readJson(input.schemaPath);
    const step = workflow.steps[input.stepIndex];
    const request = {
      runId: input.runId,
      candidates: [{ stepIndex: input.stepIndex, pageKey: (step && step.pageKey) || "", targetSchema }],
      snapshotsManifestPath: runPaths.snapshotsManifestPath,
      snapshotsDir: runPaths.snapshotsDir
    };
    writeJson(runPaths.scrapeRequestPath, request);
    return request;
  }

  // --apply path is implemented in Task 7.
  throw new Error("bf extract --apply not yet implemented");
}

/** @param {Record<string, string | boolean>} options */
export function extractCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf extract requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  const schemaPath = getStringOption(options, "schema", undefined);
  const stepRaw = getStringOption(options, "step", undefined);
  const stepIndex = stepRaw === undefined ? undefined : Number(stepRaw);
  return runExtractCommand({ runId, applyPath, schemaPath, stepIndex });
}
```

- [ ] **Step 4: Register in CLI** — in `scripts/cli.mjs`:
  (a) after the `import { scopeCommand } …` line, add:
```js
import { extractCommand } from "./commands/extract.mjs";
```
  (b) in `helpText`, after the `scope`/`serve-browser` lines (before `help`), add a line:
```
  extract   Emit a scrape-request or apply a scrape-result to extract structured data — --run-id <id> --step <n> --schema <f> | --apply <scrape-result.json>
```
  (c) after the `if (command === "scope") { … }` block, add:
```js
  if (command === "extract") {
    process.stdout.write(`${JSON.stringify(await extractCommand(options), null, 2)}\n`);
    return;
  }
```

- [ ] **Step 5: Run — expect PASS (1/1)** + smoke the CLI help:
```bash
node --import=./tests/_setup.mjs --test tests/extract/extract-command.test.mjs
node scripts/cli.mjs help | grep extract
```
Expected: test passes; help shows the `extract` line.

- [ ] **Step 6: Commit**
```bash
git add scripts/commands/extract.mjs scripts/cli.mjs tests/extract/extract-command.test.mjs
git commit -m "feat(extract): bf extract emit path + CLI registration"
```

---

## Task 7: bf extract --apply path (validate → apply → run → write)

**Files:**
- Modify: `scripts/commands/extract.mjs`
- Test: `tests/extract/extract-command.test.mjs` (append)

- [ ] **Step 1: Write the test** (append):
```js
import { mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { writeFileSync as wf } from "node:fs";

test("runExtractCommand --apply: applies, runs against snapshot, writes extract-result (status data)", async () => {
  const runId = `extract-apply-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: "manual/x/list" }] });
  // capture snapshot for step 1
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  wf(join(runPaths.snapshotsDir, "001-list.html.gz"), gzipSync(Buffer.from(
    `<ul class="l"><li class="i"><a class="t">First</a></li><li class="i"><a class="t">Second</a></li></ul>`
  )));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "https://x/list", timestamp: 1, filename: "001-list.html.gz" }] });
  // the scrape-result the agent would have produced
  writeJson(runPaths.scrapeResultPath, {
    schemaVersion: 1, runId, stepIndex: 1, status: "extracted", pageType: "listing",
    extractorConfig: { container: "ul.l > li.i", fields: [{ name: "title", selector: "a.t", required: true }] },
    golden: { cardinality: 2, sampleValues: [{ title: "First" }] },
    pagination: { kind: "none" }
  });

  const out = R(await runExtractCommand({ runId, applyPath: runPaths.scrapeResultPath }));
  assert.equal(out.status, "data");
  assert.equal(out.cardinality, 2);
  // step.extraction reference written
  const wfOut = R(readJson(runPaths.workflowJsonPath));
  assert.equal(wfOut.steps[1].extraction.status, "extracted");
  assert.equal(wfOut.steps[1].extraction.pageKey, "manual/x/list");
  // run-scoped config + result artifacts written
  const cfg = R(readJson(runPaths.extractorConfigPath));
  assert.equal(cfg.pageKey, "manual/x/list");
  assert.equal(cfg.schemaVersion, 1);
  const res = R(readJson(runPaths.extractResultPath));
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].title, "First");
});

test("runExtractCommand --apply no-schema: writes reference, no extraction run", async () => {
  const runId = `extract-apply-ns-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: "k" }] });
  writeJson(runPaths.scrapeResultPath, { schemaVersion: 1, runId, stepIndex: 1, status: "no-schema", reason: "no reliable selectors" });

  const out = R(await runExtractCommand({ runId, applyPath: runPaths.scrapeResultPath }));
  assert.equal(out.status, "no-schema");
  const wfOut = R(readJson(runPaths.workflowJsonPath));
  assert.equal(wfOut.steps[1].extraction.status, "no-schema");
});
```

- [ ] **Step 2: Run — expect FAIL** (`--apply not yet implemented` throws)
- [ ] **Step 3: Implement** — in `scripts/commands/extract.mjs`, replace the line
```js
  // --apply path is implemented in Task 7.
  throw new Error("bf extract --apply not yet implemented");
```
with:
```js
  const scrapeResult = parseScrapeResult(readJson(input.applyPath), input.applyPath);
  const applied = applyExtract(workflow.steps, scrapeResult);
  writeJson(runPaths.workflowJsonPath, workflow);

  if (scrapeResult.status !== "extracted" || !scrapeResult.extractorConfig) {
    return { runId: input.runId, status: "no-schema", stepIndex: applied.stepIndex, reason: scrapeResult.reason };
  }

  // Wrap the agent's config body into a full ExtractorConfigV1 + persist (run-scoped).
  const config = { schemaVersion: 1, pageKey: applied.pageKey, ...scrapeResult.extractorConfig };
  writeJson(runPaths.extractorConfigPath, config);

  // Gate-3 (Fact): run the config against the capture snapshot; classify the result.
  const readSnap = deps.readSnapshotHtml ?? readSnapshotHtml;
  const extract = deps.runExtractor ?? runExtractor;
  const verdict = deps.classify ?? classify;
  const html = readSnap(runPaths.snapshotsManifestPath, runPaths.snapshotsDir, applied.stepIndex);
  const extraction = extract(html, config);
  const result = verdict(extraction, scrapeResult.golden);

  const out = {
    runId: input.runId,
    stepIndex: applied.stepIndex,
    pageKey: applied.pageKey,
    status: result.status,
    rows: result.rows,
    cardinality: extraction.cardinality,
    reason: result.reason
  };
  writeJson(runPaths.extractResultPath, out);
  return out;
}
```
(Removing the trailing `}` that closed the function before — ensure exactly one closing brace for `runExtractCommand`.)

- [ ] **Step 4: Run — expect PASS (3/3 in this file)**
- [ ] **Step 5: Commit**
```bash
git add scripts/commands/extract.mjs tests/extract/extract-command.test.mjs
git commit -m "feat(extract): bf extract --apply runs config vs snapshot + writes artifacts"
```

---

## Task 8: scraping-agent SKILL.md corrections

**Files:**
- Modify: `.codex/skills/scraping-agent/SKILL.md`

The SKILL.md was written before codebase recon. Fix the 4 divergences from the actual implementation.

- [ ] **Step 1: Fix the parser** — replace any "Cheerio" recommendation with linkedom (the project's actual parser). Search the file for `Cheerio`/`cheerio` and change the runtime-library statements to: "the deterministic runtime runs the config via **linkedom** (`parseHTML`), already a project dependency."

- [ ] **Step 2: Fix snapshot loading** — the "Finding the snapshot HTML" section currently says prefer `.html` over `.html.gz`. Replace with: snapshots are stored **only as `.html.gz`**; the runtime gunzips them. The agent should read the `.html.gz` entry from `snapshots-manifest.json` (the agent's own Read of HTML is for reasoning; the runtime uses `readSnapshotHtml`).

- [ ] **Step 3: Remove `pagination` from extractorConfig** — the `extractorConfig` example must NOT contain a `pagination` field (a static-snapshot extractor cannot click "next"). Move pagination to the **scrape-result top level** as `pagination: { kind: "none" | "simple" | "complex" }` — the agent's setup-time classification (decision ③). Add a short section: "Pagination: classify the user's intent. `simple` = a uniform next-link list the replay loop can iterate deterministically; `complex` = conditional/heterogeneous paging the main model orchestrates. Never emit click-by-click pagination."

- [ ] **Step 4: Add `golden` emission** — document that `scrape-result` must include `golden: { cardinality, sampleValues }` captured by running the proposed selectors against the snapshot (the drift oracle, decision ②). `sampleValues` must be real text from the snapshot; never fabricated; never a `[redacted-…]`/`<redacted-…>` token.

- [ ] **Step 5: Align output shape** — ensure the documented `scrape-result.json` matches `ScrapeResultV1`: `{ schemaVersion:1, runId, stepIndex, status:"extracted"|"no-schema", pageType?, extractorConfig:{container,fields}, golden:{cardinality,sampleValues}, pagination:{kind}, reason?, note? }`. The `extractorConfig` body has NO `schemaVersion`/`pageKey` (added by `bf extract --apply`).

- [ ] **Step 6: Verify** — confirm corrections:
```bash
grep -i "cheerio" .codex/skills/scraping-agent/SKILL.md   # expect: no matches
grep -c "linkedom" .codex/skills/scraping-agent/SKILL.md   # expect: >= 1
grep -c "golden" .codex/skills/scraping-agent/SKILL.md      # expect: >= 1
```

- [ ] **Step 7: Commit**
```bash
git add .codex/skills/scraping-agent/SKILL.md
git commit -m "docs(skill): align scraping-agent to impl (linkedom, .html.gz, golden, pagination classification)"
```

---

## Task 9: Full-suite regression + typecheck

- [ ] **Step 1:** `npm test > /tmp/bf-p2.txt 2>&1; echo "EXIT=$?"` — expect new extract tests pass; only the known-flaky `verify-breadth-enrichment` e2e may fail (verify in isolation if it does).
- [ ] **Step 2:** `npx tsc --noEmit > /tmp/tsc-p2.txt 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp/tsc-p2.txt` — expect EXIT=0, 0 errors.
- [ ] **Step 3:** Commit any fixup if needed.

---

## Self-Review

- **Spec coverage:** §3.5 ScrapeResultV1 → Task 1. §3.6 Step.extraction → Task 2. §4 paths → Task 3. snapshot gunzip → Task 4. apply → Task 5. `bf extract` emit/apply → Tasks 6–7. SKILL fixes → Task 8. Red case 7 (no-schema) → Task 1+7. Gate-3 Fact (selectors must match snapshot) → Task 7 (runs config vs snapshot).
- **Type consistency:** `runExtractCommand({ runId, applyPath?, schemaPath?, stepIndex? }, deps)`; `applyExtract(steps, scrapeResult) → {applied, stepIndex, pageKey}`; `readSnapshotHtml(manifestPath, snapshotsDir, stepIndex) → string`; `parseScrapeResult` consistent. Config wrapped as `{ schemaVersion:1, pageKey, ...body }` matches `ExtractorConfigV1` (Plan 1).
- **Placeholders:** Task 4 Step 1 has a deliberately-replaced draft block — the clean version is the one to use.
- **assert.match guard (Plan 1 lesson):** any `assert.match(x.reason, …)` on optional fields must wrap `String(x.reason)`.

## Out of scope (Plan 3+)

knowledge/scraping/<pageKey>/ durable persistence + golden.json on disk + artifact→knowledge promotion + cross-run reuse (Plan 3); extraction-heal + pagination runtime loop (Plan 4).
