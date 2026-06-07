# Distribution P1 — Deployable State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach a state where the repo can build a clean, standalone public bundle into `dist/`, with the dev-process coupling removed and a PII hard gate enforced.

**Architecture:** Remove the Phase-22 governance gate (the only dev-only-dir dependency) from `validate-skill.mjs`; define the shipping surface as an allowlist manifest; add a `pii-scan` hard gate over that surface wired into `npm run check`; redact the one real-PII hit; sweep untracked legacy cruft; add a `build-bundle.mjs` that does a dumb allowlist copy into `dist/` with a no-leak check.

**Tech Stack:** Node ESM (`.mjs`), `node:test`, `node:fs`, existing `scripts/security/` + `scripts/lib/` conventions. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-24-publish-bundle-design.md` (Components 1③, 2 pii-scan, 3 redact+sweep, 4 bundle).

**Scope note / refinement of the spec:** The spec listed "② triage" under P1. This plan **defers ② (behavioral-guard triage) to P3**, merging it with the tests audit — they are the same concern ("what in our test surface is substance vs history"), and ② is *not* required for deployability (the ② guards grep `scripts/`, which ships, so they do not break the bundle). P1 does only ③ removal. This was flagged to the user at handoff.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `.codex/skills/browser-flow/scripts/validate-skill.mjs` | skill-bundle validator | remove ③ governance gate (L482–551) + unused `readdirSync` import |
| `.governance/state.json`, `.governance/` | dev governance schedule state | delete |
| `scripts/publish/bundle-allowlist.json` | declarative shipping-surface allowlist (data) | create |
| `scripts/lib/shipping-surface.mjs` | resolve manifest → concrete file list (shared by pii-scan + build) | create |
| `scripts/security/pii-scan.mjs` | PII hard gate over the shipping surface | create |
| `tests/security/pii-scan.test.mjs` | unit tests for `findPii` | create |
| `tests/publish/shipping-surface.test.mjs` | unit tests for `resolveShippingFiles` | create |
| `package.json` | add `pii-scan` script + chain into `check` | modify |
| `docs/baseline/runner-synthetic.mjs:189` | redact real home path | modify |
| `scripts/publish/build-bundle.mjs` | dumb allowlist copy → `dist/` + no-leak check | create |
| `scripts/publish/bundle-gitignore` | template `.gitignore` for the bundle | create |
| `.gitignore` (repo root) | add `dist/` | modify |
| `knowledge/pages/`, `_temp/` | untracked legacy cruft | delete |

---

## Task 1: Remove the Phase-22 governance gate (③) from validate-skill

**Files:**
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs:3` (import) and `:482-551` (gate)
- Delete: `.governance/state.json` and the `.governance/` directory

- [ ] **Step 1: Confirm the gate currently passes (baseline)**

Run: `node .codex/skills/browser-flow/scripts/validate-skill.mjs`
Expected: `browser-flow skill validated`

- [ ] **Step 2: Remove the governance gate block**

Delete lines 482–551 (the entire `// Phase 22: governance schedule hard gate` block, from the comment through the `evalDelta` throw), leaving the final success write. After the edit, the tail of the file must read exactly:

```js
  );
}

process.stdout.write("browser-flow skill validated\n");
```

(The `);}` shown is the close of the Phase-54 block immediately preceding the removed gate — do not delete that block.)

- [ ] **Step 3: Remove the now-unused `readdirSync` import**

`readdirSync` was used only by the removed gate. Change line 3 from:

```js
import { existsSync, readFileSync, readdirSync } from "node:fs";
```

to:

```js
import { existsSync, readFileSync } from "node:fs";
```

(Keep `existsSync` and `readFileSync` — both are used by surviving checks.)

- [ ] **Step 4: Delete the governance state dir**

Run: `git rm -r .governance && rmdir .governance 2>/dev/null; ls .governance 2>/dev/null || echo "removed"`
Expected: `removed`

