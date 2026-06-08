# Extract Operation

Extract is an optional post-verify data operation, not a core
capture/analyze/generate/verify phase.

Use Extract when the user's goal asks for page data: top rows, current values,
latest headlines, prices, tables, lists, or collected items. In DATA mode, the
navigation workflow should stop on the page that contains the requested data;
the extractor owns current values.

## Ownership

- The orchestrator owns DATA intent classification and routing.
- The extractor agent owns schema-to-selector setup, deterministic reuse, and
  extraction drift repair.
- Runtime commands own applying extractor configs and writing extraction
  artifacts.

## Operation Shape

| Operation | Command | Owner |
| --- | --- | --- |
| Setup request | `extract --run-id <id> --step <n> --schema <targetSchema.json>` | orchestrator |
| Setup apply | `extract --run-id <id> --apply <scrape-result.json>` | extractor runtime |
| Reuse | `extract --run-id <id> --step <n> --reuse [--paged]` | extractor runtime |
| Drift repair apply | `extract-heal --run-id <id> --apply <extract-heal-result.json>` | extractor runtime |

## Rules

- Extraction requires captured DOM snapshots for the target step.
- Do not encode current titles, prices, or top-row text as fixed replay
  evidence unless the user explicitly asks to reopen that exact historical item.
- Preserve ordinal list intent, such as first result or latest post, when the
  user wants to open that item.
- Report `confident-zero`, `drift`, and `unrepairable` honestly. Do not present
  empty or stale extraction output as valid data.
- Registry promotion still follows verification, security, public-read, and
  operator-approval gates.
