# Agent-Native CLI Patterns Design

## Goal

Absorb six useful `larksuite/cli` agent-native patterns into `browser-flow`
without forcing abstractions that do not fit the current workflow compiler.

## Scope

This design covers the browser-flow runtime CLI under
`skills/browser-flow/runtime/` and the model-facing browser-flow skill docs under
`skills/browser-flow/`. The work must preserve the existing release contract:
stable JSON, stable exit codes, artifact-first verification, and the
`prepare -> done -> analyze -> generate -> verify` pipeline.

## Pattern Mapping

1. Typed error contract
   Extend the current `CliError` surface with stable `type`, `subtype`, `hint`,
   `param`, `artifacts`, and `retryable` fields. Keep existing `code`,
   `recoverable`, `suggestedCommands`, and exit codes for compatibility.

2. Authoritative status command
   Add `browser-flow status --run-id <id>` as a read-only command. It reads the
   latest authoritative artifacts (`workflow.json`, `verification.json`,
   `security.json`, `verification-summary.json`, and optional
   `data-result.json`) and returns a compact decision object for agents. It must
   never infer success from stdout summaries or old journal entries.

3. Risk and confirmation metadata
   Add a closed risk taxonomy to command metadata: `read`, `write`,
   `high-risk-write`, and `interactive`. Expose it through `schema`,
   `capabilities`, help, and status-related guidance. Add an explicit
   confirmation error type for later use, but do not gate existing commands with
   `--yes` until the command-specific UX is intentionally designed.

4. Notice envelope
   Add a small `_notice` envelope hook that can be attached to structured CLI
   output. Start with static agent-contract notices only when relevant; do not
   invent skill-version drift state until the installer/runtime has a real
   persisted source of truth.

5. Browser-flow layers
   Represent browser-flow's existing command layers in metadata instead of
   adding broad shortcut commands immediately. Initial layers are `setup`,
   `pipeline`, `reuse`, `review`, `promotion`, `recovery`, and `raw-browser`.

6. Split-flow browser attach guidance
   Make the existing `serve-browser`, `verify --first`, and `verify --attach`
   handoff explicit in CLI metadata and skill docs. The contract must tell
   agents which commands may block for human browser work and which follow-up
   command resumes the flow.

## Architecture

Keep command registration in `scripts/lib/cli-metadata.mjs` as the source of
truth for agent-visible command metadata. Add small focused helpers instead of
expanding `cli-main.mjs`: typed error formatting stays in `cli-errors.mjs`,
status artifact reduction lives in a new command/helper, and notice injection is
centralized near CLI output formatting.

The first implementation pass should be additive. Existing command names,
existing exit codes, and current JSON success payloads remain valid.

## Phase And Lane Model

- Lane A, Contract: typed errors, risk/layer metadata, notice hook.
- Lane B, Status: authoritative status command and artifact checks.
- Lane C, Docs: split-flow guidance and skill-facing contract updates.
- Lane D, Verification: independent review after each execution phase.

Lane A and Lane B can start from the same source review, but Lane B depends on
the final command metadata shape before it is exposed in schema/capabilities.
Lane C depends on the public command behavior from Lanes A and B. Lane D runs
after each phase and must be performed separately from the executing changes.

## Evaluation Requirements

- `npm test` in `skills/browser-flow/runtime` passes after each implementation
  phase.
- `browser-flow schema` exposes `risk` and `layer` for public commands.
- `browser-flow status --run-id <id>` is read-only and reports whether success
  can be claimed from current artifacts.
- JSON errors preserve old `error.code` while adding typed fields.
- Human errors remain readable and actionable.
- No command is marked successful from `verification-summary.json` alone.
- No broad shortcut layer is introduced before there is a proven need.

## Backlog Rules

When a phase reveals a deeper design issue, record it in the implementation
plan's backlog section. At phase end, review each backlog item and decide
whether it is required now to protect the six-pattern goal. Only implement it in
the current branch if it is necessary for correctness or verification.
