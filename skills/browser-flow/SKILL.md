---
name: browser-flow
description: Single-entry skill for capturing a local browser demo and producing a verified workflow artifact with path.yaml, recipe.yaml, and a runnable CDP-direct replay.
surface: repo_skill
---

# Browser Flow

Scope: model-facing skill entry package. `prompt.md` is the entry loader;
workflow phase entry is owned by `references/phase-entry-contract.md`, and
role authority lives in the projected views at `agents/{name}/AGENT.md`.
Internal sub-agent skills live under `skills/{name}/`; runtime code lives under
`runtime/scripts/`. Installation must not copy those directories to the host
project root.

Single-entry Codex and Claude skill for capturing local browser workflows and
producing verified artifacts.

Load `prompt.md` first. It declares which agent views and references to load for
the current intent; see `manifest.json` for the reference list.
