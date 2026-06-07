# Distribution P2 — Provenance Scrub + no-provenance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip development archaeology (`Phase N`, `(#NN …)`) from the non-test shipping surface, keeping the *principle*, and lock it with a `no-provenance` hard gate.

**Architecture:** Add a `no-provenance` gate (TDD) that fails on provenance markers in the shipping surface, with narrative docs and `tests/` exempt; then run a parallel cheap-model sub-agent fan-out to scrub markers with judgment (keep the why/what, drop the when/which-phase); then turn the gate on in `npm run check`.

**Tech Stack:** Node ESM, `node:test`, sub-agents (haiku for enumeration, sonnet for judgment edits).

**Spec:** `docs/superpowers/specs/2026-05-24-publish-bundle-design.md` (Component 2 no-provenance, Component 3 scrub). Depends on **P1** (shipping-surface resolver + manifest must exist).

**Scope:** scripts/ (312), .codex/ (85), docs/ excl narrative (110), AGENTS.md (9), README/CLAUDE. **tests/ (215) is deferred to P3** (audited there; temporarily exempt here). **Exempt always:** `docs/ENGINEERING-LOG.md` and `docs/research-applied.md` (the designated narrative/citation homes — dev-arc references are their content, not archaeology).

---

## Task 1: The `no-provenance` gate (TDD; starts RED on the real repo)

**Files:**
- Create: `scripts/security/no-provenance.mjs`
- Test: `tests/security/no-provenance.test.mjs`

- [ ] **Step 1: Write the failing unit test**

`tests/security/no-provenance.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findProvenance } from "../../scripts/security/no-provenance.mjs";

test("flags a Phase marker", () => {
  assert.deepEqual(findProvenance("// Phase 43: parser-backed sanitize"), ["Phase 43"]);
});

test("flags a lesson marker", () => {
  assert.ok(findProvenance("symmetric gates (#29 [2026-05-19])").includes("(#29"));
});

test("ignores prose without markers", () => {
  assert.deepEqual(findProvenance("parser-backed DOM sanitize with redaction"), []);
});

test("does not flag the word phase or version numbers", () => {
  assert.deepEqual(findProvenance("a phased rollout in v1.2.3"), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/security/no-provenance.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gate**

`scripts/security/no-provenance.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShippingFiles } from "../lib/shipping-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = resolve(repoRoot, "scripts/publish/bundle-allowlist.json");

