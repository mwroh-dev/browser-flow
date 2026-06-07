# Project-Local Skill Bundle Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `browser-flow` install as a project-local Codex skill under the target project's `.codex/` directory without copying repo-level `agents/`, `scripts/`, `knowledge/`, `tests/`, `node_modules/`, or package metadata into the target project root.

**Architecture:** Treat the released artifact as a self-contained skill bundle, not as a repository that must be expanded into the host root. The public entry remains `.codex/skills/browser-flow/SKILL.md`, but its role definitions, internal sub-agent skills, runtime scripts, tests, package metadata, and validator move under `.codex/skills/browser-flow/bundle/`. The host project root owns only user workflow state if explicitly requested; installation itself must only write under `.codex/`.

**Tech Stack:** Node ESM, `node:test`, existing browser-flow CLI modules, `scripts/publish/build-bundle.mjs`, `scripts/lib/shipping-surface.mjs`, Codex skill layout.

**Official-doc correction:** OpenAI's current Codex skill documentation says repo-scoped skills are discovered from `.agents/skills`, not `.codex/skills`. The implementation therefore keeps the existing source authoring location at `.codex/skills/browser-flow` for this repository, but the publish/install surface is remapped to `.agents/skills/browser-flow` for project-local Codex discovery.

---

## Problem Summary

The failed install into `/Users/cielo-iamdt/Downloads/browser-test` happened because the current release bundle is shaped like a standalone repo:

- `.codex/skills/browser-flow/scripts/validate-skill.mjs` computes `repoRoot` as three levels above the skill directory.
- The validator requires `agents/<name>/AGENT.md` and imports `scripts/lib/schemas.mjs` from that computed root.
- The published allowlist ships root-level `agents`, `scripts`, `knowledge`, `tests`, `package.json`, `package-lock.json`, and `tsconfig.json`.
- Running `npm ci` in the target root creates `node_modules` in the user's project.
- Running tests in the target root creates `artifacts/` runtime records in the user's project.

That means the installer did not merely install a skill. It converted the target folder into a copy of the browser-flow release repo.

## Target Layout

After this plan, a project-local install should look like this:

```text
/Users/cielo-iamdt/Downloads/browser-test/
└── .codex/
    └── skills/
        └── browser-flow/
            ├── SKILL.md
            ├── manifest.json
            ├── prompt.md
            ├── references/
            ├── scripts/
            │   └── validate-skill.mjs
            └── bundle/
                ├── agents/
                ├── skills/
                │   ├── capture-driver/
                │   ├── extract-heal-agent/
                │   ├── heal-agent/
                │   ├── scope-agent/
                │   ├── scoring-agent/
                │   ├── scraping-agent/
                │   ├── spec-agent/
                │   └── variable-agent/
                ├── runtime/
                │   ├── scripts/
                │   ├── knowledge/
                │   ├── package.json
                │   ├── package-lock.json
                │   └── tsconfig.json
                └── tests/
```

No root-level `agents/`, `scripts/`, `knowledge/`, `tests/`, `node_modules/`, `package.json`, or `package-lock.json` should be created in the host project by installation.

## File Structure

| Path | Responsibility |
|---|---|
| `.codex/skills/browser-flow/SKILL.md` | Public skill entry. Declares that browser-flow is project-local and self-contained. |
| `.codex/skills/browser-flow/prompt.md` | Model-facing orchestration. References bundled role and sub-skill paths inside the public skill directory. |
| `.codex/skills/browser-flow/manifest.json` | Public skill references only. No repo-root assumptions. |
| `.codex/skills/browser-flow/scripts/validate-skill.mjs` | Validates the self-contained skill bundle from `skillRoot`, not host project root. |
| `.codex/skills/browser-flow/bundle/agents/**` | Phase role identities formerly at repo root `agents/**`. |
| `.codex/skills/browser-flow/bundle/skills/**` | Internal Task-tool sub-agent skills formerly at `.codex/skills/<name>`. |
| `.codex/skills/browser-flow/bundle/runtime/scripts/**` | CLI/runtime code formerly at repo root `scripts/**`. |
| `.codex/skills/browser-flow/bundle/runtime/knowledge/**` | Seed semantic knowledge and registries formerly at repo root `knowledge/**`. |
| `.codex/skills/browser-flow/bundle/runtime/package.json` | Runtime dependencies installed inside the skill bundle, not target root. |
| `scripts/publish/bundle-allowlist.json` | Ships the nested install surface and stops shipping root-level runtime directories as target-root files. |
| `scripts/publish/build-bundle.mjs` | Builds the release in the install shape above. |
| `tests/publish/project-local-install.test.mjs` | Regression tests for target-root cleanliness and nested bundle validity. |
| `tests/skill/browser-flow-capture.test.mjs` | Updates validator smoke test to the new self-contained structure. |

