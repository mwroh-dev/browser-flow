# Codex Canonical Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.codex/skills/browser-flow` the single Codex project-local install surface and keep internal browser-flow agents nested inside that public skill bundle.

**Architecture:** The source skill remains at `.codex/skills/browser-flow`. The release bundle must preserve that same path instead of remapping it to `.agents`, and the project-local installer must copy only the public browser-flow skill into the target project's `.codex/skills/browser-flow`. Validator checks split source-repo expectations from installed-bundle expectations so internal sub-agent skills are not required as target-project top-level skills.

**Tech Stack:** Node test runner, Bash installer, Node release bundler, Codex skill markdown.

---

### Task 1: Lock Codex Install Shape With Failing Tests

**Files:**
- Modify: `tests/publish/project-local-install.test.mjs`
- Modify: `tests/publish/project-local-installer.test.mjs`

- [ ] **Step 1: Update install-shape test expectation**

Change `tests/publish/project-local-install.test.mjs` so the simulated installed root is `.codex/skills/browser-flow`, root entries equal `[".codex"]`, and all bundle assertions point under `.codex`.

- [ ] **Step 2: Update installer tests**

Change `tests/publish/project-local-installer.test.mjs` so the installer is expected to write `target/.codex/skills/browser-flow`, not create `.agents`, and not expose top-level internal skills such as `target/.codex/skills/capture-driver`.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `node --test tests/publish/project-local-install.test.mjs tests/publish/project-local-installer.test.mjs`

Expected result before implementation: FAIL because current installer still writes `.agents` and release still remaps to `.agents`.

- [ ] **Step 4: Commit tests**

Run:
```bash
git add tests/publish/project-local-install.test.mjs tests/publish/project-local-installer.test.mjs
git commit -m "test: expect codex project-local install shape"
```

### Task 2: Preserve `.codex` In Release And Installer

**Files:**
- Modify: `install-project-local.sh`
- Modify: `scripts/publish/build-bundle.mjs`
- Modify: `.codex/skills/browser-flow/prompt.md`

- [ ] **Step 1: Update installer**

Make `install-project-local.sh` choose `.codex/skills/browser-flow` as the source when present, install to `target/.codex/skills/browser-flow`, and remove any stale target `.agents/skills/browser-flow` left by older installs.

- [ ] **Step 2: Update release bundler**

Remove the `.codex` to `.agents` remap in `scripts/publish/build-bundle.mjs` so release bundles preserve `.codex/skills/browser-flow`.

- [ ] **Step 3: Update skill command paths**

Replace user-facing `.agents/skills/browser-flow/...` command examples and project-local invariant in `.codex/skills/browser-flow/prompt.md` with `.codex/skills/browser-flow/...`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/publish/project-local-install.test.mjs tests/publish/project-local-installer.test.mjs`

Expected result: PASS.

- [ ] **Step 5: Commit implementation**

Run:
```bash
git add install-project-local.sh scripts/publish/build-bundle.mjs .codex/skills/browser-flow/prompt.md
git commit -m "fix: install browser-flow under codex skills"
```

### Task 3: Make Validator Compatible With Installed Bundle Shape

**Files:**
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs`
- Test: existing `npm run validate-skill`

- [ ] **Step 1: Identify source-only sibling checks**

Locate checks that read `root/../capture-driver` or `root/../../../agents`.

- [ ] **Step 2: Add bundle-first fallback**

For internal sub-agent checks, read `root/bundle/skills/capture-driver/SKILL.md` first and only fall back to source sibling paths when validating the development repository.

- [ ] **Step 3: Preserve source repo role checks**

Keep source role checks for the development repo, but skip them when validating an installed release bundle that has no root `agents/` directory.

- [ ] **Step 4: Run validation**

Run: `npm run validate-skill`

Expected result: PASS from source repo.

- [ ] **Step 5: Commit validator fix**

Run:
```bash
git add .codex/skills/browser-flow/scripts/validate-skill.mjs
git commit -m "fix: validate installed browser-flow bundle shape"
```

### Task 4: Sync Release And Clean Browser-Test Install

**Files:**
- Modify generated release repo: `/Users/cielo-iamdt/projects/browser-flow-released`
- Modify target install: `/Users/cielo-iamdt/Downloads/browser-test/.codex/skills/browser-flow`

- [ ] **Step 1: Build release**

Run: `node scripts/publish/build-bundle.mjs`

Expected result: release repo contains `.codex/skills/browser-flow/SKILL.md` and no `.agents/skills/browser-flow/SKILL.md`.

- [ ] **Step 2: Commit release repo**

Run in `/Users/cielo-iamdt/projects/browser-flow-released`:
```bash
git status --short
git add .
git commit -m "release: install browser-flow under codex skills"
```

- [ ] **Step 3: Clean target install**

Remove stale `/Users/cielo-iamdt/Downloads/browser-test/.agents/skills/browser-flow` and top-level internal skills under `/Users/cielo-iamdt/Downloads/browser-test/.codex/skills/{capture-driver,extract-heal-agent,heal-agent,scope-agent,scoring-agent,scraping-agent,spec-agent,variable-agent}`.

- [ ] **Step 4: Reinstall target from release**

Run: `/Users/cielo-iamdt/projects/browser-flow-released/install-project-local.sh /Users/cielo-iamdt/Downloads/browser-test`

Expected result: only `/Users/cielo-iamdt/Downloads/browser-test/.codex/skills/browser-flow/SKILL.md` appears as a top-level browser-flow skill entry.

- [ ] **Step 5: Commit source release-sync metadata if needed**

If source repo files changed during release build, commit them; otherwise no source commit is needed.

### Task 5: Full Verification And Backlog Review

**Files:**
- No planned code edits.

- [ ] **Step 1: Run source checks**

Run: `npm run check`

Expected result: PASS.

- [ ] **Step 2: Verify release install shape**

Run:
```bash
find /Users/cielo-iamdt/Downloads/browser-test -maxdepth 5 -path '*/skills/*/SKILL.md' -print
```

Expected result: one top-level `.codex/skills/browser-flow/SKILL.md`; bundled internals may appear only under `.codex/skills/browser-flow/bundle/skills/*`.

- [ ] **Step 3: Regression self-review**

Check whether any remaining user-visible text says `.agents/skills/browser-flow` for Codex installs. If found, fix before final response.

- [ ] **Step 4: Report result**

Summarize source commits, release commit, and target install shape.
