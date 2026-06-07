# Public-Readiness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the security, verification-truthfulness, release-hygiene, and doc-integrity gaps surfaced in the Phase-0 audit while preserving the existing CDP-direct architecture — turning browser-flow into a credibly publishable prototype.

**Architecture:** Small, verifiable patches accumulated phase-by-phase. Fixes are placed at *chokepoints* (path-builders in `scripts/lib/config.mjs`, Chrome-arg builder in `scripts/cdp/browser-session.mjs`, the registry upsert in `scripts/registry/workflow-registry.mjs`) rather than scattered across call sites — this is DRY and satisfies the repo's "symmetric gate placement" rule (AGENTS.md → Architecture Rules). No runtime rewrite, no Playwright revert, no TypeScript migration, no folder re-layout.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, zod schemas (`.strict()`/`.passthrough()`), chrome-remote-interface (CDP-direct), git.

---

## Phase 0 — Baseline Audit (COMPLETE — evidence recorded here)

Three read-only audit lanes verified each claimed defect against actual code. **Several audit claims were FALSE or PARTIAL — the plan reflects code reality, not the audit's assumptions.**

### Confirmed TRUE (must fix)

| # | Claim | Evidence (file:line) | Verdict |
|---|---|---|---|
| 1 | runId path traversal | `scripts/lib/config.mjs:188` `getRunPaths` resolves `runsRoot/runId` with **zero** validation; `getVerifySpecPaths:174`, `getTaskPath:247`, `createCaptureProfileDir:296`, `getReplayProfileDir:303`, `getAttachProfileDir:314` all interpolate raw runId. `scripts/lib/run-id.mjs:4` only `.trim()`s. | **TRUE** |
| 2 | pageKey/scraping traversal | `scripts/lib/config.mjs:79` `scrapingPaths` + `:99` `pagePaths` only strip leading/trailing slashes (`.replace(/^\/+\|\/+$/g,"")`) — **mid-string `../` passes through**. Reaches via CLI (`doctor --page-key`, `teardown --page`) and untrusted workflow JSON (`extract.mjs`, `extract-apply.mjs`). | **TRUE** |
| 3 | CDP not loopback-bound | `scripts/cdp/browser-session.mjs:48` sets `--remote-debugging-port` but **no** `--remote-debugging-address`. Caller `extraArgs` (spread at `:54`) could append `--remote-debugging-address=0.0.0.0` (last-wins). | **TRUE** |
| 4 | `verify --first` mints `verified` | `scripts/verify/verify-run.mjs:206` hardcodes `securityOk:true` and `:226` writes registry `status:"verified"` with **no** replay, **no** `scanArtifacts`, **no** `security.json`. | **TRUE** |
| 5 | `--unmasked` looks green in report | `scripts/security/scan-artifacts.mjs:54` `ok = findings.length===0 \|\| unmasked` → `ok:true` despite findings; `verify-run.mjs:372/386` propagates `securityOk: security.ok` into `verification.json` → report shows green. | **TRUE** (report-level) |
| 6 | CLI help stale "Playwright runner" | `scripts/cli.mjs:37` `generate  Generate a runnable Playwright runner…` while `scripts/generate/generate-runner.mjs:103` emits `// CDP-direct runner — no playwright import.` | **TRUE** |
| 7 | baseline exhibit conflicts | `docs/baseline/runner-synthetic.mjs:21` `import { chromium } from "playwright";` — frozen 2026-05-19 pre-CDP snapshot, contradicts current CDP-direct claim; only weakly labelled. | **TRUE** |
| 8 | doc test-count mismatch | `docs/architecture.md:109` "50 tests passing"; `docs/baseline-comparison.md:15` "76 internal tests"; `docs/roadmap.md:121` "77/77 tests". Actual ≈ 569. | **TRUE** |
| 9 | README has no quickstart | `README.md` has Scope/Status/Journey/References but **no** install, command sequence, expected artifacts, local-only warning, or honest status line. | **TRUE** |

### Confirmed FALSE / PARTIAL (do NOT over-build)

| # | Claim | Reality | Verdict |
|---|---|---|---|
| A | "release bundle builder absent" | `scripts/publish/build-bundle.mjs` exists: allowlist-driven (`bundle-allowlist.json`), wipes release dir, `assertNoLeak()` fails on any non-allowlisted file, `SKIP_DIRS={.git,node_modules,artifacts,coverage,profiles,_temp,.claude}`. **Builder is sound.** Gap is only **test coverage** (no explicit exclusion/inclusion assertions on the produced surface) + `.pii-identities` not named in `bundle-gitignore`. | **PARTIAL — ~80% done** |
| B | unmasked → verified registry entry | Unmasked captures emit `workflow.security.localOnly=false`; `workflow-registry.mjs:28` **already refuses** those at upsert. So unmasked never reaches the registry today. The real residue is the *report* (claim 5). | **PARTIAL — registry already safe** |
| C | overstated marketing claims pervasive | grep found **no** "AI/autonomous browser agent", "battle-tested", "beats Playwright/Stagehand/Skyvern", "fully secure/solved". Only `docs/patterns-applied.md:4` "production-ready" — and it refers to *external* confirmed patterns, not browser-flow. | **MOSTLY FALSE — 1 ambiguous phrase** |
| D | "~550 tests" wrong | `docs/ENGINEERING-LOG.md:12` "~550 tests" is **approximately correct** (actual ≈569). Replace anyway for a single source of truth, but it is not a falsehood. | **PARTIAL** |

### Critical cross-cutting finding (affects success criterion #10)

The full `npm test` suite (~571 tests) has **non-deterministic real-Chrome failures under concurrent load** — the *specific* failing test varies run-to-run:
- Audit run: `tests/e2e/verify-breadth-enrichment.test.mjs` failed (`# fail 1`).
- Plan run: `tests/cdp/browser-session.test.mjs` + `tests/cdp/watchdogs/attachment-detect.test.mjs` failed.
- **Re-running any of them in isolation PASSES** (verified: `node --import=./tests/_setup.mjs --test tests/cdp/browser-session.test.mjs tests/cdp/watchdogs/attachment-detect.test.mjs` → 2/2 pass).

These are all tests that **launch a real headless Chrome** (port waits, launch contention, `driveObservedWorkflow`). The flakiness is environmental/timing, not deterministic breakage, and is pre-existing (`.claude/tasks.md` 2026-05-22: "flaky verify-breadth-enrichment=무관 pre-existing").

**Implication:** Success criterion #10 ("`npm run check` 통과") includes `npm test`. A pre-existing real-Chrome flake can fail `npm run check` on any given run regardless of our changes. **We will NOT game this** (no editing/deleting/skipping a test to force a pass). Phase 5 defines an honest pass condition: *all non-Chrome gates green + the test delta we add green + any residual failure is a real-Chrome test that passes on isolated re-run, explicitly reported as a flake.* See Phase 5.

> Design note: every new test this plan adds is **pure** (no Chrome launch) — `browser-args.test.mjs` deliberately tests the extracted `buildChromeArgs` function instead of launching Chrome, so the plan adds zero new flake surface.

### Test/style conventions (locked for all new tests)
- `import test from "node:test";` + `import assert from "node:assert/strict";`
- Path helpers live in `scripts/lib/config.mjs`; roots are env-overridable for tests via `tests/_setup.mjs` (`BROWSER_FLOW_PAGES_PATH`, `BROWSER_FLOW_SCRAPING_PATH`, `BROWSER_FLOW_REGISTRY_PATH`, …). `runsRoot` is **not** overridden (resolves under real `artifacts/runs`, which is gitignored).
- Both `VerificationV1` and `SecurityV1` schemas are `.passthrough()` — extra fields (e.g. `warningOnly`, `mode`, `bootstrapped`) persist without schema edits.

