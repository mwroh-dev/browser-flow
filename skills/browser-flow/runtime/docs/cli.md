# Browser Flow CLI

Browser Flow is a project-local browser workflow compiler. The CLI captures a
human demonstration, compiles sanitized artifacts, generates a runner, verifies
truthful replay, and optionally reuses, extracts, promotes, composes, or cleans
up the workflow. It is not a bypass tool, unrestricted scraping framework, or
generic Selenium/Playwright wrapper.

Use `browser-flow help`, `browser-flow help workflows`, and
`browser-flow <command> --help` for the live command surface.

## Install

From this repository:

```bash
npm install
node scripts/cli.mjs help
```

For another project, install the project-local skill bundle from a released
checkout:

```bash
./install-project-local.sh /path/to/target-project
./install-project-local.sh --tool claude /path/to/target-project
```

The runtime stays inside the installed browser-flow package. It does not create
a global daemon or write runtime code into the host project root.

## Verify Installation

```bash
browser-flow doctor --json
browser-flow help workflows
browser-flow capabilities --json
browser-flow schema command verify --json
```

`doctor` reports page-node staleness and local preflight checks for Node, npm,
runtime dependencies, artifact directories, registry readability, security
baseline scripts, and Chrome path readiness.

## First Capture

Use a fixture for the first local loop:

```bash
browser-flow prepare --run-id demo --fixture synthetic
# Perform the browser demo by clicking and typing in the opened Chrome window.
browser-flow done --run-id demo
```

For an explicit real-site diagnostic capture, pass `--unmasked --start-url
<url>`. If a site blocks or errors, stop rather than adding bypass behavior.

## Analyze, Generate, Verify

```bash
browser-flow analyze --run-id demo
browser-flow generate --run-id demo
browser-flow verify --run-id demo --headless
```

The durable proof lives under `artifacts/runs/<id>/reports/`. Do not call a
workflow successful unless `verification.json` and `security.json` are both
green.

## Reuse

Inspect declared inputs, bind values, and preview derived artifacts before
writing them:

```bash
browser-flow vars --run-id demo
browser-flow run --run-id demo --bind input.query=weather --dry-run
browser-flow run --run-id demo --bind input.query=weather
browser-flow verify --run-id demo-bind-<hash> --headless
```

`run --dry-run` validates bindings and reports the derived run paths without
creating the derived run.

## Extract Data

Extraction is optional and only for workflows that settle on a data-bearing
page. Capture with DOM snapshots:

```bash
browser-flow prepare --run-id data-demo --fixture synthetic --snapshot-dom
browser-flow done --run-id data-demo
browser-flow analyze --run-id data-demo
browser-flow generate --run-id data-demo
browser-flow verify --run-id data-demo --headless
browser-flow extract --run-id data-demo --step 2 --schema targetSchema.json
browser-flow extract --run-id data-demo --step 2 --apply scrape-result.json
browser-flow extract --run-id data-demo --step 2 --reuse
```

Extraction configs are page-data knowledge, separate from page-node structure.

## Promote External Workflow

Promotion writes `knowledge/registry/workflows.json` only after replay and
security artifacts are acceptable and explicit external metadata is supplied:

```bash
browser-flow promote --run-id demo \
  --scope external \
  --origins https://example.com \
  --auth-mode none \
  --profile-mode ephemeral \
  --privacy-level minimal \
  --screenshots off \
  --data-mode route \
  --dry-run
```

Remove `--dry-run` only after checking the preview. Browser Flow must not store
raw cookies, passwords, tokens, auth headers, CSRF values, or session values in
files.

## Cleanup And Recovery

Use review and recovery commands when a run is held or ambiguous:

```bash
browser-flow review-noise --run-id demo
browser-flow review-locator-intent --run-id demo
browser-flow review-route-intent --run-id demo
browser-flow heal --run-id demo
browser-flow score --run-id demo
browser-flow scope --run-id demo
browser-flow reveal --run-id demo
browser-flow cleanup --run-id demo --dry-run
```

`cleanup --dry-run` reports dangling artifacts and whether cleanup would execute
without spawning the generated runner.

## Completion

Static shell completion is available for commands and common flags:

```bash
browser-flow completion bash
browser-flow completion zsh
browser-flow completion fish
```

Dynamic artifact-aware completion is intentionally deferred.
