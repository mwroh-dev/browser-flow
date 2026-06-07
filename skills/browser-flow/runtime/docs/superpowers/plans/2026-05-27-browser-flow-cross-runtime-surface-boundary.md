# Browser Flow Cross-Runtime Surface Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor browser-flow to a single canonical source with Codex and Claude public adapters, move one-agent-only sub-agent contracts behind private agent-owned boundaries, and prove the installed result on `/Users/cielo-iamdt/Downloads/browser-test` with real browser/CDP validation.

**Architecture:** The repo root remains the single source of truth. Shared public entry content moves to `surfaces/browser-flow/`, private one-agent-only playbooks move under `agents/<owner>/playbooks/`, and generated/public install surfaces become `.codex/skills/browser-flow/`, `CLAUDE.md`, `.claude/commands/browser-flow.md`, plus a shared installed private runtime root at `.browser-flow/`. Release generation becomes an allowlisted projection from canonical source to adapters and the installed private runtime tree.

**Tech Stack:** Node ESM, `node:test`, Bash installer, existing publish/build-bundle tooling, `agent-browser` CDP CLI, browser-flow runtime under `scripts/`, Anthropic Claude Code official surfaces (`CLAUDE.md`, `.claude/commands`), Codex public skill surface (`.codex/skills`).

---

## File Structure Lock

Before implementation, lock the target structure:

| Responsibility | Canonical source path | Installed public path | Installed private path |
|---|---|---|---|
| Shared public entry text | `surfaces/browser-flow/public/entry.md` | rendered into `.codex/skills/browser-flow/prompt.md` and `.claude/commands/browser-flow.md` | n/a |
| Shared public references | `surfaces/browser-flow/public/references/**` | rendered into `.codex/skills/browser-flow/references/**` | optional copy under `.browser-flow/public/references/**` only if runtime needs it |
| Canonical instructions | `AGENTS.md` | imported by source `CLAUDE.md`; copied to `.browser-flow/AGENTS.md` in installed target | `.browser-flow/AGENTS.md` |
| Codex adapter | `surfaces/browser-flow/adapters/codex/**` | `.codex/skills/browser-flow/**` | n/a |
| Claude adapter | `surfaces/browser-flow/adapters/claude/**` | `CLAUDE.md`, `.claude/commands/browser-flow.md` | n/a |
| Shared private runtime | existing `scripts/**`, `knowledge/**`, package metadata | not public | `.browser-flow/runtime/**` |
| Agent-private playbooks | `agents/<name>/playbooks/**` | not public | `.browser-flow/agents/<name>/playbooks/**` |

### Ownership Mapping For Current Internal Skills

| Current top-level internal skill | New owner | New canonical private path |
|---|---|---|
| `capture-driver` | capture | `agents/capture/playbooks/capture-driver.md` |
| `scope-agent` | analyzer | `agents/analyzer/playbooks/scope-agent.md` |
| `scoring-agent` | analyzer | `agents/analyzer/playbooks/scoring-agent.md` |
| `scoring-agent/patterns.json` | analyzer | `agents/analyzer/playbooks/scoring-patterns.json` |
| `variable-agent` | analyzer | `agents/analyzer/playbooks/variable-agent.md` |
| `scraping-agent` | extractor | `agents/extractor/playbooks/scraping-agent.md` |
| `extract-heal-agent` | extractor | `agents/extractor/playbooks/extract-heal-agent.md` |
| `heal-agent` | verifier | `agents/verifier/playbooks/heal-agent.md` |
| `spec-agent` | verifier | `agents/verifier/playbooks/spec-agent.md` |
| `composer-agent` | orchestrator | `agents/orchestrator/playbooks/composer-agent.md` |

`agents/extractor/` is introduced as a first-class optional phase owner because scraping and extract-heal are not analyzer/verifier responsibilities.

## Lane Plan

### Lane A — Canonical Public Source + Public Adapters
High reasoning lane. No parallel sibling lane may modify adapter/render/build behavior at the same time.