- [ ] **Step 5: Verify validator still passes and reads no dev-only dirs**

Run: `node .codex/skills/browser-flow/scripts/validate-skill.mjs && grep -c 'governance\|tasks/phases' .codex/skills/browser-flow/scripts/validate-skill.mjs`
Expected: `browser-flow skill validated` then `0`

- [ ] **Step 6: Typecheck (unused-import regression guard)**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add .codex/skills/browser-flow/scripts/validate-skill.mjs .governance
git commit -m "refactor(validate-skill): remove Phase-22 dev-process gate + .governance (decouple validator from dev dirs)"
```

---

## Task 2: Shipping-surface allowlist manifest + resolver

**Files:**
- Create: `scripts/publish/bundle-allowlist.json`
- Create: `scripts/lib/shipping-surface.mjs`
- Test: `tests/publish/shipping-surface.test.mjs`

- [ ] **Step 1: Create the allowlist manifest**

`scripts/publish/bundle-allowlist.json`:

```json
{
  "include": [
    ".codex/skills",
    "scripts",
    "knowledge",
    "tests",
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    ".husky/pre-push",
    "docs/architecture.md",
    "docs/patterns-applied.md",
    "docs/research-applied.md",
    "docs/baseline-comparison.md",
    "docs/capture-semantics.md",
    "docs/ENGINEERING-LOG.md",
    "docs/baseline"
  ],
  "exclude": [
    "scripts/publish"
  ]
}
```

- [ ] **Step 2: Write the failing resolver test**

`tests/publish/shipping-surface.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShippingFiles } from "../../scripts/lib/shipping-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = resolve(repoRoot, "scripts/publish/bundle-allowlist.json");

test("resolves manifest into concrete files", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  assert.ok(files.includes("scripts/cli.mjs"), "includes a known script");
  assert.ok(files.includes("AGENTS.md"), "includes a top-level file");
  assert.ok(files.some((f) => f.startsWith(".codex/skills/")), "includes skills");
});

test("honors excludes (scripts/publish is not shipped)", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  assert.ok(!files.some((f) => f.startsWith("scripts/publish/")), "publish dir excluded");
});

