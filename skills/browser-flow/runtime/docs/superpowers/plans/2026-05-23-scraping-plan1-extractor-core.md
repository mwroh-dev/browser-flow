# Plan 1 — Deterministic Extractor Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, deterministic extractor that turns an `ExtractorConfig` + an HTML snapshot into a 3-state structured result — no LLM, no browser, no storage.

**Architecture:** Three pieces. (1) `ExtractorConfigV1` Zod schema in the existing `schemas.mjs` (mirrors `ScopeResultV1`). (2) `extractor.mjs` — `runExtractor(html, config)` parses HTML with **linkedom** and returns raw extraction facts `{ rows, cardinality, containerResolved }`. (3) `golden-probe.mjs` — `classify(extraction, golden)` maps those facts to `{ status: "data" | "confident-zero" | "drift" }`. Foundation for all later plans; depends on nothing new.

**Tech Stack:** Node ESM (`.mjs`), `linkedom@^0.18.12` (`parseHTML`), `zod@^4`, `node:test` + `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/plans/2026-05-23-scraping-agent-spec.md` (decisions ①②③, constitution map, contracts §3).

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `scripts/lib/schema-versions.mjs` | modify | add `extractorConfig: 1` to `SCHEMA_VERSIONS` + `ACCEPTED_VERSIONS` |
| `scripts/lib/schemas.mjs` | modify | add `ExtractorConfigV1`, `ExtractorConfigArtifact`, `parseExtractorConfig` (append, mirror `ScopeResultV1`) |
| `scripts/extract/extractor.mjs` | create | pure linkedom runner: `runExtractor(html, config) → { rows, cardinality, containerResolved }` |
| `scripts/extract/golden-probe.mjs` | create | pure 3-state classifier: `classify(extraction, golden) → { status, rows, reason? }` |
| `tests/extract/extractor-config.test.mjs` | create | schema tests |
| `tests/extract/extractor.test.mjs` | create | runExtractor tests |
| `tests/extract/golden-probe.test.mjs` | create | classify tests |

**Test commands:**
- Single file (fast iteration): `node --import=./tests/_setup.mjs --test tests/extract/<file>.test.mjs`
- Full suite: `npm test`

---

## Task 1: ExtractorConfigV1 schema + version

**Files:**
- Modify: `scripts/lib/schema-versions.mjs`
- Modify: `scripts/lib/schemas.mjs` (append after `parseScopeResult`, ~line 670)
- Test: `tests/extract/extractor-config.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/extract/extractor-config.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseExtractorConfig } from "../../scripts/lib/schemas.mjs";

test("parseExtractorConfig accepts a valid listing config", () => {
  const config = {
    schemaVersion: 1,
    pageKey: "manual/example.com/list",
    container: "ul.list > li",
    fields: [{ name: "title", selector: "a.title", attribute: "textContent", required: true }]
  };
  const parsed = parseExtractorConfig(config);
  assert.equal(parsed.pageKey, "manual/example.com/list");
  assert.equal(parsed.fields.length, 1);
});

test("parseExtractorConfig accepts container=null (single-item)", () => {
  const config = {
    schemaVersion: 1,
    pageKey: "manual/example.com/article",
    container: null,
    fields: [{ name: "title", selector: "h1" }]
  };
  assert.equal(parseExtractorConfig(config).container, null);
});

test("parseExtractorConfig rejects empty fields", () => {
  const config = { schemaVersion: 1, pageKey: "k", container: null, fields: [] };
  assert.throws(() => parseExtractorConfig(config), /extractor-config/);
});

test("parseExtractorConfig rejects wrong schemaVersion", () => {
  const config = { schemaVersion: 99, pageKey: "k", container: null, fields: [{ name: "t", selector: "h1" }] };
  assert.throws(() => parseExtractorConfig(config));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=./tests/_setup.mjs --test tests/extract/extractor-config.test.mjs`
Expected: FAIL — `parseExtractorConfig` is not exported.

- [ ] **Step 3a: Add the version key**

In `scripts/lib/schema-versions.mjs`, change:
```js
  scoringResult: 1,
  scopeResult: 1
});
```
to (in BOTH `SCHEMA_VERSIONS` and `ACCEPTED_VERSIONS` — the second uses `Object.freeze([1])`):
```js
  scoringResult: 1,
  scopeResult: 1,
  extractorConfig: 1
});
```
And in `ACCEPTED_VERSIONS`:
```js
  scopeResult: Object.freeze([1]),
  extractorConfig: Object.freeze([1])
});
```

