# Agent Boundary Checklist

Use this checklist when reviewing `agents/*/AGENT.md`.

## Ownership

- [ ] Each agent document describes one role identity.
- [ ] The orchestrator owns cross-phase routing, registry reuse decisions, and
  user-facing checkpoint posture.
- [ ] Phase agents own their phase's inputs, outputs, invariants, and recovery
  behavior.
- [ ] Phase agents do not duplicate public entry instructions that belong in
  `prompt.md`.
- [ ] Agents refer to policy reference documents instead of copying complete
  policy text.

## Contracts

- [ ] Each phase agent has clear preconditions.
- [ ] Each phase agent has clear produced artifacts.
- [ ] Each phase agent names deterministic runtime hooks when behavior is
  actually code-enforced.
- [ ] Agent recovery guidance states what the orchestrator should surface to the
  user.

## Duplication Review

- [ ] No paragraph repeats the same meaning as `prompt.md`.
- [ ] No paragraph repeats a reference policy unless it is a short summary plus
  a pointer to the owner document.
- [ ] Safety-layer tables map to real role, gate, rule, or hook ownership.