Phases:
- `A1` test-lock the public surface and install shape
- `A2` introduce canonical `surfaces/browser-flow/` + render/generate path
- `A3` render Codex/Claude public adapters and rewire validators/docs

### Lane B — Private Boundary Migration
High reasoning lane. Owns agent-private playbooks, extractor agent, and negative boundary enforcement.

Phases:
- `B1` add `agents/extractor/` and move private playbooks/patterns
- `B2` rewire runtime references away from top-level `.codex/skills/<internal>`
- `B3` add negative boundary tests and public-surface leak checks

### Lane C — Release / Install / Real Validation
Mixed lane. Depends on A and B output; execute after both are green.

Phases:
- `C1` installer + build-bundle + allowlist projection for Codex + Claude + `.browser-flow`
- `C2` release build and `/Users/cielo-iamdt/Downloads/browser-test` reinstall validation
- `C3` real browser/CDP smoke using installed target (`serve-browser` + `agent-browser connect`)

## Phase Discipline

Every phase must begin with three explicit sections in the commit message body or phase note:

- `todo:` exact intended edits
- `eval:` commands that prove the phase
- `result:` success criteria / expected artifacts

If a root-cause or follow-on issue appears, add it to backlog immediately. At phase end, do a backlog regression self-review:

- if the issue blocks a future phase or weakens the public/private boundary, promote it now
- otherwise leave it in backlog with the reason it is deferred

Each phase ends with its own commit.

---

### Task 1: Lane A / Phase A1 — Lock Public Surface And Install Shape

**Files:**
- Create: `tests/publish/cross-runtime-surface.test.mjs`
- Modify: `tests/publish/project-local-installer.test.mjs`
- Modify: `tests/publish/project-local-install.test.mjs`
- Modify: `tests/publish/shipping-surface.test.mjs`

- [ ] **Step 1: Write failing tests for Claude + Codex public surfaces**

Add a new `tests/publish/cross-runtime-surface.test.mjs` covering:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

const repoRoot = getRepoRoot();

test("source repo exposes only browser-flow as public Codex skill entry", () => {
  assert.equal(existsSync(resolve(repoRoot, ".codex/skills/browser-flow/SKILL.md")), true);
  for (const forbidden of [
    ".codex/skills/capture-driver/SKILL.md",
    ".codex/skills/scope-agent/SKILL.md",
    ".codex/skills/scoring-agent/SKILL.md",
    ".codex/skills/scraping-agent/SKILL.md",
    ".codex/skills/extract-heal-agent/SKILL.md",
    ".codex/skills/heal-agent/SKILL.md",
    ".codex/skills/spec-agent/SKILL.md",
    ".codex/skills/variable-agent/SKILL.md",
    ".codex/skills/composer-agent/SKILL.md"
  ]) {
    assert.equal(existsSync(resolve(repoRoot, forbidden)), false, `${forbidden} must not remain a top-level public skill`);
  }
});

test("source repo exposes Claude public adapter only at CLAUDE.md + .claude/commands/browser-flow.md", () => {
  assert.equal(existsSync(resolve(repoRoot, "CLAUDE.md")), true);
  assert.equal(existsSync(resolve(repoRoot, ".claude/commands/browser-flow.md")), true);
  const claude = readFileSync(resolve(repoRoot, "CLAUDE.md"), "utf8");
  assert.match(claude, /@AGENTS\\.md/);
});
```

- [ ] **Step 2: Extend installer and shipping-surface tests to expect `.browser-flow` + Claude adapter**

Update the existing publish tests so the installed target is expected to contain:

```js
assert.ok(existsSync(resolve(target, ".codex/skills/browser-flow/SKILL.md")));
assert.ok(existsSync(resolve(target, "CLAUDE.md")));
assert.ok(existsSync(resolve(target, ".claude/commands/browser-flow.md")));
assert.ok(existsSync(resolve(target, ".browser-flow/runtime/scripts/cli.mjs")));
assert.ok(existsSync(resolve(target, ".browser-flow/AGENTS.md")));
assert.ok(!existsSync(resolve(target, ".codex/skills/scope-agent/SKILL.md")));
assert.ok(!existsSync(resolve(target, ".claude/commands/scope-agent.md")));
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --import=./tests/_setup.mjs --test \
  tests/publish/cross-runtime-surface.test.mjs \
  tests/publish/project-local-install.test.mjs \
  tests/publish/project-local-installer.test.mjs \
  tests/publish/shipping-surface.test.mjs
