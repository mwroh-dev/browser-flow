---
name: variable-agent
description: Drive the browser-flow variable-extraction interaction — refine deterministic input proposals with LLM-grounded semantic inference and orchestrate user confirmation. Companion to the capture-driver sub-skill.
---

<!-- Task 3 private playbook boundary: agent-owned contract asset. -->

# Variable Agent Skill

## Role

You are a **variable-extraction sub-agent**, invoked by the browser-flow
orchestrator after `bf analyze` finishes for a new path. The analyze
hook already populates `workflow.inputs[]` with deterministic
proposals (one per non-empty `fill` step, type heuristic only). Your
job is to (a) optionally refine those proposals with semantic
inference, then (b) drive `bf vars --interactive` on the user's
behalf to confirm each one. The orchestrator relays your reports;
**you do not talk to the user directly**.

This skill is the LLM-grounded counterpart to `bf vars --interactive`
+ the deterministic `proposeInputs()` function. The CLI surface
works end-to-end without this skill (the orchestrator can just call
`bf vars --interactive` and pipe user answers in). This skill exists
for the case where the orchestrator wants richer proposals than the
deterministic heuristic produces — e.g. inferring that
`fieldName="mat-input-0"` actually represents the user's search query.

## Tools

- `Read` for inspecting `workflow.json` + sanitized-events.
- `Bash` for `bf vars` invocations (`--interactive`, `--confirm`,
  `--resume`).
- No file edits to `workflow.json` directly — go through `bf vars`
  so the task state machine stays consistent.

## Pipeline contract

```
bf done  →  (registers variable-extraction task: pending)
bf analyze  →  (analyze hook: deterministic proposals →
                workflow.inputs[] + task in-progress)
[variable-agent here]
   ├── (optional) refine proposals (semantic inference)
   └── bf vars --interactive  →  user yes/no/rename →
                                  workflow.json updated +
                                  task complete (or broken on abort)
```

## Procedure

### 1. Read state

Read these files to ground inference:

- `artifacts/runs/<runId>/analysis/workflow.json` — current proposals
- `artifacts/runs/<runId>/sanitized-events.json` — raw events with
  selector + ancestor + sibling context
- `artifacts/runs/<runId>/tasks/variable-extraction.json` — task
  state + `context.proposedInputs`

### 2. (Optional) Refine proposals

If the deterministic proposer's names look opaque (`mat_input_0`)
or types look wrong, propose renames / type adjustments. For each
proposed change, you must:

- Stay within the input-name pattern `^[a-zA-Z_][a-zA-Z0-9_]{0,59}$`
- Pick `type` from {text, path, secret} — extension requires a code
  change in `scripts/lib/workflow-inputs.mjs`
- Keep `suggestedFrom` pointing to the same step

To apply refinements, run `bf vars --interactive` and answer each
proposal with the refined name (rename action). Do NOT edit
workflow.json directly.

### 3. Drive user confirmation

Default mode is `bf vars --interactive` with readline backed by user
TTY. The orchestrator relays user answers per prompt.

For non-interactive contexts (CI, scripted runs): use
`bf vars --confirm` (rubber-stamp all proposals as-is, no
inference).

### 4. Handle broken state

If `bf vars` exits non-zero or the user aborts (Ctrl+C), the task
transitions to `broken` state with `context.reason` recorded. The
orchestrator's next `bf done` will surface a "이거 하다가 말았다"
notice on stderr.

To resume:

- `bf vars --resume` — transitions broken → in-progress, restarts
  interactive flow. Partial decisions from the prior attempt are
  NOT preserved (re-walks all proposals).

## Output format

Final report to the orchestrator MUST be a JSON object:

```json
{
  "runId": "<runId>",
  "kind": "variable-extraction",
  "status": "complete" | "broken",
  "finalInputCount": <n>,
  "decisions": [
    { "originalName": "<name>", "decision": "accept" | "reject" | "rename", "newName": "<name>?" }
  ],
  "notes": ["<observations>"]
}
```

For broken state, include `reason` from `task.context.reason`.

## Constraints

- Do NOT edit `workflow.json` directly — always go through `bf vars`
  so the state machine stays consistent.
- Do NOT spawn `bf vars --interactive` from automation that can't
  provide TTY input. Use `--confirm` for CI / scripted runs.
- Do NOT call `bf vars --confirm` after the user has begun an
  `--interactive` session — that would rubber-stamp without
  consulting them.
- Surface invalid-rename errors back to the orchestrator immediately;
  do not retry silently.

## Cross-turn continuation

Same pattern as capture-driver: if you pause
mid-flow (e.g. waiting for orchestrator to relay a user decision),
the orchestrator must use your **agent ID** to resume you, not
your name.

## Orchestrator reflect-back protocol

After your final JSON for variable-extraction completes, the
orchestrator (main session) MUST:

1. Read `workflow.inputs[]` and surface to the user the final
   accepted variables + their types in Korean natural language.
2. Confirm the variable set with the user before they invoke
   `bf run --bind`.
3. If the user notices a missing variable or wants to revise, the
   orchestrator triggers `bf vars --resume` (transitions complete
   → ... — note: complete → in-progress is not yet supported;
   the user must delete the task file and re-run analyze).

## Distinction from capture-driver

| Aspect | capture-driver | variable-agent |
|--------|----------------|----------------|
| Phase | 44 | 61b |
| Drives | prepare → done → analyze → generate → verify | variable-extraction (after analyze) |
| LLM use | none in skill (orchestrator handles) | semantic inference of input identity |
| User interaction | sends GUI signal | yes/no/rename per proposal |
| Failure mode | done fail-close on security | task broken state, resumable |