## Task 1: Lock the Target-Root Cleanliness Regression

**Files:**
- Create: `tests/publish/project-local-install.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/publish/project-local-install.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("project-local install only creates .codex at the host root", () => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), "browser-flow-install-"));
  cpSync(
    resolve(repoRoot, ".codex"),
    resolve(targetRoot, ".codex"),
    { recursive: true }
  );

  const entries = readdirSync(targetRoot).sort();
  assert.deepEqual(entries, [".codex"]);

  for (const forbidden of [
    "agents",
    "scripts",
    "knowledge",
    "tests",
    "node_modules",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "artifacts"
  ]) {
    assert.equal(
      existsSync(resolve(targetRoot, forbidden)),
      false,
      `${forbidden} must not be installed at host root`
    );
  }

  assert.equal(
    existsSync(resolve(targetRoot, ".codex", "skills", "browser-flow", "bundle", "agents", "orchestrator", "AGENT.md")),
    true
  );
  assert.equal(
    existsSync(resolve(targetRoot, ".codex", "skills", "browser-flow", "bundle", "runtime", "scripts", "cli.mjs")),
    true
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/publish/project-local-install.test.mjs
```

Expected: FAIL because `.codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md` and `.codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs` do not exist yet.

- [ ] **Step 3: Commit**

```bash
git add tests/publish/project-local-install.test.mjs
git commit -m "test(publish): lock project-local skill install shape"
```

## Task 2: Add the Nested Bundle Surface in the Source Tree

**Files:**
- Create: `.codex/skills/browser-flow/bundle/agents/**`
- Create: `.codex/skills/browser-flow/bundle/skills/**`
- Create: `.codex/skills/browser-flow/bundle/runtime/scripts/**`
- Create: `.codex/skills/browser-flow/bundle/runtime/knowledge/**`
- Create: `.codex/skills/browser-flow/bundle/runtime/package.json`
- Create: `.codex/skills/browser-flow/bundle/runtime/package-lock.json`
- Create: `.codex/skills/browser-flow/bundle/runtime/tsconfig.json`

- [ ] **Step 1: Copy role identities into the public skill bundle**

Run:

```bash
mkdir -p .codex/skills/browser-flow/bundle/agents
cp -R agents/analyzer agents/capture agents/generator agents/orchestrator agents/verifier .codex/skills/browser-flow/bundle/agents/
```

Expected: `.codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md` exists.

- [ ] **Step 2: Copy internal sub-agent skills into the public skill bundle**

Run:

```bash
mkdir -p .codex/skills/browser-flow/bundle/skills
cp -R .codex/skills/capture-driver .codex/skills/extract-heal-agent .codex/skills/heal-agent .codex/skills/scope-agent .codex/skills/scoring-agent .codex/skills/scraping-agent .codex/skills/spec-agent .codex/skills/variable-agent .codex/skills/browser-flow/bundle/skills/
```

Expected: `.codex/skills/browser-flow/bundle/skills/capture-driver/SKILL.md` exists.

- [ ] **Step 3: Copy runtime code and seed knowledge into the public skill bundle**

Run:

```bash
mkdir -p .codex/skills/browser-flow/bundle/runtime
cp -R scripts knowledge package.json package-lock.json tsconfig.json .codex/skills/browser-flow/bundle/runtime/
```

Expected: `.codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs` exists.

- [ ] **Step 4: Run the failing install-shape test again**

Run:

```bash
node --test tests/publish/project-local-install.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .codex/skills/browser-flow/bundle tests/publish/project-local-install.test.mjs
git commit -m "build(skill): nest browser-flow runtime under public skill"
```

## Task 3: Repoint the Skill Contract to Bundled Paths

