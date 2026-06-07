# Browser Flow Cross-Runtime Surface And Boundary Design

**Date:** 2026-05-27  
**Status:** design (approved direction, pending user spec review)

## Goal

Make `browser-flow` support both **Codex** and **Claude Code** from a **single
canonical source tree**, while preserving a strict boundary between:

- the **public entry surface** the top-level model may discover and invoke
- the **internal/private sub-agent contracts and playbooks** that must remain
  outside the top-level model's normal invocation path

The design must also preserve the existing release workflow:

- source repo = single source of truth
- `browser-flow-released` = generated public release repo
- `/Users/cielo-iamdt/Downloads/browser-test` = real install target used for
  installation and runtime validation

## Official Runtime Surfaces (checked 2026-05-27)

### Claude Code

Claude Code project-level official surfaces are:

- `CLAUDE.md`
- `.claude/commands/`

`CLAUDE.md` supports `@path/to/import` syntax, so a thin wrapper that imports
`@AGENTS.md` is valid. Claude Code does **not** document `.claude/skills` as the
project-level public entry surface.

### Codex

Codex supports skills as a public reusable workflow surface. In this repository,
the install shape already uses `.codex/skills/browser-flow/` as the public
project-local entry.

### Consequence

The repository must **not** treat `.codex/skills/browser-flow/` as the canonical
source of the entire product. It is only the **Codex adapter surface**. Likewise,
Claude-specific files must be treated as **Claude adapters**, not as source of
truth.

## Core Principles (decided)

1. **Single source of truth, multiple thin adapters.**
   The product has one canonical source tree. Codex and Claude receive generated
   or projected public adapter surfaces from that tree.

2. **Discovery is not authorization.**
   Anything placed in a model-discoverable public surface can be invoked or read
   in ways that bypass the intended orchestration. Natural-language "internal
   only" warnings are not enforcement.

3. **Private means private to the top-level model's invocation surface, not
   private to the human reader.**
   The public GitHub release may still contain implementation files. The
   important boundary is that the top-level model must not treat internal
   sub-agent contracts as public tools or direct playbooks.

4. **One-agent-only procedures are not shared skills.**
   If a procedure is only used by one agent, it belongs in that agent's owned
   implementation area, not in a shared public skill namespace.

5. **Release projection is an allowlisted public projection from the canonical
   tree.**
   The release repo is generated from the canonical source with explicit public
   surface rules and boundary tests.

## Target Architecture

The source tree becomes vendor-neutral and product-centric. The exact top-level
directory name is not the key design decision; the key is the ownership split.

Required logical layers:

### 1. Canonical shared core

Contains:

- universal instructions
- shared prompts/reference materials
- deterministic runtime
- release/install projection rules
- test fixtures and validation contracts

Canonical instructions are owned by:

- `AGENTS.md` = universal source of truth for product- and boundary-level rules

### 2. Public adapters

#### Codex adapter

Public install surface:

- `.codex/skills/browser-flow/`

This is a thin adapter that points Codex to the canonical browser-flow entry
workflow. It may contain Codex-specific wrapper metadata, but it must not become
the source of truth for shared workflow logic.

#### Claude adapter

Public install surface:

- `CLAUDE.md`
- `.claude/commands/browser-flow.md`

`CLAUDE.md` is a thin wrapper that imports `@AGENTS.md` and adds only
Claude-specific runtime notes. The slash command is the Claude public command
entry, analogous to the Codex public skill entry.

### 3. Agent-owned private playbooks

Internal sub-agent contracts that are used only by one agent or one orchestrated
path must move out of the public top-level skill namespace.

Examples:

- scope/scoring/heal/scraping/extract-heal/spec/variable/capture-driver
- composer-agent if it is not meant to be top-level discoverable

These become **agent-owned private playbooks/contracts**, not public skills.

Design rule:

- reusable across multiple workflows and safe to expose -> shared/public surface
- used only by one agent or one orchestrated internal path -> agent-owned private
  implementation surface

### 4. Runtime gateway / orchestration boundary

The top-level public adapter must not directly expose internal sub-agent
contracts as discoverable public skills. Instead:

- public entry receives the user request
- orchestrator loads only the canonical public workflow
- orchestrator projects role-scoped views to private agent-owned contracts
- private contracts return typed decision artifacts
- deterministic runtime executes the actual side effects

This preserves:

- orchestrator-gated context distribution
- subagent-per-task isolation
- "private to top-level invocation surface" semantics