---

## Lane Structure (DAG)

The four work phases are **file-disjoint** except that Phase 2 *imports* (does not edit) `config.mjs`. Lanes:

```
Phase 0 (audit — done)
   │
   ├─ Lane A · Security Core  (SERIAL, highest risk):
   │     Phase 1 Path Safety ──► Phase 2 Runtime Security & Verification
   │     (one lane: both edit/centre on the security trust boundary;
   │      Phase 2 verify-pipeline tests run cleaner once path safety lands)
   │
   ├─ Lane B · Release Hygiene (INDEPENDENT):  Phase 3 Bundle test+gitignore
   │     files: tests/publish/*, scripts/publish/bundle-gitignore  (disjoint)
   │
   └─ Lane C · Claim Integrity (INDEPENDENT):  Phase 4 CLI help + docs + README
         files: scripts/cli.mjs (help string only), docs/*, README.md  (disjoint)
                          │
   Lanes A + B + C merge ─┴─► Phase 5 Final Verification & Report (CONVERGE)
```

**File-overlap proof (why B and C are safe in parallel):** Lane A touches `scripts/lib/config.mjs`, `scripts/lib/run-id.mjs`, `scripts/cdp/browser-session.mjs`, `scripts/security/scan-artifacts.mjs`, `scripts/verify/verify-run.mjs`, `scripts/registry/workflow-registry.mjs` (+ their tests). Lane B touches only `tests/publish/*` and `scripts/publish/bundle-gitignore`. Lane C touches only `scripts/cli.mjs` (help text constant), `docs/*.md`, `README.md`, `docs/baseline/*`. No file is edited by two lanes.

### Git strategy
Repo is on `main` (default). **Branch first** (user requested commit-per-task; do not commit hardening work directly to `main`).

- **Default (recommended): one feature branch, serial lane order A→B→C→Phase 5.** Simplest; commit per task; no merge overhead. Lanes are conceptual groupings that *could* be parallelised but file-disjointness already removes conflict risk so serial costs nothing but wall-clock.
- **Optional parallel: three git worktrees** (`superpowers:using-git-worktrees`), one per lane, merged before Phase 5. Use only if wall-clock matters; disjoint files guarantee clean merges.

```bash
git switch -c hardening/public-readiness
```

Each task below ends with its own commit (Conventional Commits style, matching repo history e.g. `fix(security): …`, `test(publish): …`, `docs(readme): …`).

---

# Lane A · Security Core

## Phase 1 — Path Safety Hardening

### Todo (work → expected result)

| # | Work | Expected result |
|---|---|---|
| 1.1 | Add `validateRunId` + `assertInsideRoot` to `config.mjs`; guard `getRunPaths`/`getVerifySpecPaths`/profile-dir builders | runId with `/ \ .. ` absolute/empty/overlong throws a clear error; valid ids unchanged |
| 1.2 | Replace weak slash-strip in `scrapingPaths`/`pagePaths` with `validatePageKey` (segment-based) + `assertInsideRoot` | mid-string `../`, backslash, absolute, URL-like keys throw; valid nested + derived keys (`manual/about:blank`, `<invalid-url>`, `:id`) pass |
| 1.3 | Full suite + lint regression | no existing test breaks; new path tests green; `node scripts/lint.mjs` clean |

### Design decision (surface to reviewer)
Validation is placed **inside the path-builder functions** (the chokepoint every one of the 44 runId call sites and 18 pageKey call sites funnels through), not duplicated at each caller. `pageSnapshotPath` → `pagePaths`, `writeScrapingKnowledge`/`extract-heal` → `scrapingPaths`, `getTaskPath` → `getRunPaths` are therefore covered transitively. This is DRY and matches AGENTS.md "a security gate … must be placed symmetrically across all N sites" — one gate at the single shared site beats N drifting copies.

---

### Task 1.1: Central runId validation + root containment

**Files:**
- Modify: `scripts/lib/config.mjs` (imports line 1–4; add validators after `getRepoRoot`; guard `getRunPaths:188`, `getVerifySpecPaths:174`, `createCaptureProfileDir:296`, `getReplayProfileDir:303`, `getAttachProfileDir:314`)
- Test: `tests/lib/path-safety.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/path-safety.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  getRunPaths, getVerifySpecPaths, getTaskPath, validateRunId, getRepoRoot
} from "../../scripts/lib/config.mjs";

const runsRoot = resolve(getRepoRoot(), "artifacts", "runs");

test("validateRunId rejects traversal and malformed ids", () => {
  for (const bad of ["../escape", "/tmp/escape", "a/b", "a\\b", "..", "", "C:\\x", "a".repeat(81)]) {
    assert.throws(() => validateRunId(bad), /Invalid runId/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("validateRunId accepts conservative valid ids", () => {
  for (const ok of ["demo", "demo-run", "run-2026-05-25T02-17-00.000Z", "breadth-e2e-1730000000000"]) {
    assert.equal(validateRunId(ok), ok);
  }
});

test("getRunPaths throws on traversal ids", () => {
  for (const bad of ["../escape", "/tmp/escape", "a/b", "a\\b", "..", ""]) {
    assert.throws(() => getRunPaths(bad), /Invalid runId/);
  }
});

test("getRunPaths keeps runRoot inside artifacts/runs", () => {
  const p = getRunPaths("demo-run");
  assert.equal(p.runRoot, resolve(runsRoot, "demo-run"));
  assert.ok(p.runRoot.startsWith(runsRoot + "/"));
});

test("getVerifySpecPaths and getTaskPath reject traversal ids", () => {
  assert.throws(() => getVerifySpecPaths("../escape"), /Invalid runId/);
  assert.throws(() => getTaskPath("../escape", "variable-extraction"), /Invalid runId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=./tests/_setup.mjs --test tests/lib/path-safety.test.mjs`
Expected: FAIL — `validateRunId` is not exported / `getRunPaths("../escape")` does not throw.

- [ ] **Step 3: Implement validators + guards in `config.mjs`**

Change the import line at the top of `scripts/lib/config.mjs`:

```js
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
```

Add, immediately after `export function getRepoRoot() { return repoRoot; }` (line 12):

