# Checkpoint Contract Checklist

Use this checklist when reviewing checkpoint documentation.

## Contract Shape

Each checkpoint contract should identify:

- [ ] Checkpoint name.
- [ ] Trigger artifact or runtime condition.
- [ ] Result artifact, if any.
- [ ] Review command, if any.
- [ ] Accepted verdicts or user response shape.
- [ ] Where the pipeline resumes after resolution.
- [ ] What the user must be told before a verdict is requested.

## Structure

- [ ] Similar checkpoints use the same field names.
- [ ] Checkpoint contracts are not embedded in phase prose.
- [ ] Long briefing requirements are grouped by checkpoint.
- [ ] Opaque all-candidate prompts are explicitly rejected where user intent
  review is required.

## Ownership

- [ ] The orchestrator owns when to stop and how to communicate the checkpoint.
- [ ] Runtime commands own rendering and applying machine-readable review
  artifacts.
- [ ] Phase agents own the artifact generation that triggers a checkpoint.