**Files:**
- Modify: `.codex/skills/browser-flow/SKILL.md`
- Modify: `.codex/skills/browser-flow/prompt.md`
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs`
- Test: `tests/skill/browser-flow-capture.test.mjs`

- [ ] **Step 1: Update `SKILL.md` path language**

Change the role-boundary paragraph in `.codex/skills/browser-flow/SKILL.md` from:

```md
Layer/role authority lives in
`agents/{name}/AGENT.md`.
```

to:

```md
Layer/role authority lives in the bundled projected views at
`bundle/agents/{name}/AGENT.md`. Internal sub-agent skills live under
`bundle/skills/{name}/`; runtime code lives under `bundle/runtime/scripts/`.
Installation must not copy those directories to the host project root.
```

- [ ] **Step 2: Update `prompt.md` projected-view paths**

In `.codex/skills/browser-flow/prompt.md`, replace every phase-role path:

```text
agents/orchestrator/AGENT.md
agents/orchestrator/openai.yaml
agents/capture/AGENT.md
agents/capture/openai.yaml
agents/analyzer/AGENT.md
agents/analyzer/openai.yaml
agents/generator/AGENT.md
agents/generator/openai.yaml
agents/verifier/AGENT.md
agents/verifier/openai.yaml
```

with:

```text
bundle/agents/orchestrator/AGENT.md
bundle/agents/orchestrator/openai.yaml
bundle/agents/capture/AGENT.md
bundle/agents/capture/openai.yaml
bundle/agents/analyzer/AGENT.md
bundle/agents/analyzer/openai.yaml
bundle/agents/generator/AGENT.md
bundle/agents/generator/openai.yaml
bundle/agents/verifier/AGENT.md
bundle/agents/verifier/openai.yaml
```

Replace internal sub-agent skill references:

```text
.codex/skills/scraping-agent/SKILL.md
.codex/skills/extract-heal-agent/SKILL.md
.codex/skills/scope-agent/SKILL.md
.codex/skills/scoring-agent/SKILL.md
.codex/skills/heal-agent/SKILL.md
.codex/skills/variable-agent/SKILL.md
.codex/skills/spec-agent/SKILL.md
.codex/skills/capture-driver/SKILL.md
```

with paths relative to the public skill:

```text
bundle/skills/scraping-agent/SKILL.md
bundle/skills/extract-heal-agent/SKILL.md
bundle/skills/scope-agent/SKILL.md
bundle/skills/scoring-agent/SKILL.md
bundle/skills/heal-agent/SKILL.md
bundle/skills/variable-agent/SKILL.md
bundle/skills/spec-agent/SKILL.md
bundle/skills/capture-driver/SKILL.md
```

- [ ] **Step 3: Rewrite validator root calculation**

In `.codex/skills/browser-flow/scripts/validate-skill.mjs`, replace:

```js
import { parseOpenAiAgentDef } from "../../../../scripts/lib/schemas.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..", "..");
```

with:

```js
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = resolve(root, "bundle");
const runtimeRoot = resolve(bundleRoot, "runtime");
const { parseOpenAiAgentDef } = await import(
  pathToFileURL(resolve(runtimeRoot, "scripts", "lib", "schemas.mjs")).href
);
```

Also add `pathToFileURL`:

```js
import { pathToFileURL, fileURLToPath } from "node:url";
```

Then replace all `resolve(repoRoot, ...)` validator lookups for agents with `resolve(bundleRoot, ...)`, and all `scripts/lib/**` imports with `runtimeRoot`.

- [ ] **Step 4: Update validator expected paths**

In `.codex/skills/browser-flow/scripts/validate-skill.mjs`, change:

```js
const requiredRepoFiles = agentNames.flatMap((name) => [
  `agents/${name}/AGENT.md`,
  `agents/${name}/openai.yaml`
]);
```

to:

```js
const requiredBundleFiles = agentNames.flatMap((name) => [
  `agents/${name}/AGENT.md`,
  `agents/${name}/openai.yaml`,
  `agents/${name}/knowledge-pattern.md`
]);
const requiredRuntimeFiles = [
  "scripts/cli.mjs",
  "scripts/lib/schemas.mjs",
  "package.json",
  "package-lock.json"
];
```

Validate `requiredBundleFiles` relative to `bundleRoot`, and `requiredRuntimeFiles` relative to `runtimeRoot`.

- [ ] **Step 5: Update prompt linkage assertions**

In `.codex/skills/browser-flow/scripts/validate-skill.mjs`, replace:

```js
const agentMdPath = `agents/${name}/AGENT.md`;
const openaiPath = `agents/${name}/openai.yaml`;
```

with:

```js
const agentMdPath = `bundle/agents/${name}/AGENT.md`;
const openaiPath = `bundle/agents/${name}/openai.yaml`;
```

- [ ] **Step 6: Run validator smoke test**

Run:

```bash
node .codex/skills/browser-flow/scripts/validate-skill.mjs
```

Expected: `browser-flow skill validated`.

- [ ] **Step 7: Run skill test**

Run:

```bash
node --test tests/skill/browser-flow-capture.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .codex/skills/browser-flow/SKILL.md .codex/skills/browser-flow/prompt.md .codex/skills/browser-flow/scripts/validate-skill.mjs tests/skill/browser-flow-capture.test.mjs
git commit -m "fix(skill): validate browser-flow from nested bundle paths"
```

## Task 4: Rebuild the Release Surface Around `.codex` Only

**Files:**
- Modify: `scripts/publish/bundle-allowlist.json`
- Modify: `scripts/publish/build-bundle.mjs`
- Modify: `tests/publish/shipping-surface.test.mjs`

- [ ] **Step 1: Change shipping allowlist**

Replace `scripts/publish/bundle-allowlist.json` with:

```json
{
  "include": [
    ".codex/skills/browser-flow"
  ],
  "exclude": [
    ".codex/skills/browser-flow/bundle/runtime/scripts/publish/build-bundle.mjs",
    ".codex/skills/browser-flow/bundle/runtime/scripts/publish/bundle-gitignore"
  ]
}
```

Expected: release copies only the public skill subtree.

- [ ] **Step 2: Update shipping-surface expectations**

In `tests/publish/shipping-surface.test.mjs`, change required inclusions from root paths to nested paths:

```js
assert.ok(files.includes(".codex/skills/browser-flow/SKILL.md"), "ships public skill");
assert.ok(files.includes(".codex/skills/browser-flow/bundle/runtime/scripts/cli.mjs"), "ships nested runtime CLI");
assert.ok(files.includes(".codex/skills/browser-flow/bundle/agents/orchestrator/AGENT.md"), "ships bundled orchestrator role");
assert.ok(files.includes(".codex/skills/browser-flow/bundle/skills/capture-driver/SKILL.md"), "ships bundled internal skill");
```

Change the root-cleanliness assertions to:

```js
for (const forbidden of ["agents/", "scripts/", "knowledge/", "tests/"]) {
  assert.ok(!files.some((f) => f.startsWith(forbidden)), `no root ${forbidden}`);
}
assert.ok(!files.includes("package.json"), "no host-root package.json");
assert.ok(!files.includes("package-lock.json"), "no host-root package-lock.json");
assert.ok(!files.includes("tsconfig.json"), "no host-root tsconfig.json");
```

- [ ] **Step 3: Keep release-dir leak checking**

Do not weaken `scripts/publish/build-bundle.mjs` `assertNoLeak()`. If it fails after the allowlist change, fix the allowlist rather than skipping new directories.

- [ ] **Step 4: Run publish tests**

Run:

```bash
node --test tests/publish/shipping-surface.test.mjs tests/publish/project-local-install.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Build the release bundle**

Run:

```bash
BROWSER_FLOW_RELEASE_DIR=/private/tmp/browser-flow-released-project-local node scripts/publish/build-bundle.mjs
```

Expected: build succeeds and `/private/tmp/browser-flow-released-project-local` contains `.codex/skills/browser-flow/**` only, plus generated `.gitignore` and `.bundle-stamp.json`.

- [ ] **Step 6: Commit**

```bash
git add scripts/publish/bundle-allowlist.json scripts/publish/build-bundle.mjs tests/publish/shipping-surface.test.mjs
git commit -m "build(publish): ship browser-flow as project-local skill bundle"
```

## Task 5: Make Runtime Commands Resolve From the Nested Runtime Root

**Files:**
- Modify: `.codex/skills/browser-flow/bundle/runtime/scripts/lib/config.mjs`
- Modify: `.codex/skills/browser-flow/prompt.md`
- Test: `tests/publish/project-local-install.test.mjs`

- [ ] **Step 1: Add explicit runtime-root terminology to prompt**

In `.codex/skills/browser-flow/prompt.md`, add this invariant near the command-surface section:

```md
When running browser-flow CLI commands from an installed project-local skill,
use `bundle/runtime` as the runtime working directory. Do not run `npm ci`,
`npm test`, or browser-flow runtime commands from the host project root.
```

- [ ] **Step 2: Add runtime-root assertion to install-shape test**

Append to `tests/publish/project-local-install.test.mjs`:

```js
assert.equal(
  existsSync(resolve(targetRoot, ".codex", "skills", "browser-flow", "bundle", "runtime", "package.json")),
  true,
  "runtime dependencies are declared inside bundle/runtime"
);
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node --test tests/publish/project-local-install.test.mjs tests/skill/browser-flow-capture.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .codex/skills/browser-flow/prompt.md tests/publish/project-local-install.test.mjs
git commit -m "docs(skill): require runtime commands inside nested bundle"
```

## Task 6: Repair the Existing `~/Downloads/browser-test` Install

**Files:**
- Modify outside repo: `/Users/cielo-iamdt/Downloads/browser-test/**`

- [ ] **Step 1: Back up the polluted target before cleanup**

Run:

```bash
cp -R /Users/cielo-iamdt/Downloads/browser-test /Users/cielo-iamdt/Downloads/browser-test.backup-before-skill-repair
```

Expected: backup directory exists.

- [ ] **Step 2: Remove only files introduced by the bad install**

Run from `/Users/cielo-iamdt/Downloads/browser-test`:

```bash
rm -rf agents scripts knowledge tests node_modules artifacts .husky package.json package-lock.json tsconfig.json AGENTS.md CLAUDE.md README.md docs .bundle-stamp.json .gitignore
```

Expected: host root contains `.codex` only, unless the user had pre-existing project files. If pre-existing project files are present, preserve them and remove only the browser-flow files confirmed by the backup diff.

- [ ] **Step 3: Install the corrected local skill bundle**

After Tasks 1-5 are implemented and the release is rebuilt, run:

```bash
rm -rf /Users/cielo-iamdt/Downloads/browser-test/.codex/skills/browser-flow
cp -R /private/tmp/browser-flow-released-project-local/.codex/skills/browser-flow /Users/cielo-iamdt/Downloads/browser-test/.codex/skills/
```

Expected: `/Users/cielo-iamdt/Downloads/browser-test/.codex/skills/browser-flow/bundle/runtime/package.json` exists.

- [ ] **Step 4: Validate without host-root dependencies**

Run:

```bash
node /Users/cielo-iamdt/Downloads/browser-test/.codex/skills/browser-flow/scripts/validate-skill.mjs
```

Expected: `browser-flow skill validated`, and no `/Users/cielo-iamdt/Downloads/browser-test/package.json` or `/Users/cielo-iamdt/Downloads/browser-test/node_modules` is created.

## Task 7: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused verification**

Run:

```bash
node --test tests/publish/project-local-install.test.mjs tests/publish/shipping-surface.test.mjs tests/skill/browser-flow-capture.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run package checks**

Run:

```bash
npm run lint
npm run typecheck
npm run validate-skill
npm test
```

Expected: all pass. If Chrome-dependent tests flake, rerun the exact failing test file once in isolation and record the result.

- [ ] **Step 3: Build release to temp and inspect root**

Run:

```bash
BROWSER_FLOW_RELEASE_DIR=/private/tmp/browser-flow-released-project-local node scripts/publish/build-bundle.mjs
find /private/tmp/browser-flow-released-project-local -maxdepth 1 -mindepth 1 -print | sort
```

Expected max-depth root entries:

```text
/private/tmp/browser-flow-released-project-local/.bundle-stamp.json
/private/tmp/browser-flow-released-project-local/.codex
/private/tmp/browser-flow-released-project-local/.gitignore
```

- [ ] **Step 4: Commit final verification-only adjustments if needed**

```bash
git status --short
git add <only-files-intentionally-changed>
git commit -m "test(publish): verify project-local browser-flow install"
```

## Self-Review

**Spec coverage:** The plan addresses the bad root-level install, nested agents/internal skills, nested runtime/dependencies, validator path assumptions, release allowlist, and the existing polluted `/Users/cielo-iamdt/Downloads/browser-test` repair path.

**Placeholder scan:** No `TBD`, `TODO`, or unspecified implementation steps remain. Commands and expected outcomes are concrete.

**Type consistency:** The plan consistently uses `root` for `.codex/skills/browser-flow`, `bundleRoot` for `.codex/skills/browser-flow/bundle`, and `runtimeRoot` for `.codex/skills/browser-flow/bundle/runtime`.
