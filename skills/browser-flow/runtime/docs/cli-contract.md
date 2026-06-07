# Browser Flow CLI Contract

This document is for Codex, Claude, and other automation callers that need a
stable project-local CLI surface. The CLI contract is additive: command metadata
can gain fields, but existing meanings should not silently change.

## Discovery

Use discovery commands instead of parsing prose help:

```bash
browser-flow capabilities --json
browser-flow schema --json
browser-flow schema command <name> --json
browser-flow schema command verify --json
```

Every schema response includes `ok: true`, `schemaVersion`, `product`, command
metadata, and stable exit-code metadata. Command records include:

- `name`
- `description`
- `group`
- `classification`
- `usage`
- `requiredOptions`
- `optionalOptions`
- `defaults`
- `outputMode`
- `sideEffects`
- `mutating`
- `readArtifacts`
- `writtenArtifacts`
- `registryMutation`
- `safetyImplications`
- `relatedCommands`

`registryMutation` is one of `none`, `conditional-upsert`, or
`required-upsert`. Treat `mutating: true` and non-empty `writtenArtifacts` as a
reason to prefer `--dry-run` first when the command supports it.

## JSON Output

Most non-interactive commands write JSON to stdout. Commands invoked with
`--json` keep error output structured:

The stable error shape is `ok: false` plus `error.code`, `error.message`,
`error.recoverable`, and `error.suggestedCommands`.

```json
{
  "ok": false,
  "error": {
    "code": "invalid_usage",
    "message": "What failed.",
    "recoverable": true,
    "suggestedCommands": ["browser-flow help"]
  }
}
```

JSON errors use stdout and keep stderr empty. Human errors use stderr and include
the same recovery fields as text.

## Exit Codes

The stable exit-code taxonomy is also available from
`browser-flow help exit-codes`.

| Code | error.code | Meaning |
| ---: | --- | --- |
| 0 | ok | Command completed successfully. |
| 1 | runtime_error | Unexpected runtime or system failure. |
| 2 | invalid_usage | Command, flag, value, or argument combination is invalid. |
| 3 | missing_required_option | A required command option is missing. |
| 4 | missing_run_artifact | A required run artifact is missing. |
| 5 | dependency_preflight_failure | Runtime dependency or browser preflight failed. |
| 6 | safety_or_permission_block | Safety policy, permission, or security gate blocked execution. |
| 7 | checkpoint_required | A review or heal checkpoint must be resolved before continuing. |
| 8 | verification_not_green | Replay, verification, or green-report requirement is not satisfied. |
| 9 | diagnostic_not_promotable | Diagnostic replay completed but cannot be promoted. |

Do not collapse verification holds or checkpoint-required states into generic
runtime errors in automation logic.

## Side Effects

Use schema fields before calling a command:

- `sideEffects` describes human-readable effects.
- `readArtifacts` lists required or inspected inputs.
- `writtenArtifacts` lists possible outputs.
- `registryMutation` identifies registry writes.
- `safetyImplications` captures verification and privacy constraints.

Previewable mutating commands support `--dry-run`:

```bash
browser-flow run --run-id demo --bind input.query=weather --dry-run
browser-flow promote --run-id demo --scope external --origins https://example.com --auth-mode none --profile-mode ephemeral --privacy-level minimal --screenshots off --data-mode route --dry-run
browser-flow cleanup --run-id demo --dry-run
browser-flow compose --run-id demo --request "repeat without the last item" --dry-run
```

Dry-run must not create derived run directories, mutate the registry, spawn
cleanup runners, start learning, generate runners, or verify derived compose
runs.

## Automation Expectations

Automation callers should follow the phase order:

```text
prepare -> done -> analyze -> generate -> verify -> optional extract/compose/reuse/promote
```

Never report a workflow successful or promotable unless the authoritative
artifacts for the current run show both:

- `reports/verification.json` is green.
- `reports/security.json` is green.

For real-site flows, use explicit `--unmasked --start-url <url>` during capture
and explicit promotion metadata. Browser Flow is not a bypass surface and should
not be automated around site blocks, login walls, or anti-automation controls.

## Completion

Static completion is available:

```bash
browser-flow completion bash
browser-flow completion zsh
browser-flow completion fish
```

Completion v1 covers command names and common flags only. It does not inspect
run artifacts or registry contents.
