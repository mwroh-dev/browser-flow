# Compose Boundary

Compose is a derived-workflow operation, not part of the public entry pipeline.

`compose --run-id <id> --request <task>` builds derived artifacts from one
primary source run. The runtime and composer playbook may identify reusable
segments and fill bounded gaps, but multi-run synthesis is outside this
operation's current boundary.

## Ownership

- The orchestrator owns whether compose is relevant to the user's request.
- `agents/orchestrator/playbooks/composer-agent.md` owns compose-time judgment
  over the projected workflow view.
- Runtime compose modules own deterministic selection, policy hooks, artifact
  writes, generation, and verification.

## Rules

- Compose reads one primary source run.
- Compose does not expose internal playbooks as public entry surfaces.
- The composer sub-agent returns a structured decision artifact only.
- The composer sub-agent does not execute browsers, run shell commands, mutate
  workflow artifacts, or decide safety/security policy.
- Generated derived workflows still pass through normal runtime safety gates and
  replay verification.
