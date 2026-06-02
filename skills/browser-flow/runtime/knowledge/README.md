# Knowledge

Scope: knowledge directory policy. Derived view — layer boundary
authority lives in `AGENTS.md`. For each agent's update strategy, see
`agents/{name}/knowledge-pattern.md`.

Agent-owned semantic knowledge accumulated across runs. Committed to
git — must survive deployments.

## Layout

```
knowledge/
├── orchestrator/
│   ├── episodic/      ← per-run routing decisions (append-only)
│   ├── semantic/      ← routing failure patterns, surface reliability
│   └── meta/          ← pipeline performance across N=5+ runs
├── capture/
│   ├── episodic/      ← per-run capture records
│   └── semantic/      ← fixture-type capture-quality patterns
├── analyzer/
│   ├── episodic/      ← per-run analysis records
│   └── semantic/      ← compilation_patterns (Strategy B, N=3)
├── generator/
│   ├── episodic/      ← per-run generation records
│   └── semantic/      ← generation_patterns (Strategy B, N=3)
├── verifier/
│   ├── episodic/      ← per-run verify records
│   └── semantic/      ← verification_history (Strategy B + prediction-error)
└── registry/
    └── workflows.json ← cross-agent verified-workflow catalog
```

Each `{agent-type}/{episodic,semantic[,meta]}/` directory currently
holds a `.gitkeep`. The placeholders reserve the namespace and commit
the design intent — actual store files will be written once the
agents' knowledge-update loops are implemented per their declared
strategies.

## Semantic file template

When the first real semantic file is written under any
`{agent-type}/semantic/`, copy `knowledge/_template.semantic.md`,
rename it to `<pattern-key>.md`, and fill in the frontmatter + body
sections. The template is the authoritative schema for semantic
file structure: the required frontmatter fields (`version`,
`replaces`, `updated_after_runs`, `prediction_match`) come from
`per-agent-knowledge-patterns` "Common Structure for All Patterns"
and the template documents each field, the allowed values, and the
body-section conventions.

A semantic file that does not declare all four required frontmatter
fields is malformed — the audit surface required by the pattern
(version chaining, supporting-episode traceability, prediction-error
trigger evidence) cannot be reconstructed without them.

## Why these specific directories

- `episodic/` is **append-only** per agent-run. Treated as the
  authoritative "what happened" record for that agent's runs.
- `semantic/` is **mutable** — the agent updates the store per its
  declared strategy (see `agents/{name}/knowledge-pattern.md`).
- `meta/` is unique to the orchestrator: cross-agent coordination
  patterns and pipeline performance summaries (the third knowledge
  layer in `per-agent-knowledge-patterns`).

## Registry — cross-agent

`registry/workflows.json` is intentionally not nested under any single
agent because it is contributed-to by multiple agents and consumed by
the orchestrator:

| Agent | Contribution key | Update strategy |
|-------|------------------|-----------------|
| orchestrator | (reads only — lookup before recommendation) | — |
| analyzer | `compilation_patterns` | Strategy B (N=3) |
| generator | `generation_patterns` | Strategy B (N=3) |
| verifier | `verification_history` | Strategy B + prediction-error |

Moving the registry under `orchestrator/semantic/` would create false
single-agent ownership (purpose-scoped-authority).

## Update Policy

Knowledge is updated by the relevant agent after successful pipeline
phases. The registry write happens via
`scripts/registry/workflow-registry.mjs`. Knowledge is not an episodic
run log — that lives in `artifacts/`, which is gitignored
(`artifact-vs-knowledge`).

## What lives elsewhere

- Episodic run evidence (manifests, sanitized events, reports) →
  `artifacts/runs/<run-id>/` (gitignored).
- Each agent's strategy declaration →
  `agents/{name}/knowledge-pattern.md`.
- Pattern principles backing this layout →
  `docs/patterns-applied.md` entries 11–13.