```

Expected: FAIL because the repo still exposes internal top-level Codex skills and has no Claude adapter or `.browser-flow` install root.

- [ ] **Step 4: Commit the RED tests**

Run:

```bash
git add tests/publish/cross-runtime-surface.test.mjs \
  tests/publish/project-local-install.test.mjs \
  tests/publish/project-local-installer.test.mjs \
  tests/publish/shipping-surface.test.mjs
git commit -m "test: lock cross-runtime public surface boundaries"
```

### Task 2: Lane A / Phase A2 — Introduce Canonical Public Source And Surface Renderer

**Files:**
- Create: `surfaces/browser-flow/public/entry.md`
- Create: `surfaces/browser-flow/public/references/`
- Create: `surfaces/browser-flow/adapters/codex/SKILL.md.tmpl`
- Create: `surfaces/browser-flow/adapters/codex/manifest.json.tmpl`
- Create: `surfaces/browser-flow/adapters/claude/browser-flow.md.tmpl`
- Create: `scripts/publish/render-browser-flow-surfaces.mjs`
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs`

- [ ] **Step 1: Add canonical shared public source files**

Create `surfaces/browser-flow/public/entry.md` as the single vendor-neutral public entry source. Its content must describe:

```md
# Browser Flow Public Entry

This is the single public entry workflow for browser-flow.
Top-level entrypoints may invoke only this flow.
Internal agent-owned playbooks are not public entry surfaces.
Runtime commands execute from `.browser-flow/runtime/scripts/cli.mjs`.
```

Copy current public reference content out of `.codex/skills/browser-flow/references/**` into `surfaces/browser-flow/public/references/**`.

- [ ] **Step 2: Add a renderer that materializes Codex and Claude adapters**

Create `scripts/publish/render-browser-flow-surfaces.mjs` with one exported entrypoint:

```js
export function renderBrowserFlowSurfaces(repoRoot) { /* writes:
  .codex/skills/browser-flow/{SKILL.md,manifest.json,prompt.md,references/**}
  CLAUDE.md
  .claude/commands/browser-flow.md
  .browser-flow/AGENTS.md
*/ }
```

Rendering rules:

- Codex `prompt.md` is generated from `surfaces/browser-flow/public/entry.md`
- Claude command markdown is generated from the same canonical entry
- `CLAUDE.md` is a thin wrapper that imports `@AGENTS.md`
- `.browser-flow/AGENTS.md` is copied from root `AGENTS.md`

- [ ] **Step 3: Update validator to treat generated adapter files as projections, not canonical source**

`validate-skill.mjs` must validate the rendered Codex surface while no longer assuming that `.codex/skills/browser-flow/prompt.md` is the original authoring source.

Minimum new validator assertions:

```js
if (!existsSync(resolve(repoRoot, "surfaces/browser-flow/public/entry.md"))) {
  throw new Error("Missing canonical shared public entry source.");
}
if (!existsSync(resolve(repoRoot, "CLAUDE.md"))) {
  throw new Error("Missing Claude public adapter.");
}
if (!existsSync(resolve(repoRoot, ".claude/commands/browser-flow.md"))) {
  throw new Error("Missing Claude browser-flow command adapter.");
}
```

- [ ] **Step 4: Run focused tests and syntax/validator checks**

Run:

```bash
node --import=./tests/_setup.mjs --test tests/publish/cross-runtime-surface.test.mjs
npm run lint
npm run validate-skill
```

Expected: `cross-runtime-surface` still fails on private skill leaks, but lint and validator should be adapted enough to keep moving.

- [ ] **Step 5: Commit canonical source + renderer**

