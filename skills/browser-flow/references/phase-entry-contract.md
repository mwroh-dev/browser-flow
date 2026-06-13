# Phase Entry Contract

This reference owns the core capture -> analyze -> generate -> verify phase
entry contract. `prompt.md` loads this file; it does not restate the phase
instructions.

This file must stay limited to phase order, projected views, callables, and
completion traces. Move policy text to the canonical `references/*` owner,
phase-specific judgment to `agents/*/AGENT.md`, and design rationale to a review
or documentation artifact.

## Phase Entry State Contract

| Pre-condition | Action | Trace |
| --- | --- | --- |
| User intent requires a new or refreshed workflow capture. | Enter Capture with the capture projected view and run its callable. | Capture artifacts exist for the run id, or the flow stops at a defined checkpoint. |
| Capture artifacts exist for the run id. | Enter Analyze with the analyzer projected view and run its callable. | Analysis artifacts exist for the run id, or the flow stops at a defined checkpoint. |
| Analysis artifacts exist for the run id. | Enter Generate with the generator projected view and run its callable. | Generated workflow and runner artifacts exist for the run id. |
| Generated workflow and runner artifacts exist for the run id. | Enter Verify with the verifier projected view and run its callable. | Verification reports exist for the run id, or the flow stops at a defined checkpoint. |

## Projected Views And Callables

| Phase | Load | Callable |
| --- | --- | --- |
| Capture | `agents/capture/AGENT.md`; `agents/capture/openai.yaml`; `references/security-policy.md`; `references/replay-permission-policy.md`; `references/checkpoint-contracts.md` | `node runtime/scripts/cli.mjs prepare --run-id <id> --fixture <fixture> [--start-url <url>] [--unmasked] [--snapshot-dom]` then `node runtime/scripts/cli.mjs done --run-id <id>` |
| Analyze | `agents/analyzer/AGENT.md`; `agents/analyzer/openai.yaml`; `references/replay-permission-policy.md`; `references/checkpoint-contracts.md` | `node runtime/scripts/cli.mjs analyze --run-id <id>` |
| Generate | `agents/generator/AGENT.md`; `agents/generator/openai.yaml`; `references/artifact-schemas.md`; `references/replay-permission-policy.md` | `node runtime/scripts/cli.mjs generate --run-id <id>` |
| Verify | `agents/verifier/AGENT.md`; `agents/verifier/openai.yaml`; `references/verification-rules.md`; `references/replay-permission-policy.md`; `references/checkpoint-contracts.md` | `node runtime/scripts/cli.mjs verify --run-id <id> [--headless]` |

For login-required or other human-held browser state, split the Verify entry
into an explicit attach flow: claim a named CDP registry port, run
`node runtime/scripts/cli.mjs serve-browser --run-id <id> --port <claimed-port>`,
then run `node runtime/scripts/cli.mjs verify --run-id <id> --attach <claimed-port>`.
Named project work must use the registry claim instead of hardcoded `9222`.

## Phase Boundary Rules

- Load only the projected view for the active phase.
- State explicitly that the active agent identity is the phase agent.
- Do not load other agents' identities or unrelated phase references at that
  phase boundary.
- Optional operations such as Extract and Compose are not numbered core phases.
- A split-flow browser attach is still part of Verify. It only supplies browser
  state; success still depends on authoritative verification and security
  artifacts.
