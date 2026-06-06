# Browser Flow

Browser Flow is a project-local browser workflow skill for Codex and Claude.

It captures a human browser demonstration, compiles it into a reusable local
workflow, verifies replay, and lets the installed agent reuse that workflow
without re-discovering the same browser steps with fresh model tokens each time.

It is intended for repeatable browser work, workflow composition, and local
agent pipelines. It is not intended for bypassing site controls, saving user
secrets into files, or bulk scraping.

## Install

From this released checkout:

```bash
./install-project-local.sh /path/to/target-project
./install-project-local.sh --tool claude /path/to/target-project
```

Codex installs to:

```text
/path/to/target-project/.codex/skills/browser-flow
```

Claude installs to:

```text
/path/to/target-project/.claude/commands/browser-flow.md
/path/to/target-project/.claude/browser-flow
```

Runtime dependencies are prepared inside the installed package's `runtime/`
directory on first use, not at the target project root.

## What You Get

Browser Flow turns one demonstrated browser task into a code-backed local
workflow:

- captured browser events are sanitized before persistence
- analysis emits `path.yaml` and `recipe.yaml`
- generation emits a runnable CDP-direct runner
- verification checks replay truthfulness before reuse
- successful workflows can be reused with less model context and token spend

The package is local to the project where it is installed. It does not install a
global browser automation service.

## Privacy and Real-Site Use

Browser Flow is local-first. Real-site use is supported through explicit capture
modes and should stay within the user's authorization, site terms, and rate
limits. Browser Flow has been tested with Korean web services during
development, but it is not designed as a site-control bypass or unrestricted
scraping tool.

The released package does not include real-site screenshots, DOM snapshots, or
captured run artifacts. Local artifacts can still contain visible page text or
business data, so do not publish them without review.

## CDP Port Note

`serve-browser` defaults to port `9222` for a single shared, manual attach
session. For named, concurrent, or long-running workflows, choose an explicit
non-conflicting port and track it in your local environment.

## Latest Release

<!-- browser-flow-latest:start -->
- Source branch: `main`
- Source SHA: `1016902`
- Updated: 2026-06-06T19:18:12.876Z
- Bundle file count: 230
- Updated work items:
  - `verification-quality-fixes`: Verification quality fixes (resolved)
<!-- browser-flow-latest:end -->

## History

See [HISTORY.md](HISTORY.md) for the compact development history. Entries are
organized by major project arc rather than by individual commit.
