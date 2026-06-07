# Surfaces

This directory contains the source files for browser-flow's public
distribution surfaces. It is not runtime code.

In this repository, a surface is the content that an installed host tool or
release consumer sees: the shared public entry instruction, host-specific
wrappers, installable package templates, and release-facing files.

## Contents

- `browser-flow/public/entry.md` is the canonical public instruction body for
  the single `browser-flow` entry point.
- `browser-flow/public/references/` contains phase-scoped policy and contract
  references used by that public instruction.
- `browser-flow/adapters/` wraps the shared entry body for specific hosts such
  as Codex and Claude.
- `browser-flow/package/` defines templates and validation for the installable
  browser-flow skill package.
- `release/` contains files copied to the public release checkout.

`AGENTS.md` describes how agents should work inside this source repository.
`CLAUDE.md` and tool-local command files describe a host's local behavior after
installation. The files in this directory are the cross-runtime source used to
generate those public/installable views.