// Capital-P "Phase <n>" and lesson markers "(#<n>"; word "phase" and semver are NOT matched.
const PROVENANCE_RE = /\bPhase \d+|\(#\d+\b/g;
const TEXT_EXT = /\.(mjs|js|cjs|ts|md|ya?ml)$/;

// Narrative/citation docs (dev-arc references are their content) + the gate's own files.
const EXEMPT = new Set([
  "docs/ENGINEERING-LOG.md",
  "docs/research-applied.md",
  "scripts/security/no-provenance.mjs",
  "tests/security/no-provenance.test.mjs"
]);
// TEMPORARY: tests/ provenance is scrubbed in P3 (tests audit). Removed there.
const EXEMPT_PREFIX = ["tests/"];

/** @param {string} content @returns {string[]} */
export function findProvenance(content) {
  return [...content.matchAll(PROVENANCE_RE)].map((m) => m[0]);
}

function main() {
  const files = resolveShippingFiles(repoRoot, manifestPath).filter(
    (f) => TEXT_EXT.test(f) && !EXEMPT.has(f) && !EXEMPT_PREFIX.some((p) => f.startsWith(p))
  );
  /** @type {{rel: string, marker: string}[]} */
  const findings = [];
  for (const rel of files) {
    for (const marker of findProvenance(readFileSync(resolve(repoRoot, rel), "utf8"))) {
      findings.push({ rel, marker });
    }
  }
  if (findings.length > 0) {
    const byFile = new Map();
    for (const f of findings) byFile.set(f.rel, (byFile.get(f.rel) ?? 0) + 1);
    for (const [rel, n] of [...byFile].sort()) process.stderr.write(`PROV ${rel} (${n})\n`);
    process.stderr.write(`\nno-provenance FAILED: ${findings.length} marker(s) across ${byFile.size} file(s).\n`);
    process.exit(1);
  }
  process.stdout.write(`no-provenance OK (${files.length} files)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run the unit test — passes**

Run: `node --test tests/security/no-provenance.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the gate against the repo — expect RED with the baseline**

Run: `node scripts/security/no-provenance.mjs`
Expected: FAIL listing scripts/ + .codex/ + docs/ + AGENTS.md files with counts (~500 markers, tests excluded). Record the file list — it is the work queue for Tasks 2–3.

- [ ] **Step 6: Commit the gate (not yet wired into check)**

```bash
git add scripts/security/no-provenance.mjs tests/security/no-provenance.test.mjs
git commit -m "feat(security): no-provenance gate (RED until scrub complete)"
```

---

## Task 2: Scrub scripts/ + .codex/ (parallel sub-agent fan-out)

**Principle for every edit:** delete the provenance marker, keep the principle. Examples:
- `// Phase 43: parser-backed DOM sanitize with textContent redaction.` → `// parser-backed DOM sanitize with textContent redaction.`
- `// (#29 [2026-05-19]) symmetric gates` → `// symmetric gates`
- If a comment is *only* a phase pointer with no principle (`// Phase 80 follow-up`), delete the whole comment.
- Never alter code/strings — comments only, except markdown prose in `.codex/**/*.md`.

- [ ] **Step 1: Enumerate (cheap model — haiku)**

Dispatch one `explore` sub-agent (model: haiku):
> READ-ONLY. List every shipping file under `scripts/` and `.codex/` containing `Phase \d+` or `(#\d+`, with per-file line numbers and the exact matched text. Output a markdown table: `file | line | matched text | surrounding comment`. Do not edit.

- [ ] **Step 2: Scrub in parallel (judgment model — sonnet)**

Partition the file list into N batches (≈10 files each). Dispatch N `executor` sub-agents **in parallel** (model: sonnet), each with:
> Edit ONLY the files in this batch: <paths>. For each `Phase \d+` / `(#\d+ …)` marker in a COMMENT or markdown prose, remove the marker but keep the principle (the why/what). If a comment is only a phase/lesson pointer with no principle, delete the whole comment line. NEVER change code, string literals, identifiers, or `.json`. After editing, run `node --test` on any colocated test and `npm run typecheck`; report pass/fail. Do not commit.

- [ ] **Step 3: Verify scripts/ + .codex/ are clean**

Run: `node scripts/security/no-provenance.mjs 2>&1 | grep -E '^PROV (scripts|\.codex)/' || echo "scripts + .codex clean"`
Expected: `scripts + .codex clean`

- [ ] **Step 4: Typecheck + test (no behavior changed)**

Run: `npm run typecheck && npm test`
Expected: both pass (comments-only edits must not change behavior).

- [ ] **Step 5: Commit**

```bash
git add scripts .codex
git commit -m "refactor: scrub provenance markers from scripts/ + .codex/ (keep principle)"
```

---

## Task 3: Scrub docs/ (excl narrative) + AGENTS.md + README/CLAUDE

**Files:** `docs/architecture.md`, `docs/patterns-applied.md`, `docs/baseline-comparison.md`, `docs/capture-semantics.md`, `docs/baseline/**`, `AGENTS.md`, `README.md`, `CLAUDE.md`. (NOT `ENGINEERING-LOG.md`, NOT `research-applied.md`.)

- [ ] **Step 1: Special-case AGENTS.md lesson markers**

`AGENTS.md` has 9 `(#NN [date])` markers appended to architecture/security rules (e.g. `… same commit. (#14 [2026-05-19])`). Dispatch one `executor` (sonnet):
> In `AGENTS.md`, remove every trailing `(#NN [date])` lesson marker, keeping the rule text intact. Do not change rule meaning. Report the count removed.

- [ ] **Step 2: Scrub the remaining docs (sonnet, parallel)**

Dispatch `executor` sub-agents (sonnet) over the doc list (excl the two narrative docs). Same principle as Task 2 (drop marker, keep principle; markdown prose). For `patterns-applied.md` (110 markers, heaviest), allow a dedicated agent.

- [ ] **Step 3: Verify the non-test surface is fully clean**

Run: `node scripts/security/no-provenance.mjs`
Expected: `no-provenance OK (<N> files)` — tests/ still exempt; narrative docs exempt.

- [ ] **Step 4: Sanity-check the narrative exemptions are intentional**

Run: `node -e "const {findProvenance}=await import('./scripts/security/no-provenance.mjs');const {readFileSync}=await import('node:fs');for(const f of ['docs/ENGINEERING-LOG.md','docs/research-applied.md'])console.log(f, findProvenance(readFileSync(f,'utf8')).length)"`
Expected: nonzero counts for both (confirming they *would* fail if not exempt — i.e. exemption is load-bearing and deliberate).

- [ ] **Step 5: Commit**

```bash
git add docs AGENTS.md README.md CLAUDE.md
git commit -m "refactor(docs): scrub provenance markers (keep principle); narrative docs exempt"
```

---

## Task 4: Wire `no-provenance` into `npm run check`

**Files:** `package.json`

- [ ] **Step 1: Add the script and chain it**

In `package.json` `scripts`:

```json
    "no-provenance": "node scripts/security/no-provenance.mjs",
    "check": "npm run lint && npm run typecheck && npm run validate-skill && npm run pii-scan && npm run no-provenance && npm test",
```

- [ ] **Step 2: Full check green**

Run: `npm run check`
Expected: all gates + tests pass (`no-provenance OK`).

- [ ] **Step 3: Rebuild the bundle and re-verify integrity**

Run: `node scripts/publish/build-bundle.mjs && cd dist && npm install --no-audit --no-fund --silent && npm run check; cd ..`
Expected: bundle builds, no leaks, bundle `npm run check` passes (the bundle inherits the now-green gates).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: enforce no-provenance in npm run check (non-test surface)"
```

---

## Self-Review (filled)

**Spec coverage:** no-provenance gate (T1), scrub scripts/.codex (T2), docs/AGENTS/README (T3), wire-in + bundle re-verify (T4). tests/ provenance + exemption removal handed to P3. Narrative-doc exemptions implemented + asserted load-bearing (T3 S4). ✓

**Placeholder scan:** sub-agent steps specify exact model, exact instruction, exact verify command — not "scrub somehow". The per-file edits are data-driven (the marker list) but the *rule* (drop marker, keep principle) and the *gate* that proves completion are concrete. ✓

**Type/name consistency:** `findProvenance(content)` matches across gate + test; `PROVENANCE_RE` single source; EXEMPT/EXEMPT_PREFIX named consistently; P3 removes the `tests/` EXEMPT_PREFIX entry. ✓

**Risk:** over-scrub removes useful context → mitigated by sonnet judgment (not `sed`) + `npm test` after each batch + review between tasks.