test("excludes dev-only dirs by omission", () => {
  const files = resolveShippingFiles(repoRoot, manifest);
  assert.ok(!files.some((f) => f.startsWith("tasks/")), "tasks not shipped");
  assert.ok(!files.some((f) => f.startsWith("docs/superpowers/")), "superpowers not shipped");
  assert.ok(!files.includes("docs/roadmap.md"), "roadmap not shipped");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/publish/shipping-surface.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/lib/shipping-surface.mjs'`

- [ ] **Step 4: Implement the resolver**

`scripts/lib/shipping-surface.mjs`:

```js
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve a bundle-allowlist manifest into a sorted list of repo-relative file paths.
 * @param {string} repoRoot absolute repo root
 * @param {string} manifestPath absolute path to bundle-allowlist.json
 * @returns {string[]} repo-relative file paths (POSIX separators), sorted
 */
export function resolveShippingFiles(repoRoot, manifestPath) {
  /** @type {{ include: string[], exclude?: string[] }} */
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const exclude = manifest.exclude ?? [];
  const isExcluded = (rel) => exclude.some((ex) => rel === ex || rel.startsWith(ex + "/"));

  /** @type {string[]} */
  const out = [];
  const walk = (rel) => {
    if (isExcluded(rel)) return;
    const abs = resolve(repoRoot, rel);
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        walk(rel ? `${rel}/${name}` : name);
      }
    } else {
      out.push(rel);
    }
  };
  for (const entry of manifest.include) walk(entry);
  return out.sort();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/publish/shipping-surface.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/publish/bundle-allowlist.json scripts/lib/shipping-surface.mjs tests/publish/shipping-surface.test.mjs
git commit -m "feat(publish): shipping-surface allowlist manifest + resolver"
```

---

## Task 3: PII hard gate

**Files:**
- Create: `scripts/security/pii-scan.mjs`
- Test: `tests/security/pii-scan.test.mjs`

- [ ] **Step 1: Write the failing test for `findPii`**

`tests/security/pii-scan.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findPii } from "../../scripts/security/pii-scan.mjs";

test("flags a real home path", () => {
  const hits = findPii("const p = '/Users/cielo-iamdt/projects/x';");
  assert.ok(hits.some((h) => h.type === "home-path"), "home-path detected");
});

test("flags a known identity", () => {
  assert.ok(findPii("author mwroh").some((h) => h.type === "identity"));
});

test("flags a real email", () => {
  assert.ok(findPii("me@real-domain.io").some((h) => h.type === "email"));
});

test("allows synthetic fixtures", () => {
  assert.deepEqual(findPii("/Users/x/file.pdf and x@y.com and someone@example.com"), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/security/pii-scan.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/security/pii-scan.mjs'`

- [ ] **Step 3: Implement the scanner**

`scripts/security/pii-scan.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShippingFiles } from "../lib/shipping-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = resolve(repoRoot, "scripts/publish/bundle-allowlist.json");

const TEXT_EXT = /\.(mjs|js|cjs|ts|json|md|ya?ml|txt|html|css)$/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_WHITELIST = /@(example\.(com|org|net)|test\.(com|local)|y\.com)$/i;
const HOME_PATH_RE = /\/(?:Users|home)\/([A-Za-z0-9][\w.-]*)\//g;
const HOME_NAME_WHITELIST = new Set(["x", "user", "username", "you", "me", "name", "runner", "ci"]);
const IDENTITY_RE = /\b(cielo-iamdt|mwroh)\b/g;

/**
 * @param {string} content
 * @returns {{type: string, value: string}[]}
 */
export function findPii(content) {
  /** @type {{type: string, value: string}[]} */
  const hits = [];
  for (const m of content.matchAll(EMAIL_RE)) {
    if (!EMAIL_WHITELIST.test(m[0])) hits.push({ type: "email", value: m[0] });
  }
  for (const m of content.matchAll(HOME_PATH_RE)) {
    if (!HOME_NAME_WHITELIST.has(m[1])) hits.push({ type: "home-path", value: m[0] });
  }
  for (const m of content.matchAll(IDENTITY_RE)) {
    hits.push({ type: "identity", value: m[0] });
  }
  return hits;
}

function main() {
  const selfPaths = new Set([
    "scripts/security/pii-scan.mjs",
    "tests/security/pii-scan.test.mjs"
  ]);
  const files = resolveShippingFiles(repoRoot, manifestPath)
    .filter((f) => TEXT_EXT.test(f) && !selfPaths.has(f));
  /** @type {{rel: string, type: string, value: string}[]} */
  const findings = [];
  for (const rel of files) {
    const content = readFileSync(resolve(repoRoot, rel), "utf8");
    for (const hit of findPii(content)) findings.push({ rel, ...hit });
  }
  if (findings.length > 0) {
    for (const f of findings) process.stderr.write(`PII ${f.rel} [${f.type}] ${f.value}\n`);
    process.stderr.write(`\npii-scan FAILED: ${findings.length} finding(s) in shipping surface.\n`);
    process.exit(1);
  }
  process.stdout.write(`pii-scan OK (${files.length} files)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/security/pii-scan.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the scanner against the live shipping surface (expect ONE finding)**

Run: `node scripts/security/pii-scan.mjs`
Expected: FAIL with exactly one finding referencing `docs/baseline/runner-synthetic.mjs` (`/Users/cielo-iamdt/...` home-path + identity). If MORE than that one file appears, stop and report — the allowlist or whitelist needs adjustment before proceeding.

- [ ] **Step 6: Commit (gate code, not yet green on repo)**

```bash
git add scripts/security/pii-scan.mjs tests/security/pii-scan.test.mjs
git commit -m "feat(security): pii-scan hard gate over the shipping surface"
```

---

## Task 4: Redact the PII hit; turn the gate green; wire into `npm run check`

**Files:**
- Modify: `docs/baseline/runner-synthetic.mjs:189`
- Modify: `package.json`

- [ ] **Step 1: Redact the home path in the frozen baseline**

In `docs/baseline/runner-synthetic.mjs:189`, replace the absolute path. Change:

```js
  const reportPath = options.reportPath ?? "/Users/cielo-iamdt/projects/browser-flow/artifacts/runs/full-synth-1779124975469/reports/verification.json";
```

to:

```js
  const reportPath = options.reportPath ?? "/path/to/repo/artifacts/runs/full-synth-1779124975469/reports/verification.json";
```

(The path is irrelevant to baseline-comparison integrity, which depends on the runner body. Leave the surrounding comment that explains the hard-coding.)

- [ ] **Step 2: Run the scanner — now green**

Run: `node scripts/security/pii-scan.mjs`
Expected: `pii-scan OK (<N> files)`

- [ ] **Step 3: Add the `pii-scan` script and chain it into `check`**

In `package.json` `scripts`, add a `pii-scan` entry and insert it into `check`:

```json
    "pii-scan": "node scripts/security/pii-scan.mjs",
    "check": "npm run lint && npm run typecheck && npm run validate-skill && npm run pii-scan && npm test",
```

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: lint, typecheck, validate-skill, `pii-scan OK`, and the full test suite all pass.

- [ ] **Step 5: Commit**

```bash
git add docs/baseline/runner-synthetic.mjs package.json
git commit -m "fix(baseline): redact host path + wire pii-scan into npm run check"
```

---

## Task 5: Legacy sweep (untracked cruft)

**Files:**
- Delete: `knowledge/pages/` (untracked google manual captures), `_temp/` (untracked quarantine backup)

- [ ] **Step 1: Confirm both are untracked (no git impact)**

Run: `git ls-files knowledge/pages _temp | wc -l`
Expected: `0`

- [ ] **Step 2: Delete the cruft**

Run: `rm -rf knowledge/pages _temp && ls knowledge/pages _temp 2>/dev/null || echo "swept"`
Expected: `swept`

- [ ] **Step 3: Verify the tree is still clean and check passes**

Run: `git status --short && npm run check`
Expected: only intended changes (none from this step — both were untracked); check green.

- [ ] **Step 4: (No commit needed — untracked deletions produce no diff.)** Record the sweep in the next task's commit message instead.

---

## Task 6: Bundle builder (dumb allowlist copy + no-leak check)

**Files:**
- Create: `scripts/publish/build-bundle.mjs`
- Create: `scripts/publish/bundle-gitignore`
- Modify: `.gitignore` (add `dist/`)

- [ ] **Step 1: Add `dist/` to the repo `.gitignore`**

Append to `.gitignore` (root), after the existing entries:

```
dist/
```

- [ ] **Step 2: Create the bundle's own `.gitignore` template**

`scripts/publish/bundle-gitignore`:

```
node_modules/
.DS_Store
artifacts/
coverage/
*.log
profiles/
_temp/
```

- [ ] **Step 3: Implement the bundle builder**

`scripts/publish/build-bundle.mjs`:

```js
#!/usr/bin/env node
import {
  cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, writeFileSync, copyFileSync
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShippingFiles } from "../lib/shipping-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = resolve(repoRoot, "scripts/publish/bundle-allowlist.json");
const distDir = resolve(repoRoot, "dist");
const STAMP = ".bundle-stamp.json";
const BUNDLE_IGNORE = ".gitignore";

/** Wipe dist contents except the embedded distro .git, then copy the allowlist in. */
function sync() {
  const files = resolveShippingFiles(repoRoot, manifestPath);
  if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
      if (name === ".git") continue;
      rmSync(resolve(distDir, name), { recursive: true, force: true });
    }
  } else {
    mkdirSync(distDir, { recursive: true });
  }
  for (const rel of files) {
    const dest = resolve(distDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolve(repoRoot, rel), dest);
  }
  copyFileSync(resolve(repoRoot, "scripts/publish/bundle-gitignore"), resolve(distDir, BUNDLE_IGNORE));
  return files;
}

/** Every file in dist (except .git, the stamp, the generated .gitignore) must be allowlisted. */
function assertNoLeak(files) {
  const allow = new Set([...files, STAMP, BUNDLE_IGNORE]);
  const leaks = [];
  const walk = (rel) => {
    for (const name of readdirSync(resolve(distDir, rel || "."))) {
      if (!rel && name === ".git") continue;
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(resolve(distDir, childRel)).isDirectory()) walk(childRel);
      else if (!allow.has(childRel)) leaks.push(childRel);
    }
  };
  walk("");
  if (leaks.length) {
    for (const l of leaks) process.stderr.write(`LEAK ${l}\n`);
    process.stderr.write(`\nbuild-bundle FAILED: ${leaks.length} path(s) outside the allowlist.\n`);
    process.exit(1);
  }
}

function main() {
  const files = sync();
  assertNoLeak(files);
  writeFileSync(
    resolve(distDir, STAMP),
    JSON.stringify({ builtAt: new Date().toISOString(), fileCount: files.length }, null, 2) + "\n"
  );
  process.stdout.write(`build-bundle OK → dist/ (${files.length} files)\n`);
  process.stdout.write(`Next: cd dist && (git init if needed) && git add -A && git commit && git push\n`);
}

main();
```

- [ ] **Step 4: Build the bundle**

Run: `node scripts/publish/build-bundle.mjs`
Expected: `build-bundle OK → dist/ (<N> files)` and no `LEAK` lines.

- [ ] **Step 5: Verify the bundle is standalone-valid (integrity)**

Run:
```bash
cd dist && npm install --no-audit --no-fund --silent && npm run check; cd ..
```
Expected: the bundle's own `npm run check` (lint + typecheck + validate-skill + pii-scan + tests) passes. validate-skill passes *without* `.governance`/`tasks/` because the gate was removed in Task 1. If it fails on a missing dev-only path, the gate decoupling (Task 1) or the allowlist (Task 2) is incomplete — fix before continuing.

- [ ] **Step 6: Confirm `dist/` is gitignored in the dev repo**

Run: `git check-ignore dist && git status --short | grep -c '^?? dist' || echo "dist ignored"`
Expected: `dist` then `dist ignored`.

- [ ] **Step 7: Commit**

```bash
git add scripts/publish/build-bundle.mjs scripts/publish/bundle-gitignore .gitignore
git commit -m "feat(publish): build-bundle (dumb allowlist copy + no-leak gate) + sweep legacy cruft"
```

---

## Self-Review (filled)

**Spec coverage:** ③ removal (Task 1), pii-scan gate (Task 3) + wire-in (Task 4), redact (Task 4), legacy sweep (Task 5), bundle skeleton + allowlist + no-leak + integrity (Tasks 2,6). ② triage explicitly deferred to P3 (noted above). knowledge as-is = no task needed (already clean). ✓

**Placeholder scan:** none — all steps carry concrete code/commands. The redacted path `/path/to/repo/...` is an intentional placeholder *value*, not a plan gap.

**Type/name consistency:** `resolveShippingFiles(repoRoot, manifestPath)` and `findPii(content)` signatures are identical across the resolver, tests, pii-scan, and build-bundle. Manifest keys `include`/`exclude` consistent. `STAMP`/`BUNDLE_IGNORE` excluded from no-leak. ✓

**Known risk:** `npm install` inside `dist/` (Task 6 Step 5) downloads deps — slow but required for true standalone verification; run once at plan close.
