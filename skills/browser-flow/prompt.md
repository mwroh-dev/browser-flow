# Browser Flow Public Entry

This is the single public entry workflow for browser-flow. Top-level
entrypoints may invoke only this flow. Internal agent-owned playbooks are not
public entry surfaces.

# Browser Flow LLM Entry

Scope: model-facing skill entry. This file tells the LLM how to enter the
browser-flow workflow, when to load projected views, and where policy contracts
live. Role identity lives in `agents/{name}/AGENT.md` and is loaded as a
projected view at phase entry.

Use this skill when the user wants to capture a browser workflow, verify a prior
capture, reuse an existing verified workflow, compose a derived workflow, or
return page data from a verified browser state.

## Entry Identity

On skill entry, operate as the orchestrator agent:

- Load `agents/orchestrator/AGENT.md`.
- Load `agents/orchestrator/openai.yaml`.
- Read `runtime/knowledge/registry/workflows.json` before recommending
  recapture.

The orchestrator coordinates phase entry. It does not execute phase CLI work
under its own identity; it adopts each phase agent's projected view at that
phase boundary.

## Entry Flow

1. Classify intent as action replay, DATA extraction, compose, or a combination.
2. Check the workflow registry for an existing verified workflow.
3. Recommend reuse or capture with the fixture choice.
4. Run the core pipeline, stopping only at defined checkpoints.
5. If DATA is required, route to the optional Extract operation after verify.

For DATA intent, use `references/extract-operation.md`. For compose requests,
use `references/compose-boundary.md`.

## Checkpoints

Stop only at checkpoints defined in `references/checkpoint-contracts.md`:

- `awaiting_capture`
- `capture_noise_review`
- `locator_intent_review`
- `route_intent_review`
- `not_verified_hold`

Each checkpoint briefing states why the pipeline stopped, what the user must do,
and what continues after the user responds. Do not stop for tool invocations,
file writes, or intermediate CLI output.

## Pipeline Phase Entry Protocol

Each core phase entry has the same shape:

1. Load the phase projected view: the phase `AGENT.md`, `openai.yaml`, and
   phase-specific references.
2. State explicitly that the active agent identity is the phase agent.
3. Execute the phase callable from `runtime/scripts/cli.mjs`.

Load only the projected view for the active phase. Do not load other agents'
identities or unrelated phase references at that point.

## Core Pipeline

| Phase | Projected View | Callable |
| --- | --- | --- |
| Capture | `agents/capture/AGENT.md`; `agents/capture/openai.yaml`; `references/security-policy.md`; `references/replay-permission-policy.md`; `references/checkpoint-contracts.md` | `node runtime/scripts/cli.mjs prepare --run-id <id> --fixture <fixture> [--start-url <url>] [--unmasked] [--snapshot-dom]` then `node runtime/scripts/cli.mjs done --run-id <id>` |
| Analyze | `agents/analyzer/AGENT.md`; `agents/analyzer/openai.yaml`; `references/replay-permission-policy.md`; `references/checkpoint-contracts.md` | `node runtime/scripts/cli.mjs analyze --run-id <id>` |
| Generate | `agents/generator/AGENT.md`; `agents/generator/openai.yaml`; `references/artifact-schemas.md`; `references/replay-permission-policy.md` | `node runtime/scripts/cli.mjs generate --run-id <id>` |
| Verify | `agents/verifier/AGENT.md`; `agents/verifier/openai.yaml`; `references/verification-rules.md`; `references/replay-permission-policy.md`; `references/checkpoint-contracts.md` | `node runtime/scripts/cli.mjs verify --run-id <id> [--headless]` |

The core phases run serially: capture -> analyze -> generate -> verify.

## Optional Operations

| Operation | Load When | Projected View / Contract |
| --- | --- | --- |
| Extract | The verified workflow must return page data. | `agents/extractor/AGENT.md`; `agents/extractor/openai.yaml`; `references/extract-operation.md` |
| Compose | The user asks to derive a workflow from a prior run. | `references/compose-boundary.md`; `agents/orchestrator/playbooks/composer-agent.md` only when compose-time judgment is needed |

Optional operations are not numbered core phases.

## Internal Boundary

This skill is the public surface for the installed browser-flow package.

- `runtime/scripts/` commands are internal implementation details; surface
  user-facing actions and artifacts instead of implementation structure.
- `runtime/artifacts/` contains immutable run evidence; do not modify it.
- `agents/{name}/AGENT.md` files are projected views, not public entry
  surfaces.

## Phase-Independent References

Load these only when the relevant operation occurs:

- `references/registry-contract.md` when reading or updating the workflow
  registry.
- `references/commit-protocol.md` when the user asks to commit or share the
  result.