- [ ] **Step 3b: Add the schema**

Append to `scripts/lib/schemas.mjs` (after `parseScopeResult`, end of file):
```js
// Phase NNN: ExtractorConfig — the reusable, deterministic extraction artifact
// emitted once by the scraping sub-agent and run forever by `bf extract` with
// zero model calls (code-over-prompt). container=null → single-item page
// (article/detail); otherwise container selects the repeating unit and each
// field selector resolves relative to it.
const ExtractorFieldShape = z
  .object({
    name: z.string().min(1),
    selector: z.string().min(1),
    attribute: z.string().min(1).optional(), // default "textContent" applied in extractor
    required: z.boolean().optional(),
    fallbackSelector: z.string().min(1).nullable().optional(),
    transform: z.enum(["trim", "parseInt", "parseFloat"]).nullable().optional()
  })
  .passthrough();

const ExtractorConfigV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.extractorConfig),
    pageKey: z.string().min(1),
    container: z.string().min(1).nullable(),
    fields: z.array(ExtractorFieldShape).min(1)
  })
  .passthrough();

export const ExtractorConfigArtifact = z.discriminatedUnion("schemaVersion", [ExtractorConfigV1]);

/**
 * Parse + validate an extractor-config document. Throws a path-prefixed Error
 * on shape mismatch; returns the validated object on success.
 * @param {unknown} input @param {string} [artifactPath]
 */
export function parseExtractorConfig(input, artifactPath = "<inline>") {
  const result = ExtractorConfigArtifact.safeParse(input);
  if (!result.success) {
    throw formatZodError(result.error, artifactPath, "extractor-config");
  }
  return result.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=./tests/_setup.mjs --test tests/extract/extractor-config.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**
```bash
git add scripts/lib/schema-versions.mjs scripts/lib/schemas.mjs tests/extract/extractor-config.test.mjs
git commit -m "feat(extract): ExtractorConfigV1 schema + parseExtractorConfig"
```

---

## Task 2: runExtractor — listing (container + relative fields)

**Files:**
- Create: `scripts/extract/extractor.mjs`
- Test: `tests/extract/extractor.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/extract/extractor.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { runExtractor } from "../../scripts/extract/extractor.mjs";

const LISTING = `<!doctype html><html><body><ul class="list">
  <li class="item"><a class="title">First</a><span class="price">₩1,000</span></li>
  <li class="item"><a class="title">Second</a><span class="price">₩2,000</span></li>
</ul></body></html>`;

test("runExtractor extracts rows from a listing container", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.list > li.item",
    fields: [
      { name: "title", selector: "a.title", attribute: "textContent", required: true },
      { name: "price", selector: "span.price", attribute: "textContent" }
    ]
  };
  const out = runExtractor(LISTING, config);
  assert.equal(out.containerResolved, true);
  assert.equal(out.cardinality, 2);
  assert.deepEqual(out.rows[0], { title: "First", price: "₩1,000" });
  assert.equal(out.rows[1].title, "Second");
});