Run:

```bash
git add surfaces/browser-flow scripts/publish/render-browser-flow-surfaces.mjs \
  .codex/skills/browser-flow/scripts/validate-skill.mjs
git commit -m "feat: add canonical browser-flow surface source and renderer"
```

### Task 3: Lane B / Phases B1-B2 — Migrate Internal Contracts To Agent-Owned Private Playbooks

**Files:**
- Create: `agents/extractor/AGENT.md`
- Create: `agents/extractor/openai.yaml`
- Create: `agents/extractor/knowledge-pattern.md`
- Create: `agents/capture/playbooks/capture-driver.md`
- Create: `agents/analyzer/playbooks/{scope-agent.md,scoring-agent.md,variable-agent.md,scoring-patterns.json}`
- Create: `agents/extractor/playbooks/{scraping-agent.md,extract-heal-agent.md}`
- Create: `agents/verifier/playbooks/{heal-agent.md,spec-agent.md}`
- Create: `agents/orchestrator/playbooks/composer-agent.md`
- Modify: all runtime code that currently reads `.codex/skills/<internal>/...`
- Modify: tests that reference `.codex/skills/<internal>/...`

- [ ] **Step 1: Write failing path-resolution tests for private playbook ownership**

Add a new test file `tests/skill/private-playbook-boundary.test.mjs` with assertions like:

```js
assert.equal(existsSync(resolve(repoRoot, "agents/analyzer/playbooks/scope-agent.md")), true);
assert.equal(existsSync(resolve(repoRoot, "agents/extractor/playbooks/scraping-agent.md")), true);
assert.equal(existsSync(resolve(repoRoot, ".codex/skills/scope-agent/SKILL.md")), false);
assert.equal(existsSync(resolve(repoRoot, ".codex/skills/scraping-agent/SKILL.md")), false);
```

- [ ] **Step 2: Add extractor phase ownership**

Create `agents/extractor/` mirroring the existing phase-role structure. Its contract must state:

```md
## Role
Owns post-verify extraction setup and extraction-heal private playbooks.
```

- [ ] **Step 3: Move one-agent-only contracts and patterns**

Move the current internal skill content into the owner playbooks listed in the File Structure Lock section. For `scoring-patterns.json`, move the actual data file to:

```text
agents/analyzer/playbooks/scoring-patterns.json
```

- [ ] **Step 4: Rewire runtime references**

Update every code path that currently references top-level internal Codex skill files. For example:

```js
// before
const PATTERNS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../.codex/skills/scoring-agent/patterns.json");

// after
const PATTERNS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../agents/analyzer/playbooks/scoring-patterns.json");
```

Repeat for demos, tests, prompt docs, and validator references.

- [ ] **Step 5: Run private-boundary focused tests**

Run:

```bash
node --import=./tests/_setup.mjs --test \
  tests/skill/private-playbook-boundary.test.mjs \
  tests/skill/browser-flow-capture.test.mjs \
  tests/skill/browser-flow-compose.test.mjs
```

Expected: PASS once path rewiring is complete.

- [ ] **Step 6: Commit private-boundary migration**

Run:

```bash
git add agents scripts tests docs .codex/skills/browser-flow/scripts/validate-skill.mjs
git commit -m "refactor: move internal browser-flow contracts behind agent-owned playbooks"
```

### Task 4: Lane B / Phase B3 — Enforce Negative Boundary Rules

**Files:**
- Create: `tests/runtime/public-boundary-negative.test.mjs`
- Modify: `tests/publish/cross-runtime-surface.test.mjs`
- Modify: `AGENTS.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add a negative regression for public/internal leakage**

Create `tests/runtime/public-boundary-negative.test.mjs` with checks like:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

test("public adapters do not advertise internal playbooks as entry surfaces", () => {
  const root = getRepoRoot();
  const codexPrompt = readFileSync(resolve(root, ".codex/skills/browser-flow/prompt.md"), "utf8");
  const claudeCmd = readFileSync(resolve(root, ".claude/commands/browser-flow.md"), "utf8");
  for (const forbidden of ["scope-agent", "scoring-agent", "scraping-agent", "extract-heal-agent", "capture-driver"]) {
    assert.doesNotMatch(codexPrompt, new RegExp(forbidden));
    assert.doesNotMatch(claudeCmd, new RegExp(forbidden));
  }
});
```