## Public vs Private Surface Rules

### Public

Visible, documented, and intended for top-level model invocation:

- Codex `browser-flow` public skill
- Claude `/browser-flow` public command
- shared install docs for those surfaces

### Private

Not part of the official top-level entry surface:

- internal sub-agent contracts
- one-agent-only playbooks
- internal projected-view helpers
- orchestration-only private prompt fragments

### Critical constraint

No internal/private contract should remain as a top-level discoverable entry like:

- `.codex/skills/<internal-name>/`
- `.claude/commands/<internal-name>.md`

unless it is intentionally promoted to public and tested as such.

## Canonical Instruction Layout

### AGENTS.md

Becomes the canonical shared instruction file for:

- public/private boundary rules
- installation/release invariants
- skill surface rules
- orchestration and sub-agent boundary definitions

### CLAUDE.md

Thin wrapper:

```md
@AGENTS.md

# Claude Code-specific
- Public browser-flow entry lives in `.claude/commands/browser-flow.md`.
- Do not treat internal browser-flow implementation files as top-level commands.
```

### Codex public skill

Thin adapter that points to the canonical browser-flow public flow, while keeping
Codex-specific metadata local to the adapter.

## Release And Install Projection

### Source repo

Single source of truth.

### browser-flow-released

Generated public repo. It must include:

- Codex public adapter
- Claude public adapter
- deterministic runtime required for execution
- any private implementation files required at runtime, but not as top-level
  discoverable public entries

It must not include extra public top-level entries for internal sub-agents.

### install-project-local.sh

Must install both runtime surfaces together:

- target `/.codex/skills/browser-flow`
- target `/CLAUDE.md`
- target `/.claude/commands/browser-flow.md`

The installer must also remove stale legacy surfaces that violate the new
boundary model.

## Validation Strategy

Validation is required at four levels.

### 1. Structural tests

Lock the new install shape and public surface:

- Codex public adapter exists
- Claude public adapter exists
- no top-level internal sub-agent public entries exist
- release projection contains only the intended public entries

### 2. Negative boundary tests

At least one negative test must assert that the top-level public entry cannot
legitimately route through a visible internal public skill/command surface.

The point is to catch "top-level model bypasses browser-flow and directly
interprets internal playbooks" regressions.

### 3. Install validation

Use `/Users/cielo-iamdt/Downloads/browser-test` as a real target.

The validation must:

- regenerate `browser-flow-released`
- reinstall into `browser-test`
- verify resulting install tree
- verify only intended public entries appear at top-level

### 4. Runtime validation

Real execution validation must include:

- Codex-side public entry smoke
- Claude-side public entry smoke
- one real browser/CDP-driven browser-flow run from the installed target

This is not optional. The architecture change is about preventing behavioral
drift and bypass; only real invocation tests can verify that.

## Execution Method (locked)

Implementation must follow:

- lane-first decomposition when work is parallelizable
- one dependency-heavy lane for strongly coupled structural work
- phase-by-phase execution within each lane
- per-task commit discipline
- phase start records: `todo`, `eval`, `result`
- backlog capture for root-cause or follow-on work
- phase-end backlog regression self-review
- model tiering for sub-agents:
  - simple mechanical edits / file moves / mirror sync -> lower-cost model
  - boundary design / projection logic / validator rules / negative tests ->
    stronger reasoning model

## Non-Goals

- Redesigning browser-flow runtime semantics unrelated to public/private surface
  separation
- Turning all internal implementation files into opaque binaries
- Hiding source code from humans in the public release repo
- Unifying Codex and Claude into a fake common public surface that ignores
  official product conventions

## Acceptance Criteria

The design is successful only if all of the following hold:

1. The repository has one canonical source of truth.
2. Codex and Claude both have official public adapter surfaces generated from it.
3. Internal one-agent-only procedures are no longer exposed as top-level public
   discoverable entries.
4. `AGENTS.md` is the canonical shared instruction source.
5. `CLAUDE.md` imports `@AGENTS.md` and remains a thin adapter.
6. `browser-flow-released` is generated from the canonical source without public
   boundary regressions.
7. `/Users/cielo-iamdt/Downloads/browser-test` installs both Codex and Claude
   public adapters correctly.
8. Installed target passes real browser/CDP workflow validation.
9. Negative tests exist for public/private boundary regressions.
10. The top-level public entry no longer depends on the existence of internal
    public skill namespaces to function.