```js
// runId format — conservative allowlist. Must start alphanumeric, then
// alphanumeric / dot / underscore / dash, max 80 chars total. The class
// excludes every path separator and ":" so a runId can never contain a
// traversal sequence, an absolute path, or a Windows drive letter.
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * Validate a runId. Throws on empty/overlong/separator/traversal/absolute.
 * @param {string} runId
 * @returns {string}
 */
export function validateRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `Invalid runId ${JSON.stringify(runId)}. Must match ${String(RUN_ID_PATTERN)} ` +
      `(start alphanumeric; only letters, digits, dot, underscore, dash; no slashes or "..", max 80 chars).`
    );
  }
  return runId;
}

/**
 * Defense-in-depth: assert a resolved path is contained within an intended
 * root. Throws otherwise. Used after path construction even when the input
 * was already validated.
 * @param {string} resolvedPath
 * @param {string} rootPath
 * @param {string} label
 * @returns {string}
 */
export function assertInsideRoot(resolvedPath, rootPath, label) {
  const root = resolve(rootPath);
  const rel = relative(root, resolvedPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} ${JSON.stringify(resolvedPath)} escapes its root ${JSON.stringify(root)}.`);
  }
  return resolvedPath;
}
```

In `getRunPaths` (currently line 188–190), insert validation + containment:

```js
export function getRunPaths(runId) {
  validateRunId(runId);
  const paths = getPaths();
  const runRoot = resolve(paths.runsRoot, runId);
  assertInsideRoot(runRoot, paths.runsRoot, "runRoot");
  return {
    runId,
    runRoot,
    // …unchanged rest of the object…
```

In `getVerifySpecPaths` (line 174), add `validateRunId(runId);` as the first statement.

In `createCaptureProfileDir` (line 296), `getReplayProfileDir` (line 303): add `validateRunId(runId);` as the first statement of each.

In `getAttachProfileDir` (line 314), add validation + containment:

```js
export function getAttachProfileDir(runId) {
  validateRunId(runId);
  const root = resolve(tmpdir(), "browser-flow-runtime");
  const dir = join(root, `attach-${runId}`);
  assertInsideRoot(dir, root, "attach profile dir");
  mkdirSync(dir, { recursive: true });
  return dir;
}
```

(`getTaskPath` already routes through `getRunPaths`, so it inherits validation — the test above asserts this.)

- [ ] **Step 4: Run the new test + the existing config/run-paths tests**

Run: `node --import=./tests/_setup.mjs --test tests/lib/path-safety.test.mjs tests/lib/config.test.mjs tests/extract/run-paths.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/config.mjs tests/lib/path-safety.test.mjs
git commit -m "fix(security): validate runId at path-builder chokepoint + assert root containment"
```

---

### Task 1.2: Central pageKey validation + root containment

**Files:**
- Modify: `scripts/lib/config.mjs` (`scrapingPaths:78`, `pagePaths:98`; add `validatePageKey`)
- Test: `tests/lib/page-key-safety.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/page-key-safety.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { scrapingPaths, pagePaths, validatePageKey } from "../../scripts/lib/config.mjs";

test("validatePageKey rejects traversal / absolute / url-like / backslash keys", () => {
  for (const bad of [
    "../../escape", "manual/../../escape", "manual\\escape", "/etc/passwd",
    "C:\\x", "http://evil.com/x", "", "manual/./x", "manual//x"
  ]) {
    assert.throws(() => validatePageKey(bad), /pageKey/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("validatePageKey accepts valid nested + derived keys", () => {
  for (const ok of [
    "manual/search-results", "manual/news.naver.com/section",
    "docs", "manual/about:blank", "<invalid-url>", "manual/example.com/post/:id"
  ]) {
    assert.equal(validatePageKey(ok), ok);
  }
});

test("scrapingPaths blocks traversal, keeps dir under scraping root", () => {
  assert.throws(() => scrapingPaths("../../escape"), /pageKey/);
  assert.throws(() => scrapingPaths("manual/../../escape"), /pageKey/);
  const p = scrapingPaths("manual/search-results");
  assert.match(p.scrapingDir, /scraping\/manual\/search-results$/);
});

test("pagePaths blocks traversal, keeps dir under pages root", () => {
  assert.throws(() => pagePaths("../../escape"), /pageKey/);
  const p = pagePaths("manual/search-results");
  assert.match(p.pageDir, /pages\/manual\/search-results$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=./tests/_setup.mjs --test tests/lib/page-key-safety.test.mjs`
Expected: FAIL — `validatePageKey` not exported; `scrapingPaths("manual/../../escape")` does not throw.

- [ ] **Step 3: Implement `validatePageKey` and rewire the two builders**

Add to `scripts/lib/config.mjs` (e.g. directly above `scrapingPaths`, after `getScrapingRoot` at line 72):

```js
/**
 * Validate a pageKey / scraping key. Unlike a runId these legitimately
 * contain "/" segments (e.g. "manual/example.com/post/:id"), so validation
 * is segment-based: reject backslashes, URL-like strings, drive letters,
 * absolute (leading "/"), and any empty / "." / ".." segment. Valid derived
 * keys with ":" (":id", "about:blank") and "<invalid-url>" are preserved.
 * @param {string} pageKey
 * @returns {string}
 */
export function validatePageKey(pageKey) {
  if (typeof pageKey !== "string" || pageKey.trim() === "") {
    throw new Error("pageKey must be a non-empty string.");
  }
  if (pageKey.includes("\\")) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: backslashes are not allowed.`);
  }
  if (pageKey.includes("://")) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: must be a relative key, not a URL.`);
  }
  if (/^[A-Za-z]:/.test(pageKey)) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: drive-letter / absolute paths are not allowed.`);
  }
  if (pageKey.startsWith("/")) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: must be relative, not absolute.`);
  }
  for (const segment of pageKey.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: empty or relative path segment ${JSON.stringify(segment)}.`);
    }
  }
  return pageKey;
}
```

Rewrite `scrapingPaths` (lines 78–90) to use it:

```js
export function scrapingPaths(pageKey) {
  validatePageKey(pageKey);
  const scrapingDir = resolve(getScrapingRoot(), pageKey);
  assertInsideRoot(scrapingDir, getScrapingRoot(), "scrapingDir");
  return {
    pageKey,
    scrapingDir,
    configPath: resolve(scrapingDir, "config.json"),
    goldenPath: resolve(scrapingDir, "golden.json")
  };
}
```

Rewrite `pagePaths` (lines 98–114) to use it:

```js
export function pagePaths(pageKey) {
  validatePageKey(pageKey);
  const pageDir = resolve(getPagesRoot(), pageKey);
  assertInsideRoot(pageDir, getPagesRoot(), "pageDir");
  return {
    pageKey,
    pageDir,
    selectorsPath: resolve(pageDir, "selectors.json"),
    neighborsPath: resolve(pageDir, "neighbors.json"),
    metaPath: resolve(pageDir, "meta.json"),
    moldPath: resolve(pageDir, "mold.json"),
    snapshotsDir: resolve(pageDir, "snapshots"),
    exploredEdgesPath: resolve(pageDir, "explored-edges.json")
  };
}
```

(`pageSnapshotPath` already calls `pagePaths`, so it inherits validation.)

- [ ] **Step 4: Run new + existing page/scraping tests**

Run: `node --import=./tests/_setup.mjs --test tests/lib/page-key-safety.test.mjs tests/extract/scraping-paths.test.mjs tests/lib/page-key.test.mjs`
Expected: PASS (note `scraping-paths.test.mjs` asserts `/pageKey/` on the empty-key throw — preserved by the new message).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/config.mjs tests/lib/page-key-safety.test.mjs
git commit -m "fix(security): segment-validate pageKey/scraping keys + assert knowledge-root containment"
```

---

### Task 1.3: Phase-1 regression gate

- [ ] **Step 1: lint**

Run: `node scripts/lint.mjs`
Expected: exit 0.

- [ ] **Step 2: full suite (path safety can't break valid flows)**

Run: `npm test 2>&1 | tail -5`
Expected: pass count unchanged except the new tests added (≈ +N); the only acceptable failure is the pre-existing `verify-breadth-enrichment` real-Chrome flake. If any **other** test regresses, STOP — a fixture is using a runId/pageKey the validator rejects; widen nothing silently, investigate the specific id.

- [ ] **Step 3: commit (only if Step 2 surfaced a fixture fix)** — otherwise skip.

### Phase 1 Backlog
- **[B1-a]** `slugifyUrl`/`snapshotPath` (config.mjs:261/274) also build paths from external strings but already hard-sanitize (`[^A-Za-z0-9._-]→_`). No traversal risk — *not* in scope.
- **[B1-b]** `profilePath` already has a strict pattern (config.mjs:149) — consistent with the new validators; no change.
- **[B1-c]** Consider a `scripts/lint.mjs` rule that flags any *new* `resolve(<root>, <external>)` not wrapped in a validator (caller-graph enforcement per AGENTS.md). Deeper; default-defer.

### Phase 1 End-of-Phase Regression Self-Review
Ask of each backlog item: *is this a fundamental hole that leaves criterion #1/#3 unmet right now?*
- B1-a / B1-b: NO — no live traversal path; already safe. Defer (record only).
- B1-c: NO for *this* goal — the chokepoint validators already enforce the invariant at runtime; the lint rule is a *future-regression* guard, not a current hole. Criterion #9 (lint passes) does not require it. **Defer to Remaining Work.** If, however, Phase 2 introduces another `resolve(root, external)` site, revisit B1-c then.

---

## Phase 2 — Runtime Security & Verification Truthfulness

### Todo (work → expected result)

| # | Work | Expected result |
|---|---|---|
| 2.1 | Extract `buildChromeArgs()`; add `--remote-debugging-address=127.0.0.1`; drop caller overrides | launch args always loopback-bound; `extraArgs` cannot rebind to `0.0.0.0` |
| 2.2 | `verify --first` → registry `status:"bootstrapped"` (not `verified`); run a real `scanArtifacts`; truthful `securityOk` | first/bootstrap never produces a `verified` entry; `security.json` exists for first runs |
| 2.3 | `isSecurityClean()` helper; report `securityOk` derived from clean (not `ok`); registry verified-gate requires artifacts + clean scan | unmasked+findings never shows green; no `verified` entry without green `verification.json`+`security.json` |
| 2.4 | Phase-2 regression gate | lint + suite green (modulo pre-existing flake) |

---

### Task 2.1: CDP loopback bind (testable arg builder)

**Files:**
- Modify: `scripts/cdp/browser-session.mjs` (extract `buildChromeArgs`, use in `createBrowserSession:45`)
- Test: `tests/cdp/browser-args.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/cdp/browser-args.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildChromeArgs } from "../../scripts/cdp/browser-session.mjs";

test("buildChromeArgs binds remote debugging to loopback", () => {
  const args = buildChromeArgs({ debugPort: 9222, profileDir: "/tmp/p" });
  assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(args.includes("--remote-debugging-port=9222"));
});

test("buildChromeArgs ignores caller attempts to rebind the address", () => {
  const args = buildChromeArgs({
    debugPort: 9222, profileDir: "/tmp/p",
    extraArgs: ["--remote-debugging-address=0.0.0.0", "--foo"]
  });
  assert.ok(!args.some((a) => a.includes("0.0.0.0")), "0.0.0.0 must be stripped");
  assert.equal(args.filter((a) => a.startsWith("--remote-debugging-address")).length, 1);
  assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(args.includes("--foo"), "unrelated extra args preserved");
});

test("buildChromeArgs prepends headless when requested", () => {
  const args = buildChromeArgs({ debugPort: 1, profileDir: "/tmp/p", headless: true });
  assert.equal(args[0], "--headless=new");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=./tests/_setup.mjs --test tests/cdp/browser-args.test.mjs`
Expected: FAIL — `buildChromeArgs` is not exported.

- [ ] **Step 3: Extract + harden the arg builder**

In `scripts/cdp/browser-session.mjs`, add an exported `buildChromeArgs` and call it from `createBrowserSession`. Replace lines 45–57 (`const chromePath … if (options.headless) args.unshift(...)`) with:

```js
/**
 * Build Chrome launch args. Always binds the DevTools endpoint to loopback
 * (127.0.0.1) and strips any caller attempt to rebind the address — the CDP
 * remote-debugging port must never be reachable off-host.
 * @param {BrowserSessionOptions} options
 * @returns {string[]}
 */
export function buildChromeArgs(options) {
  const extra = (options.extraArgs ?? []).filter(
    (a) => !/^--remote-debugging-address(=|$)/.test(a)
  );
  const args = [
    `--remote-debugging-port=${options.debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${options.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-features=ChromeSigninPromo,SigninIntercept,ProfilePickerOnStartup",
    ...extra,
    "about:blank"
  ];
  if (options.headless) args.unshift("--headless=new");
  return args;
}

export async function createBrowserSession(options) {
  const chromePath = options.chromePath ?? resolveChromeBinary();
  const args = buildChromeArgs(options);

  const chromeProcess = spawn(chromePath, args, { stdio: "ignore" });
  await waitForPort(options.debugPort, 15_000);
  // …unchanged rest of function…
```

- [ ] **Step 4: Run new test + existing CDP tests**

Run: `node --import=./tests/_setup.mjs --test tests/cdp/browser-args.test.mjs tests/cdp/client.test.mjs`
Expected: PASS (client.test.mjs builds its own args manually — unaffected).

- [ ] **Step 5: Commit**

```bash
git add scripts/cdp/browser-session.mjs tests/cdp/browser-args.test.mjs
git commit -m "fix(security): bind CDP remote-debugging endpoint to 127.0.0.1, reject address override"
```

---

### Task 2.2 + 2.3: Verification truthfulness (first-mode status, unmasked report, registry gate)

These three changes interlock (they all touch the verified/security trust boundary), so implement together.

**Files:**
- Modify: `scripts/security/scan-artifacts.mjs` (add `isSecurityClean` export)
- Modify: `scripts/verify/verify-run.mjs` (first-mode block lines 196–230; main `securityOk` at 369–386)
- Modify: `scripts/registry/workflow-registry.mjs` (verified-gate in `upsertRegistryEntry`)
- Modify: `tests/registry/lock.test.mjs` (retarget arbitrary `"verified"` → `"failed"` — intent is dedup/concurrency, not verification semantics)
- Test: `tests/security/security-clean.test.mjs` (new), `tests/registry/verified-gate.test.mjs` (new), `tests/verify/auth-modes.test.mjs` (extend first-mode assertion)

- [ ] **Step 1: Write the failing tests**

Create `tests/security/security-clean.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { isSecurityClean } from "../../scripts/security/scan-artifacts.mjs";

test("isSecurityClean: green only when ok and not warning-only", () => {
  assert.equal(isSecurityClean({ ok: true, warningOnly: false }), true);
  assert.equal(isSecurityClean({ ok: true }), true);                       // no findings
  assert.equal(isSecurityClean({ ok: true, warningOnly: true }), false);   // unmasked-suppressed
  assert.equal(isSecurityClean({ ok: false, warningOnly: false }), false); // blocked
  assert.equal(isSecurityClean(undefined), false);
});
```

Create `tests/registry/verified-gate.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";
import { upsertRegistryEntry, readRegistry } from "../../scripts/registry/workflow-registry.mjs";

function writeArtifacts(ok, warningOnly) {
  const dir = mkdtempSync(resolve(tmpdir(), "bf-vgate-"));
  mkdirSync(resolve(dir, "reports"), { recursive: true });
  const vPath = resolve(dir, "reports", "verification.json");
  const sPath = resolve(dir, "reports", "security.json");
  writeFileSync(vPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.verification, success: true, pathComplete: true,
    executedSteps: [], stepCount: 0, transitionChecks: [], securityOk: ok && !warningOnly,
    verifiedAt: new Date().toISOString()
  }));
  writeFileSync(sPath, JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.security, ok, findings: warningOnly ? [{ file: "x", reason: "y", match: "z" }] : [], warningOnly
  }));
  return { vPath, sPath };
}

test("verified upsert refused when artifacts are missing", () => {
  const id = `vgate-missing-${Date.now()}`;
  assert.throws(() => upsertRegistryEntry({ id, fixture: "synthetic", runId: id, status: "verified" }), /verified/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("verified upsert refused when security scan is warning-only (unmasked)", () => {
  const id = `vgate-warn-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, true);
  assert.throws(() => upsertRegistryEntry({
    id, fixture: "synthetic", runId: id, status: "verified",
    verificationPath: vPath, securityPath: sPath
  }), /verified/i);
  assert.equal(readRegistry().some((e) => e.id === id), false);
});

test("verified upsert allowed with present + clean artifacts", () => {
  const id = `vgate-clean-${Date.now()}`;
  const { vPath, sPath } = writeArtifacts(true, false);
  upsertRegistryEntry({
    id, fixture: "synthetic", runId: id, status: "verified",
    verificationPath: vPath, securityPath: sPath
  });
  assert.equal(readRegistry().find((e) => e.id === id)?.status, "verified");
});

test("non-verified statuses bypass the gate", () => {
  const id = `vgate-generated-${Date.now()}`;
  upsertRegistryEntry({ id, fixture: "synthetic", runId: id, status: "generated" });
  assert.equal(readRegistry().find((e) => e.id === id)?.status, "generated");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import=./tests/_setup.mjs --test tests/security/security-clean.test.mjs tests/registry/verified-gate.test.mjs`
Expected: FAIL — `isSecurityClean` not exported; `upsertRegistryEntry` does not yet refuse fake verified.

- [ ] **Step 3a: Add `isSecurityClean` to `scan-artifacts.mjs`**

Append to `scripts/security/scan-artifacts.mjs`:

```js
/**
 * Truthful "green" predicate. A scan is clean only when it passed AND was
 * not merely downgraded to warn-not-block under --unmasked. Use this for any
 * user-facing "green" claim and for the registry verified-gate — never read
 * raw `ok` as "green" (under --unmasked `ok` is true despite findings).
 * @param {{ ok?: boolean, warningOnly?: boolean } | undefined | null} security
 * @returns {boolean}
 */
export function isSecurityClean(security) {
  return !!security && security.ok === true && security.warningOnly !== true;
}
```

- [ ] **Step 3b: Registry verified-gate in `workflow-registry.mjs`**

Update imports at the top of `scripts/registry/workflow-registry.mjs`:

```js
import { closeSync, existsSync, openSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { getPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { isSecurityClean } from "../security/scan-artifacts.mjs";
```

Insert the gate inside `upsertRegistryEntry`, immediately after the existing `localOnly === false` block (after line 33, before `const { registryPath } = getPaths();`):

```js
  // verified-status gate (defense-in-depth). A "verified" entry must be
  // backed by a verification.json AND a security.json that both exist and a
  // security scan that is truly clean (not unmasked warning-only). This makes
  // it impossible for any caller — first-mode bootstrap, future code — to mint
  // a fake "verified" entry without real, green artifacts.
  if (entry.status === "verified") {
    const vPath = /** @type {string | undefined} */ (entry.verificationPath);
    const sPath = /** @type {string | undefined} */ (entry.securityPath);
    if (!vPath || !existsSync(vPath) || !sPath || !existsSync(sPath)) {
      throw new Error(
        `registry: refusing "verified" upsert for "${entry.id}" — both verification.json and security.json must exist.`
      );
    }
    const security = /** @type {{ ok?: boolean, warningOnly?: boolean }} */ (readJson(sPath));
    if (!isSecurityClean(security)) {
      throw new Error(
        `registry: refusing "verified" upsert for "${entry.id}" — security scan is not clean (ok=${security?.ok}, warningOnly=${security?.warningOnly}).`
      );
    }
  }
```

- [ ] **Step 3c: First-mode → `bootstrapped` + real scan in `verify-run.mjs`**

Replace the first-mode report+upsert block (lines 196–230) so it (a) runs a real `scanArtifacts`, (b) derives `securityOk` truthfully, (c) writes registry `status:"bootstrapped"`:

```js
      // Build a first-mode verification report (schema-compatible, no session value).
      const verifiedAt = new Date().toISOString();
      // Run a real security scan over the run artifacts — first mode no longer
      // claims green unconditionally.
      const firstScanOpts = { unmasked: workflowDoc.security?.localOnly === false };
      const firstSecurity = scanArtifacts(runPaths.runRoot, runPaths.securityPath, firstScanOpts);
      const firstModeReport = parseVerificationArtifact(
        {
          schemaVersion: SCHEMA_VERSIONS.verification,
          success: true,
          pathComplete: false,
          executedSteps: [],
          stepCount: 0,
          transitionChecks: [],
          securityOk: isSecurityClean(firstSecurity),
          verifiedAt,
          // First-mode metadata — bootstrap, NOT a verified replay.
          mode: "first",
          bootstrapped: loginPrecondition.sessionRef,
          note: "세션 저장됨 — --repeat로 재실행 (bootstrap only; not replay-verified)"
        },
        runPaths.verificationPath
      );
      writeJson(runPaths.verificationPath, firstModeReport);

      upsertRegistryEntry({
        id: runId,
        fixture: workflowDoc.fixture ?? "manual",
        runId,
        pathYamlPath: runPaths.pathYamlPath,
        recipeYamlPath: runPaths.recipeYamlPath,
        runnerPath: runPaths.runnerPath,
        verificationPath: runPaths.verificationPath,
        securityPath: runPaths.securityPath,
        // bootstrap is NOT verified — a human login was captured, but no
        // truthful replay + security gate has run.
        status: "bootstrapped",
        security: workflowDoc.security
      });

      return { ok: true, report: firstModeReport };
```

Add `isSecurityClean` to the verify-run import from scan-artifacts (line 19):

```js
import { scanArtifacts, isSecurityClean } from "../security/scan-artifacts.mjs";
```

- [ ] **Step 3d: Main path — report `securityOk` from clean, not raw `ok`**

In `verify-run.mjs`, the main flow sets `securityOk: security.ok` twice (lines ~372 and ~382) and computes `const ok = Boolean(report.success) && security.ok` (line 386). Change the two report writes to use the truthful predicate, and keep pipeline-proceed semantics on `security.ok`:

Replace both `securityOk: security.ok,` occurrences (inside the `parseVerificationArtifact({ …finalReport, securityOk: … })` calls at lines ~372 and ~382) with:

```js
      securityOk: isSecurityClean(security),
```

Leave line 386 as `const ok = Boolean(report.success) && security.ok;` — under masked runs `ok === clean`; under unmasked, `security.ok` allows the dev-diagnostic pipeline to proceed but `securityOk` in the report is now honest, and the registry localOnly-gate + verified-gate still block any unmasked/suppressed entry from becoming `verified`.

- [ ] **Step 3e: Retarget the dedup/concurrency tests off the `verified` sentinel**

In `tests/registry/lock.test.mjs`, the `"verified"` literal is just an arbitrary status for concurrency + in-place-replace assertions. Retarget to `"failed"` (a non-gated status) to preserve intent without fabricating artifacts:
- line 34: `spawnWriter([idB, "verified", "0"])` → `spawnWriter([idB, "failed", "0"])`
- line 40: `…entry.status === "verified"…` → `…entry.status === "failed"…`
- lines 52–57: the second `upsertRegistryEntry({ … status: "verified" })` → `status: "failed"`
- line 61: `assert.equal(entry?.status, "verified")` → `assert.equal(entry?.status, "failed")`

- [ ] **Step 3f: Extend the first-mode auth test**

In `tests/verify/auth-modes.test.mjs`, the first-mode test currently asserts a verified-ish bootstrap. Add assertions that first mode does NOT create a `verified` registry entry and that the report is labelled bootstrap. After the existing first-mode `verifyRun(..., { mode: "first", … })` call and its assertions, add:

```js
  // first mode is a bootstrap, never a verified replay
  const fmEntry = readRegistry().find((e) => e.id === runId);
  assert.equal(fmEntry?.status, "bootstrapped", "first mode must register as bootstrapped, not verified");
  assert.notEqual(fmEntry?.status, "verified");
```

Ensure `readRegistry` is imported in that test file (`import { readRegistry } from "../../scripts/registry/workflow-registry.mjs";`) and `runId` is in scope (use the test's existing run id variable name — read the file to match it exactly).

- [ ] **Step 4: Run the Phase-2 truthfulness tests**

Run: `node --import=./tests/_setup.mjs --test tests/security/security-clean.test.mjs tests/registry/verified-gate.test.mjs tests/registry/lock.test.mjs tests/verify/auth-modes.test.mjs tests/security/sanitizer.test.mjs`
Expected: PASS. (`sanitizer.test.mjs` still asserts `scanArtifacts(... {unmasked:true}).ok === true` and `.warningOnly === true` — both unchanged; we only *added* `isSecurityClean` and changed how the *report* reads it.)

- [ ] **Step 5: Commit**

```bash
git add scripts/security/scan-artifacts.mjs scripts/verify/verify-run.mjs \
        scripts/registry/workflow-registry.mjs tests/security/security-clean.test.mjs \
        tests/registry/verified-gate.test.mjs tests/registry/lock.test.mjs tests/verify/auth-modes.test.mjs
git commit -m "fix(verify): bootstrap≠verified, honest unmasked securityOk, registry verified-gate"
```

---

### Task 2.4: Phase-2 regression gate

- [ ] **Step 1: lint** — Run: `node scripts/lint.mjs` → exit 0.
- [ ] **Step 2: full suite** — Run: `npm test 2>&1 | tail -8`. Expected: only the pre-existing `verify-breadth-enrichment` real-Chrome flake may fail. Any other regression → STOP and root-cause (likely a test that minted `verified` without artifacts; fix that test's setup, not the gate).
- [ ] **Step 3: typecheck** — Run: `npm run typecheck` → exit 0 (JSDoc types only).

### Phase 2 Backlog
- **[B2-a]** `verify-run.mjs` writes `verification.json` + scans three times in the main path (lines 362–385, a pre-existing redundancy). Tidying to a single scan would be cleaner but is behavior-neutral and out of scope.
- **[B2-b]** A `bootstrapped` status now exists in the registry. Consumers (`doctor`, registry readers) may want to display it distinctly. No current consumer misreads it (they match on `"verified"`).
- **[B2-c]** `--unmasked` is surfaced in `verification.json` only implicitly (via `securityOk:false` + `warningOnly`). A dedicated `diagnosticMode:true` field in the report would make the dev-mode explicit per spec 2-3 ("developer diagnostic mode임을 명확히 표시").

### Phase 2 End-of-Phase Regression Self-Review
- B2-a: NO — redundant-but-correct; refactoring risks the verify path for zero behavior gain. Defer.
- B2-b: NO — no consumer is broken; additive display is cosmetic. Defer.
- B2-c: **MAYBE — this is the one with a spec hook.** Spec 2-3 explicitly asks unmasked be *clearly marked* as developer-diagnostic. `securityOk:false`+`warningOnly` is honest but indirect. **Decision: do it now, minimally** — it's a 2-line additive-optional field (schema is `.passthrough()`, no schema edit) and directly closes criterion #4's "looks green" intent at the report surface. Add as Task 2.5 below.

---

### Task 2.5 (promoted from backlog B2-c): explicit diagnostic-mode flag

**Files:**
- Modify: `scripts/verify/verify-run.mjs` (main path final report + first-mode report)
- Test: `tests/verify/verify-run.test.mjs` (add one assertion)

- [ ] **Step 1: Write the failing assertion**

Add to `tests/verify/verify-run.test.mjs` (inside a new `test(...)`), using the file's existing helpers to run an unmasked verify and read `verification.json`:

```js
test("unmasked verify marks the report as developer-diagnostic and not green", async () => {
  // (Arrange an unmasked workflow with a planted finding using this file's
  // existing fixture helpers — mirror the setup of the sibling sanitize test.)
  // After verifyRun(runId, { headless: true }):
  const report = readJson(getRunPaths(runId).verificationPath);
  assert.equal(report.diagnosticMode, true);
  assert.equal(report.securityOk, false);
});
```

(If wiring a full unmasked verify in this file is heavy, place the assertion in `tests/security/sanitizer.test.mjs` next to the existing unmasked scan test instead — read both files and choose the lighter host.)

- [ ] **Step 2: Run → FAIL** (`diagnosticMode` undefined).

- [ ] **Step 3: Emit `diagnosticMode`**

In `verify-run.mjs`, where the final report object is assembled in the main path, add `diagnosticMode: workflowUnmasked` to the parsed object; in the first-mode report add `diagnosticMode: firstScanOpts.unmasked`. Both schemas are `.passthrough()`, so no schema change.

- [ ] **Step 4: Run → PASS**; then `node --import=./tests/_setup.mjs --test tests/verify/ tests/security/`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify/verify-run.mjs tests/verify/verify-run.test.mjs
git commit -m "feat(verify): flag diagnosticMode in report under --unmasked"
```

---

# Lane B · Release Hygiene  (parallel-safe with Lanes A & C)

## Phase 3 — Release Bundle Shipping Hygiene

The builder already exists and is allowlist+leak-safe. Phase 3 = **lock the guarantees with tests** + name `.pii-identities` explicitly.

### Todo (work → expected result)

| # | Work | Expected result |
|---|---|---|
| 3.1 | Add `.pii-identities` to `bundle-gitignore` and `SKIP_*`-equivalent reasoning | personal identity file can never appear in a release surface |
| 3.2 | Add shipping-surface exclusion/inclusion tests (`.git`, `node_modules`, `artifacts`, `profiles`, `.claude`, `.pii-identities` absent; core files present) | release surface is test-locked |
| 3.3 | lint + publish tests green | criterion #5 verifiable |

---

### Task 3.1: Name `.pii-identities` in the bundle ignore

**Files:**
- Modify: `scripts/publish/bundle-gitignore`

- [ ] **Step 1: Read current content**

Run: `cat scripts/publish/bundle-gitignore`
Expected: 8 lines (`node_modules/`, `.DS_Store`, `artifacts/`, `coverage/`, `*.log`, `profiles/`, `_temp/`, `.claude/`).

- [ ] **Step 2: Append `.pii-identities`**

Add a line `.pii-identities` to `scripts/publish/bundle-gitignore`. (It is already excluded in practice — the allowlist never lists it and `assertNoLeak` would fail on it — but naming it documents intent for the released repo's `.gitignore`.)

- [ ] **Step 3: Commit**

```bash
git add scripts/publish/bundle-gitignore
git commit -m "build(publish): name .pii-identities in bundle gitignore"
```

---

### Task 3.2: Lock the shipping surface with exclusion/inclusion tests

**Files:**
- Modify: `tests/publish/shipping-surface.test.mjs` (append tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/publish/shipping-surface.test.mjs`:

```js
test("shipping surface excludes runtime/dev/secret dirs and files", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  const forbidden = [".git/", "node_modules/", "artifacts/", "profiles/", ".claude/", "coverage/", "_temp/"];
  for (const prefix of forbidden) {
    assert.ok(!files.some((f) => f === prefix.slice(0, -1) || f.startsWith(prefix)),
      `no file under ${prefix}`);
  }
  assert.ok(!files.some((f) => f === ".pii-identities" || f.endsWith("/.pii-identities")),
    ".pii-identities never shipped");
  assert.ok(!files.some((f) => f.endsWith(".DS_Store")), "OS junk never shipped");
});

test("shipping surface contains the expected core project files", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  for (const required of [
    "scripts/cli.mjs", "package.json", "package-lock.json", "tsconfig.json",
    "AGENTS.md", "CLAUDE.md", "README.md"
  ]) {
    assert.ok(files.includes(required), `must ship ${required}`);
  }
  assert.ok(files.some((f) => f.startsWith("scripts/security/")), "ships security gates");
  assert.ok(files.some((f) => f.startsWith(".codex/skills/browser-flow/")), "ships public skill");
});
```

- [ ] **Step 2: Run → expect PASS already** (the builder is correct; these tests *lock* it).

Run: `node --import=./tests/_setup.mjs --test tests/publish/shipping-surface.test.mjs`
Expected: PASS. If any forbidden-prefix assertion FAILS, that is a real leak — STOP and fix the allowlist/exclude, not the test.

> Note: this is a "characterization + guard" test, not red→green TDD, because the implementation is pre-existing and correct. The value is regression-locking criterion #5.

- [ ] **Step 3: (optional) Verify the real build produces a clean surface**

Run: `node scripts/publish/build-bundle.mjs && cat ../browser-flow-released/.bundle-stamp.json`
Expected: `build-bundle OK → ../browser-flow-released/ (N files)`; no `LEAK` lines. (This writes to the sibling release dir — acceptable; it is outside the repo and gitignored.)

- [ ] **Step 4: Commit**

```bash
git add tests/publish/shipping-surface.test.mjs
git commit -m "test(publish): lock bundle exclusion (.git/node_modules/artifacts/profiles/.claude/.pii-identities) + core inclusion"
```

### Phase 3 Backlog
- **[B3-a]** `build-bundle.mjs` copies into a fixed sibling dir; it does not emit a tar/zip. The spec offered tar/zip *or* the repo-natural format — dir-copy is the established repo style (commit `9158589`). No change.
- **[B3-b]** No test executes `build-bundle.mjs` end-to-end and asserts on the produced *directory* (only on `resolveShippingFiles`). `assertNoLeak` already enforces this at build time; a test that shells out is slower and redundant.

### Phase 3 End-of-Phase Regression Self-Review
- B3-a: NO — dir-copy is intentional repo convention; adding archive packaging is scope creep. Defer.
- B3-b: NO — `assertNoLeak` is the runtime guarantee and `resolveShippingFiles` is unit-locked; an e2e shell test adds flake for no new invariant. Defer. **Criterion #5 is met by Task 3.2.**

---

# Lane C · Claim Integrity  (parallel-safe with Lanes A & B)

## Phase 4 — CLI/Doc Claim Repair + Minimal README Quickstart

Scope-limited: fix demonstrably false claims and add a quickstart. **NOT** a doc rewrite. (Audit claim C showed marketing exaggeration is largely absent — keep 4.4 light.)

### Todo (work → expected result)

| # | Work | Expected result |
|---|---|---|
| 4.1 | CLI help: "Playwright runner" → "CDP-direct runner" | `bf help` matches runtime |
| 4.2 | Label `docs/baseline/runner-synthetic.mjs` as historical pre-CDP snapshot | exhibit no longer contradicts CDP-direct claim |
| 4.3 | Replace hand-typed test counts with "see `npm run check`" | no stale numeric claim in shipped docs |
| 4.4 | Tone the one ambiguous "production-ready" reference | no over-claim about browser-flow itself |
| 4.5 | README: add Quickstart + local-only warning + honest status | new user can run the synthetic demo |
| 4.6 | Stale-claim grep + lint | criteria #6/#7/#8 verifiable |

---

### Task 4.1: CLI help reflects CDP-direct runtime

**Files:** Modify `scripts/cli.mjs:37`

- [ ] **Step 1:** Change the help line
  - from: `  generate  Generate a runnable Playwright runner and registry entry`
  - to:   `  generate  Generate a runnable CDP-direct runner and registry entry`
- [ ] **Step 2: Verify** — Run: `node scripts/cli.mjs help | grep generate` → shows "CDP-direct runner".
- [ ] **Step 3: Commit**

```bash
git add scripts/cli.mjs
git commit -m "docs(cli): help describes the CDP-direct runner (was 'Playwright runner')"
```

---

### Task 4.2: Label the historical baseline exhibit

**Files:** Modify the header comment of `docs/baseline/runner-synthetic.mjs` (lines 1–8)

- [ ] **Step 1:** Read the current header (lines 1–8) to match wording.
- [ ] **Step 2:** Strengthen the existing "frozen reference" note to an unambiguous historical label. Prepend:

```js
// ⚠️ HISTORICAL — PRE-CDP SNAPSHOT (2026-05-19). This exhibit predates the
// CDP-direct migration and uses Playwright on purpose; it is NOT the current
// generator output and is NOT executable as committed. For the current
// runner shape see scripts/generate/generate-runner.mjs (emits a CDP-direct
// runner — no playwright import) or any artifacts/runs/<id>/generated/runner.mjs.
```

- [ ] **Step 3: Commit**

```bash
git add docs/baseline/runner-synthetic.mjs
git commit -m "docs(baseline): label runner exhibit as historical pre-CDP snapshot"
```

> Decision: Option B (re-label) over Option A (regenerate). Regenerating requires a live capture run; the frozen exhibit's value is the *baseline comparison*, which is inherently a point-in-time artifact. Re-labelling removes the contradiction at zero regression risk.

---

### Task 4.3: Remove hand-typed test counts from shipped docs

**Files:** `docs/architecture.md:109`, `docs/baseline-comparison.md:15`, `docs/roadmap.md:121` (roadmap is dev-only/not shipped — fix anyway for honesty)

- [ ] **Step 1:** `docs/architecture.md:109` — replace `- 50 tests passing.` with:
  `- Test suite is the single source of truth — run \`npm run check\` (lint + typecheck + skill-validate + pii/provenance scans + \`npm test\`).`
- [ ] **Step 2:** `docs/baseline-comparison.md:15` — replace `The pipeline has 76 internal tests, a trace-grading eval, a` with:
  `The pipeline has an internal test suite (see \`npm run check\`), a trace-grading eval, a`
- [ ] **Step 3:** `docs/roadmap.md:121` — replace `Confirmed working (77/77 tests, governance gates clear):` with:
  `Confirmed working (full suite green via \`npm run check\`, governance gates clear):`
- [ ] **Step 4: Verify no hand-typed counts remain in shipped docs**

Run: `grep -rnE "[0-9]+ ?(/ ?[0-9]+)? (internal )?tests|tests passing" docs/architecture.md docs/baseline-comparison.md docs/ENGINEERING-LOG.md README.md`
Expected: no stale absolute counts (the `~550` in ENGINEERING-LOG is acceptable as an approximate historical note; convert if it reads as current — see Step 5).

- [ ] **Step 5:** `docs/ENGINEERING-LOG.md:12` — if "~550 tests" reads as a *current* claim, change to "a large `node:test` suite (see `npm run check`)"; if clearly historical, leave with a date qualifier.
- [ ] **Step 6: Commit**

```bash
git add docs/architecture.md docs/baseline-comparison.md docs/roadmap.md docs/ENGINEERING-LOG.md
git commit -m "docs: replace hand-typed test counts with 'see npm run check' as single source of truth"
```

---

### Task 4.4: Tone the one ambiguous over-claim

**Files:** `docs/patterns-applied.md:4`

- [ ] **Step 1:** Read line 4. It says external confirmed patterns are "(paper-backed, quality-gated, production-ready)". Disambiguate so it can't be read as browser-flow being production-ready:
  - change `production-ready` → `production-grade in their source projects` (the phrase describes the *external* patterns' origin, not this prototype).
- [ ] **Step 2: Verify no over-claims about browser-flow itself**

Run: `grep -rniE "production-ready|battle-tested|fully (secure|solved)|autonomous browser agent|AI browser agent|beats (playwright|stagehand|skyvern|browser ?use)" README.md AGENTS.md docs/ .codex/skills/browser-flow/`
Expected: no hits referring to browser-flow. (Audit confirmed these are essentially absent already.)

- [ ] **Step 3: Commit**

```bash
git add docs/patterns-applied.md
git commit -m "docs: disambiguate 'production-ready' (external patterns, not this prototype)"
```

---

### Task 4.5: README minimal quickstart + local-only warning + honest status

**Files:** `README.md` (insert a Quickstart section after line 8; tighten Status at line 10)

- [ ] **Step 1: Insert Quickstart** (after the intro paragraph, before `## Status`):

```markdown
## Quickstart (synthetic demo, local-only)

> ⚠️ **Local-only.** Capture targets must resolve to localhost/127.0.0.1 —
> this is enforced in code (`scripts/security/local-only.mjs`). Do not point
> it at remote sites.

```bash
npm install            # Node ≥ 20, Chrome installed (override path: BROWSER_FLOW_CHROME_PATH)
alias bf="node scripts/cli.mjs"

bf prepare  --run-id demo --fixture synthetic   # opens an isolated Chrome debug profile
# …perform the demonstrated clicks in that Chrome window…
bf done     --run-id demo                        # persist sanitized artifacts
bf analyze  --run-id demo                        # → analysis/path.yaml + recipe.yaml
bf generate --run-id demo                        # → generated/runner.mjs (CDP-direct)
bf verify   --run-id demo --headless             # replay + security gates
```

**Expected artifacts** under `artifacts/runs/demo/`:
`analysis/{path.yaml,recipe.yaml}`, `generated/runner.mjs`,
`reports/{verification.json,security.json}`. A run is registered `verified`
in `knowledge/registry/workflows.json` only when replay succeeds **and** the
security scan is clean.

Run the test suite / all gates: `npm run check`.
```

- [ ] **Step 2: Tighten Status** — replace the `## Status` body (lines 12–17) so it leads with an honest maturity line:

```markdown
**Status: prototype under active security hardening** — local-only by design;
not production software. See `docs/ENGINEERING-LOG.md` for the honest
limitation log and `docs/baseline-comparison.md` for the comparison against
`npx playwright codegen`.
```

- [ ] **Step 3: Verify** — Run: `grep -nE "Quickstart|Local-only|prototype" README.md` → all three present.
- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): add local-only quickstart, expected artifacts, honest prototype status"
```

### Phase 4 Backlog
- **[B4-a]** `README.md` "Development Journey" claims "~108 phases / 10 epochs" — narrative, not a falsifiable claim; leave.
- **[B4-b]** `docs/roadmap.md` "Current state (post-Phase 34)" header is stale (project is far past Phase 34). Roadmap is dev-only (not shipped). Out of scope (large doc-history edit).
- **[B4-c]** A `bf --help`/CLI snapshot test would lock help-vs-runtime drift. None exists today.

### Phase 4 End-of-Phase Regression Self-Review
- B4-a: NO — narrative, not a false technical claim. Defer.
- B4-b: NO — not shipped; fixing it is doc-history churn outside this goal's "minimal repair" mandate. Defer.
- B4-c: NO — nice-to-have regression guard, but Task 4.1 already corrected the one drift and criterion #6 is met by grep. A snapshot test is future hardening. Defer to Remaining Work.

---

## Phase 5 — Final Verification & Report (CONVERGE)

Runs after Lanes A+B+C are merged into `hardening/public-readiness`.

### Todo (work → expected result)

| # | Work | Expected result |
|---|---|---|
| 5.1 | `git diff --stat` review | change set matches plan; no stray files |
| 5.2 | `node scripts/lint.mjs` | exit 0 (criterion #9) |
| 5.3 | `npm run check` | green except — at most — the pre-existing real-Chrome e2e flake, reported honestly (criterion #10, see honesty rule) |
| 5.4 | targeted re-run of all new security/path/registry/publish tests | all green |
| 5.5 | `bf help` + `build-bundle` smoke | help matches runtime; bundle clean |
| 5.6 | Write the Phase Summary report | all 10 success criteria mapped to evidence |

- [ ] **Step 1:** `git diff --stat main...HEAD`
- [ ] **Step 2:** `node scripts/lint.mjs` → exit 0.
- [ ] **Step 3:** `npm run check`.
  - **Honest pass condition (criterion #10):** lint + typecheck + validate-skill + pii-scan + no-provenance all pass, AND any residual `npm test` failures are **real-Chrome tests** (e.g. `verify-breadth-enrichment`, `cdp/browser-session`, `cdp/watchdogs/*`) that **PASS on isolated re-run** — confirming an environmental/timing flake, not a regression. Re-run the specific failed file(s) in isolation, e.g.:
    `node --import=./tests/_setup.mjs --test <failed-file.mjs>`
    If they pass in isolation, report green-with-noted-flake. If a **non-Chrome** test fails, or a Chrome test fails *even in isolation*, criterion #10 is NOT met — fix before declaring done. **Never edit/delete/skip a test to force green.**
- [ ] **Step 4:** Re-run the delta:
  `node --import=./tests/_setup.mjs --test tests/lib/path-safety.test.mjs tests/lib/page-key-safety.test.mjs tests/cdp/browser-args.test.mjs tests/security/security-clean.test.mjs tests/registry/verified-gate.test.mjs tests/registry/lock.test.mjs tests/verify/auth-modes.test.mjs tests/publish/shipping-surface.test.mjs`
  Expected: all PASS.
- [ ] **Step 5:** `node scripts/cli.mjs help | grep -i runner` (→ CDP-direct) and `node scripts/publish/build-bundle.mjs` (→ OK, no LEAK).
- [ ] **Step 6:** Produce the report in the format the user specified (Phase Summary / Files Changed / Security Invariants Now Enforced / Tests Added / Remaining Work / Release Readiness Verdict).
- [ ] **Step 7 (finish):** Use `superpowers:finishing-a-development-branch` to choose merge / PR / cleanup. Update `tasks/lessons.md` (append-only) with any misinterpretation/execution lessons; mark `.claude/context.md` STATUS: DONE and check the `.claude/tasks.md` entry.

### Phase 5 backlog regression self-review
At convergence, re-scan all deferred backlog items (B1-c, B2-a/b, B3-a/b, B4-a/b/c). Promote to "do now" only if a deferred item leaves one of the 10 success criteria unmet. Expected outcome given the design: none are blocking (each criterion is met by a shipped task) → all stay in Remaining Work.

---

## Success-Criteria → Task Traceability

| # | Criterion | Met by |
|---|---|---|
| 1 | runId/pageKey/scraping traversal blocked | Tasks 1.1, 1.2 |
| 2 | CDP endpoint loopback-bound | Task 2.1 |
| 3 | no verified without verification+security artifacts | Tasks 2.2, 2.3 (registry gate) |
| 4 | `--unmasked` not green | Tasks 2.3, 2.5 |
| 5 | bundle excludes .git/node_modules/artifacts/profiles/.claude/.pii-identities | Tasks 3.1, 3.2 |
| 6 | no CLI/help/doc claim conflicts | Tasks 4.1, 4.4 |
| 7 | README quickstart + honest status | Task 4.5 |
| 8 | no "AI agent / production-ready / beats X" over-claims | Task 4.4 (mostly already true) |
| 9 | `node scripts/lint.mjs` passes | Tasks 1.3, 2.4, 5.2 |
| 10 | `npm run check` passes | Phase 5 Step 3 (honest condition re: pre-existing e2e flake) |

## Remaining Work (explicitly OUT of scope this goal)
- generated runner template large refactor; TypeScript migration; agent/skill markdown redesign
- real-site benchmarks; Stagehand/Skyvern/Browser-Use full comparison; portfolio narrative; large README redesign
- capture-timing flake hardening (incl. fixing `verify-breadth-enrichment` e2e robustly)
- deferred backlog: B1-c (lint caller-graph rule), B2-a (single-scan tidy), B2-b (bootstrapped display), B3-a/b (archive packaging / build e2e test), B4-b (roadmap history refresh), B4-c (help snapshot test)
```