- [ ] **Step 2: Update canonical instructions/docs to state the boundary explicitly**

`AGENTS.md` and `docs/architecture.md` must explicitly say:

```md
Only `browser-flow` is a public entry surface.
Internal playbooks are agent-owned and are not top-level model entry surfaces.
```

- [ ] **Step 3: Run boundary tests**

Run:

```bash
node --import=./tests/_setup.mjs --test \
  tests/runtime/public-boundary-negative.test.mjs \
  tests/publish/cross-runtime-surface.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit boundary enforcement**

Run:

```bash
git add tests/runtime/public-boundary-negative.test.mjs tests/publish/cross-runtime-surface.test.mjs AGENTS.md docs/architecture.md
git commit -m "test: lock browser-flow public and private surface boundaries"
```

### Task 5: Lane C / Phases C1-C2 — Installer, Bundle, Release, And Browser-Test Reinstall

**Files:**
- Modify: `install-project-local.sh`
- Modify: `scripts/publish/build-bundle.mjs`
- Modify: `scripts/publish/bundle-allowlist.json`
- Modify: `tests/publish/project-local-installer.test.mjs`
- Modify outside repo target: `/Users/cielo-iamdt/Downloads/browser-test/**`

- [ ] **Step 1: Make installer project both public adapters and `.browser-flow`**

`install-project-local.sh` must:

- install `.codex/skills/browser-flow`
- install `.browser-flow/**`
- create or update `CLAUDE.md`
- create `.claude/commands/browser-flow.md`
- remove stale top-level internal public entries from prior installs

Use a managed Claude block so the installer is idempotent:

```md
<!-- browser-flow:start -->
@.browser-flow/CLAUDE.browser-flow.md
<!-- browser-flow:end -->
```

- [ ] **Step 2: Update release allowlist**

`scripts/publish/bundle-allowlist.json` must include:

```json
{
  "include": [
    "install-project-local.sh",
    ".codex/skills/browser-flow",
    ".claude/commands/browser-flow.md",
    "CLAUDE.md",
    ".browser-flow"
  ]
}
```

and must not include top-level internal skill entries.

- [ ] **Step 3: Rebuild release and reinstall browser-test**

Run:

```bash
BROWSER_FLOW_RELEASE_DIR=/private/tmp/browser-flow-cross-runtime-release node scripts/publish/build-bundle.mjs
/private/tmp/browser-flow-cross-runtime-release/install-project-local.sh /Users/cielo-iamdt/Downloads/browser-test
```

Expected install results:

```bash
test -f /Users/cielo-iamdt/Downloads/browser-test/.codex/skills/browser-flow/SKILL.md
test -f /Users/cielo-iamdt/Downloads/browser-test/CLAUDE.md
test -f /Users/cielo-iamdt/Downloads/browser-test/.claude/commands/browser-flow.md
test -f /Users/cielo-iamdt/Downloads/browser-test/.browser-flow/runtime/scripts/cli.mjs
test -f /Users/cielo-iamdt/Downloads/browser-test/.browser-flow/AGENTS.md
```

- [ ] **Step 4: Verify top-level leak absence on installed target**

Run:

```bash
find /Users/cielo-iamdt/Downloads/browser-test/.codex/skills -maxdepth 2 -path '*/SKILL.md' -print | sort
find /Users/cielo-iamdt/Downloads/browser-test/.claude/commands -maxdepth 1 -type f -print | sort
```

Expected:

- one public Codex skill: `.codex/skills/browser-flow/SKILL.md`
- one public Claude command: `.claude/commands/browser-flow.md`
- no top-level internal public entries

- [ ] **Step 5: Commit installer and release projection changes**

Run:

```bash
git add install-project-local.sh scripts/publish/build-bundle.mjs scripts/publish/bundle-allowlist.json tests/publish/project-local-installer.test.mjs
git commit -m "feat: project codex and claude adapters from canonical browser-flow source"
```

### Task 6: Lane C / Phase C3 — Real Browser/CDP Validation On Installed Target

**Files:**
- No planned repo edits unless validation reveals a real bug.
- Uses installed target `/Users/cielo-iamdt/Downloads/browser-test`.

- [ ] **Step 1: Install runtime deps inside installed target**

Run:

```bash
cd /Users/cielo-iamdt/Downloads/browser-test/.browser-flow/runtime
npm install
```

Expected: runtime deps install cleanly with no target-root `node_modules`.

- [ ] **Step 2: Smoke the installed Codex and Claude adapter surfaces**

Run:

```bash
test -f /Users/cielo-iamdt/Downloads/browser-test/CLAUDE.md
grep -n "@.browser-flow/CLAUDE.browser-flow.md" /Users/cielo-iamdt/Downloads/browser-test/CLAUDE.md
test -f /Users/cielo-iamdt/Downloads/browser-test/.claude/commands/browser-flow.md
node /Users/cielo-iamdt/Downloads/browser-test/.browser-flow/runtime/scripts/cli.mjs help
```

Expected: all pass; installed runtime help prints the browser-flow CLI surface.

- [ ] **Step 3: Launch visible Chrome from the installed runtime**

Run:

```bash
cd /Users/cielo-iamdt/Downloads/browser-test/.browser-flow/runtime
node scripts/cli.mjs serve-browser --run-id cross-runtime-smoke --port 9333 --url http://127.0.0.1:59999/synthetic
```

Expected: visible Chrome starts on port `9333` and remains open for attach.

- [ ] **Step 4: Attach with `agent-browser` over CDP and inspect the page**

In another terminal, run:

```bash
agent-browser connect 9333
agent-browser snapshot
agent-browser click '[data-bf="name-input"]'
agent-browser keyboard type 'Codex'
agent-browser click '[data-bf="submit-button"]'
agent-browser snapshot
```

Expected:

- CDP attach succeeds
- page snapshot is readable
- interactions succeed without losing the browser session

- [ ] **Step 5: Validate installed browser-flow end-to-end on the synthetic fixture**

Run from the installed runtime:

```bash
cd /Users/cielo-iamdt/Downloads/browser-test/.browser-flow/runtime
node scripts/cli.mjs prepare --run-id installed-smoke --fixture synthetic
# perform the synthetic demo in the opened Chrome window
node scripts/cli.mjs done --run-id installed-smoke
node scripts/cli.mjs analyze --run-id installed-smoke
node scripts/cli.mjs generate --run-id installed-smoke
node scripts/cli.mjs verify --run-id installed-smoke --headless
```

Expected: `verification.json` and `security.json` both green.

- [ ] **Step 6: Commit only if validation required source fixes**

If validation exposes a real source bug, fix it in source, re-run Task 6, then:

```bash
git add <fixed-files>
git commit -m "fix: preserve installed cross-runtime browser-flow behavior"
```

Otherwise no extra commit is needed.

## Self-Review

- **Spec coverage:** canonical source and official adapter split -> Tasks 1-2; private one-agent-only playbooks -> Task 3; discovery/authorization negative tests -> Task 4; release/install projection -> Task 5; browser-test install + real CDP/browser validation -> Task 6.
- **Placeholder scan:** no TBDs; all install paths, ownership moves, and validation commands are concrete.
- **Type consistency:** canonical shared source = `surfaces/browser-flow/**`; installed shared private root = `.browser-flow/**`; Codex public adapter = `.codex/skills/browser-flow/**`; Claude public adapter = `CLAUDE.md` + `.claude/commands/browser-flow.md`; one-agent-only procedures always move to `agents/<owner>/playbooks/**`.

Plan complete and saved to `docs/superpowers/plans/2026-05-27-browser-flow-cross-runtime-surface-boundary.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
