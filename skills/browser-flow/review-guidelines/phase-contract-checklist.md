# Phase Contract Checklist

Use this checklist when reviewing workflow phase references such as
`references/phase-entry-contract.md`.

## Scope

- [ ] The document describes workflow phase entry, not general skill entry.
- [ ] The document owns only phase order, projected views, phase callables, and
  phase transition traces.
- [ ] Phase internals stay in the phase agent document unless they are shared
  transition contracts.
- [ ] Optional operations are not promoted to core phases without an explicit
  workflow ownership decision.

## Principle Alignment

- [ ] The entry prompt only loads this contract; it does not copy the phase
  table.
- [ ] Phase transition instructions use condition -> action -> trace structure
  instead of narrative prose runbooks.
- [ ] Policies referenced by a phase point to their canonical owner document.
- [ ] Runtime-enforced behavior points to the runtime hook or artifact instead
  of being described as prompt-enforced.

## Bloat Guardrail

- [ ] New text answers one of these questions: when does a phase start, what
  context is loaded, what callable runs, or what trace proves completion.
- [ ] If new text explains why a design exists, move it to documentation or a
  review note.
- [ ] If new text defines a reusable policy, move it to `references/*` with one
  canonical owner.
- [ ] If new text defines phase-specific recovery or judgment, move it to the
  phase `agents/*/AGENT.md`.
