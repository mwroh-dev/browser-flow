# Browser Flow

Browser Flow is a project-local browser workflow skill for Codex and Claude.

It captures a human browser demonstration, compiles it into a reusable local
workflow, verifies replay, and lets the installed agent reuse that workflow
without re-discovering the same browser steps with fresh model tokens each time.

It is intended for repeatable browser work, workflow composition, and local
agent pipelines. It is not intended for bypassing site controls, saving user
secrets into files, or bulk scraping.

Current support target: macOS happy path. Windows and Linux paths keep
defensive compatibility guards where practical, but this released CLI does not
claim full cross-platform support.

The CLI is designed first as an agent contract surface: stable JSON, stable
exit codes, machine-readable schema/capabilities, dry-run previews, and explicit
artifact paths take priority over decorative terminal output.

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

## CLI

Common discovery commands:

```bash
browser-flow help workflows
browser-flow capabilities --json
browser-flow schema command verify --json
browser-flow completion bash
```

Dry-run capable commands expose `--dry-run` in schema metadata so agents can
preview mutating work before writing artifacts.

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

## Compose V1

`bf compose --run-id <id>` is a reuse-first helper for the primary run. It can
select already captured segments and defer gaps to interactive live learning,
but multi-run compose is deferred. The v1 boundary is primary run only.

## Privacy and Real-Site Use

Browser Flow is local-first. Real-site use is supported through explicit capture
modes and should stay within the user's authorization, site terms, and rate
limits. Browser Flow has been tested with Korean web services during
development, but it is not designed as a site-control bypass or unrestricted
scraping tool.

The released package does not include real-site screenshots, DOM snapshots, or
captured run artifacts. Local artifacts can still contain visible page text or
business data, so do not publish them without review.

## Real-Site, Login, and Privacy Modes

Do not store raw cookies, passwords, tokens, or session values in workflow
artifacts. For broad login requests such as "do everything" or "다 해줘", use one
of the secure modes instead:

- `attached-browser`: attach to an already authenticated browser session.
- `keychain-session`: keep reusable secrets in the OS keychain.
- `persistent-profile`: use a named profile directory controlled by the user.

## CDP Port Note

`serve-browser` defaults to port `9222` for a single shared, manual attach
session. For named, concurrent, or long-running workflows, choose an explicit
non-conflicting port and track it in your local environment.

## Latest Release

<!-- browser-flow-latest:start -->
- Source branch: `main`
- Source SHA: `cf4c72d`
- Updated: 2026-06-07T07:22:35.311Z
- Bundle file count: 233
- Updated work items:
- `cli-public-surface`: CLI public surface (resolved)
<!-- browser-flow-latest:end -->

## History

See [HISTORY.md](HISTORY.md) for the compact development history. Entries are
organized by major project arc rather than by individual commit.