test("runExtractor reports containerResolved=false when container absent", () => {
  const config = { schemaVersion: 1, pageKey: "k", container: "ul.missing > li", fields: [{ name: "t", selector: "a" }] };
  const out = runExtractor(LISTING, config);
  assert.equal(out.containerResolved, false);
  assert.equal(out.cardinality, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=./tests/_setup.mjs --test tests/extract/extractor.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/extract/extractor.mjs`:
```js
// Phase NNN: deterministic extractor core. Pure function — no LLM, no browser,
// no storage. Parses a (sanitized) HTML snapshot with linkedom and applies an
// ExtractorConfig to produce raw extraction facts. The 3-state verdict is the
// job of golden-probe.mjs; this module reports only what it observed.

import { parseHTML } from "linkedom";

// Agent-blind safety hook (code, not prompt — multi-layered-safety-via-code):
// the sanitizer emits two redaction marker formats — `<redacted-input-value>`
// (attributes) and `[redacted-secret-text]` / `[redacted-email]` (text nodes).
// Never emit either as extracted data.
function isRedacted(/** @type {unknown} */ v) {
  return /[[<]redacted-/.test(String(v ?? ""));
}

/**
 * @param {Element|Document} scope
 * @param {{ selector: string, attribute?: string, fallbackSelector?: string|null, transform?: string|null }} field
 * @returns {string|number|null}
 */
function readField(scope, field) {
  let node = scope.querySelector(field.selector);
  if (!node && field.fallbackSelector) node = scope.querySelector(field.fallbackSelector);
  if (!node) return null;
  const attr = field.attribute || "textContent";
  let raw = attr === "textContent" ? (node.textContent || "") : (node.getAttribute(attr) || "");
  if (attr === "textContent") raw = raw.replace(/\s+/g, " ").trim();
  if (isRedacted(raw)) return null;
  return applyTransform(raw, field.transform || null);
}

/** @param {string} value @param {string|null} transform */
function applyTransform(value, transform) {
  switch (transform) {
    case "trim": return String(value).trim();
    case "parseInt": {
      const n = parseInt(String(value).replace(/[^\d-]/g, ""), 10);
      return Number.isNaN(n) ? null : n;
    }
    case "parseFloat": {
      const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
      return Number.isNaN(n) ? null : n;
    }
    default: return value;
  }
}

/** @param {Record<string, unknown>} row @param {Array<{name:string,required?:boolean}>} fields */
function rowIsKeepable(row, fields) {
  const requiredOk = fields.filter((f) => f.required).every((f) => row[f.name] != null && row[f.name] !== "");
  const hasAny = fields.some((f) => row[f.name] != null && row[f.name] !== "");
  return requiredOk && hasAny;
}

/**
 * Run an extractor config against an HTML string.
 * @param {string} html
 * @param {{ container: string|null, fields: Array<{name:string,selector:string,attribute?:string,required?:boolean,fallbackSelector?:string|null,transform?:string|null}> }} config
 * @returns {{ rows: Record<string, unknown>[], cardinality: number, containerResolved: boolean }}
 */
export function runExtractor(html, config) {
  const { document } = parseHTML(typeof html === "string" ? html : "");

  if (config.container === null || config.container === undefined) {
    const row = {};
    for (const field of config.fields) row[field.name] = readField(document, field);
    const keep = rowIsKeepable(row, config.fields);
    return { rows: keep ? [row] : [], cardinality: keep ? 1 : 0, containerResolved: true };
  }

  const containers = Array.from(document.querySelectorAll(config.container));
  const rows = [];
  for (const el of containers) {
    const row = {};
    for (const field of config.fields) row[field.name] = readField(el, field);
    if (rowIsKeepable(row, config.fields)) rows.push(row);
  }
  return { rows, cardinality: rows.length, containerResolved: containers.length > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=./tests/_setup.mjs --test tests/extract/extractor.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**
```bash
git add scripts/extract/extractor.mjs tests/extract/extractor.test.mjs
git commit -m "feat(extract): runExtractor listing path (linkedom, pure)"
```

---

## Task 3: runExtractor — single-item (container=null)

**Files:**
- Modify: `tests/extract/extractor.test.mjs` (append)

(Implementation already handles this branch — this task locks it with a test.)

- [ ] **Step 1: Write the failing-then-passing test**

Append to `tests/extract/extractor.test.mjs`:
```js
const ARTICLE = `<!doctype html><html><body><main>
  <h1 class="hd">Headline</h1><div class="body">Body text</div>
</main></body></html>`;

test("runExtractor extracts a single row when container is null", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: null,
    fields: [{ name: "title", selector: "h1.hd" }, { name: "body", selector: "div.body" }]
  };
  const out = runExtractor(ARTICLE, config);
  assert.equal(out.containerResolved, true);
  assert.equal(out.cardinality, 1);
  assert.equal(out.rows[0].title, "Headline");
  assert.equal(out.rows[0].body, "Body text");
});

test("runExtractor returns 0 rows when single-item required field missing", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: null,
    fields: [{ name: "title", selector: "h1.absent", required: true }]
  };
  const out = runExtractor(ARTICLE, config);
  assert.equal(out.cardinality, 0);
  assert.equal(out.containerResolved, true);
});
```

- [ ] **Step 2: Run to verify it passes immediately (branch already implemented)**

Run: `node --import=./tests/_setup.mjs --test tests/extract/extractor.test.mjs`
Expected: PASS (4/4 total). If FAIL, fix the `container === null` branch in `extractor.mjs`.

- [ ] **Step 3: Commit**
```bash
git add tests/extract/extractor.test.mjs
git commit -m "test(extract): runExtractor single-item (container=null) coverage"
```

---

## Task 4: runExtractor — fallbackSelector + transform

**Files:**
- Modify: `tests/extract/extractor.test.mjs` (append)

- [ ] **Step 1: Write the test**

Append to `tests/extract/extractor.test.mjs`:
```js
const FALLBACK = `<ul class="l"><li class="i">
  <a class="t">Item</a><span class="p2">₩29.99</span>
</li></ul>`;

test("runExtractor uses fallbackSelector when primary misses", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.l > li.i",
    fields: [{ name: "title", selector: "a.t" }, { name: "price", selector: "span.price", fallbackSelector: "span.p2" }]
  };
  const out = runExtractor(FALLBACK, config);
  assert.equal(out.rows[0].price, "₩29.99");
});

test("runExtractor applies parseFloat transform", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.l > li.i",
    fields: [{ name: "title", selector: "a.t" }, { name: "price", selector: "span.p2", transform: "parseFloat" }]
  };
  const out = runExtractor(FALLBACK, config);
  assert.equal(out.rows[0].price, 29.99);
});
```

- [ ] **Step 2: Run to verify it passes (already implemented)**

Run: `node --import=./tests/_setup.mjs --test tests/extract/extractor.test.mjs`
Expected: PASS (6/6 total).

- [ ] **Step 3: Commit**
```bash
git add tests/extract/extractor.test.mjs
git commit -m "test(extract): fallbackSelector + parseFloat transform coverage"
```

---

## Task 5: runExtractor — redaction safety hook (red case)

**Files:**
- Modify: `tests/extract/extractor.test.mjs` (append)

- [ ] **Step 1: Write the test**

Append to `tests/extract/extractor.test.mjs`:
```js
const REDACTED = `<ul class="l"><li class="i">
  <a class="t">[redacted-email]</a><input class="v" value="<redacted-input-value>">
  <span class="ok">Visible</span>
</li></ul>`;

test("runExtractor never emits redacted markers (both [..] and <..> forms)", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.l > li.i",
    fields: [
      { name: "email", selector: "a.t" },
      { name: "val", selector: "input.v", attribute: "value" },
      { name: "ok", selector: "span.ok" }
    ]
  };
  const out = runExtractor(REDACTED, config);
  assert.equal(/redacted-/.test(JSON.stringify(out.rows)), false);
  // the non-redacted field still extracts
  assert.equal(out.rows[0].ok, "Visible");
  assert.equal(out.rows[0].email, null);
  assert.equal(out.rows[0].val, null);
});
```

- [ ] **Step 2: Run to verify it passes (hook already implemented)**

Run: `node --import=./tests/_setup.mjs --test tests/extract/extractor.test.mjs`
Expected: PASS (7/7 total). If FAIL, confirm `isRedacted` regex `/[[<]redacted-/` in `extractor.mjs`.

- [ ] **Step 3: Commit**
```bash
git add tests/extract/extractor.test.mjs
git commit -m "test(extract): redaction safety hook drops both marker formats"
```

---

## Task 6: classify — 3-state verdict

**Files:**
- Create: `scripts/extract/golden-probe.mjs`
- Test: `tests/extract/golden-probe.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/extract/golden-probe.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../../scripts/extract/golden-probe.mjs";

test("classify returns data when rows present (no golden)", () => {
  const r = classify({ rows: [{ a: 1 }], cardinality: 1, containerResolved: true }, null);
  assert.equal(r.status, "data");
  assert.equal(r.rows.length, 1);
});

test("classify returns confident-zero when container resolves but 0 rows", () => {
  const r = classify({ rows: [], cardinality: 0, containerResolved: true }, null);
  assert.equal(r.status, "confident-zero");
});

test("classify returns drift when container absent", () => {
  const r = classify({ rows: [], cardinality: 0, containerResolved: false }, null);
  assert.equal(r.status, "drift");
  assert.match(r.reason, /container/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=./tests/_setup.mjs --test tests/extract/golden-probe.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/extract/golden-probe.mjs`:
```js
// Phase NNN: golden liveness probe (decision ② of the scraping spec). Pure
// function. Maps raw extractor facts to a 3-state verdict so chained flows
// (A→B) never treat a silently-empty result as valid data
// (direction-maintenance: a consistent empty JSON is a false reliability
// signal). The user's capture is ground truth — `golden` carries the
// known-good cardinality so a structure-intact zero (confident-zero) is
// distinguished from a structure-broken zero (drift).

// ≥ this fraction drop vs golden cardinality flags a suspicious result as drift.
export const CARDINALITY_DROP_THRESHOLD = 0.5;

/**
 * @param {{ rows: Record<string, unknown>[], cardinality: number, containerResolved: boolean }} extraction
 * @param {{ cardinality?: number }|null|undefined} golden
 * @returns {{ status: "data"|"confident-zero"|"drift", rows: Record<string, unknown>[], reason?: string }}
 */
export function classify(extraction, golden) {
  const { rows, cardinality, containerResolved } = extraction;

  if (cardinality > 0) {
    if (golden && typeof golden.cardinality === "number" && golden.cardinality > 0) {
      const drop = (golden.cardinality - cardinality) / golden.cardinality;
      if (drop >= CARDINALITY_DROP_THRESHOLD) {
        return {
          status: "drift",
          rows,
          reason: `cardinality ${cardinality} dropped ≥${CARDINALITY_DROP_THRESHOLD * 100}% from golden ${golden.cardinality}`
        };
      }
    }
    return { status: "data", rows };
  }

  if (containerResolved) {
    return { status: "confident-zero", rows: [] };
  }
  return { status: "drift", rows: [], reason: "container selector resolved 0 elements (structure absent)" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import=./tests/_setup.mjs --test tests/extract/golden-probe.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**
```bash
git add scripts/extract/golden-probe.mjs tests/extract/golden-probe.test.mjs
git commit -m "feat(extract): golden-probe 3-state classify (data/confident-zero/drift)"
```

---

## Task 7: classify — cardinality-drop drift + golden-absent

**Files:**
- Modify: `tests/extract/golden-probe.test.mjs` (append)

- [ ] **Step 1: Write the test**

Append to `tests/extract/golden-probe.test.mjs`:
```js
test("classify flags drift on >=50% cardinality drop vs golden", () => {
  const r = classify({ rows: new Array(5).fill({ a: 1 }), cardinality: 5, containerResolved: true }, { cardinality: 24 });
  assert.equal(r.status, "drift");
  assert.match(r.reason, /cardinality/);
});

test("classify returns data on a small (<50%) cardinality dip", () => {
  const r = classify({ rows: new Array(20).fill({ a: 1 }), cardinality: 20, containerResolved: true }, { cardinality: 24 });
  assert.equal(r.status, "data");
});

test("classify ignores cardinality check when golden absent", () => {
  const r = classify({ rows: [{ a: 1 }], cardinality: 1, containerResolved: true }, undefined);
  assert.equal(r.status, "data");
});
```

- [ ] **Step 2: Run to verify it passes (already implemented)**

Run: `node --import=./tests/_setup.mjs --test tests/extract/golden-probe.test.mjs`
Expected: PASS (6/6 total).

- [ ] **Step 3: Commit**
```bash
git add tests/extract/golden-probe.test.mjs
git commit -m "test(extract): classify cardinality-drop drift + golden-absent paths"
```

---

## Task 8: Full-suite regression + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all pre-existing tests still pass + the new `tests/extract/*` (13 new tests). 0 failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors (the project typechecks `.mjs` via JSDoc — match the existing baseline; if there were pre-existing errors, no NEW ones).

- [ ] **Step 3: Commit (only if any fixup was needed)**
```bash
git add -A
git commit -m "chore(extract): Plan 1 full-suite green + typecheck clean"
```

---

## Self-Review

- **Spec coverage:** §3.2 ExtractorConfigV1 → Task 1. Extractor 3-state core (decision ②) → Tasks 2–7. Redaction safety (constitution #14) → Task 5. Eval golden cases 1–5 (listing/article/confident-zero/fallback/transform) → Tasks 2–6. Eval red cases 6/8/10 (drift/redacted/cardinality-collapse) → Tasks 5–7. Red case 7 (no-schema) and 9 (bad selector / Gate-2) belong to Plan 2 (agent + apply gates), not the pure core — noted, not a gap.
- **Type consistency:** `runExtractor → { rows, cardinality, containerResolved }` consumed verbatim by `classify(extraction, golden)`. `classify → { status, rows, reason? }` with status enum `data|confident-zero|drift` used identically across Tasks 6–7. `parseExtractorConfig` named consistently in Task 1 test + impl.
- **Placeholders:** none — every step has full code or an exact command.

## Out of scope (later plans)

`bf extract` command, scrape-request/result, knowledge/scraping persistence, golden.json on-disk, pagination, extraction-heal. See spec §5 (Plans 2–4).
