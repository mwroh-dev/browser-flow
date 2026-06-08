# Prompt Entry Checklist

Use this checklist when reviewing `prompt.md`.

## Entry Ownership

- [ ] `prompt.md` only declares which context to load for the current intent.
- [ ] `prompt.md` loads the orchestrator projected view at skill entry.
- [ ] `prompt.md` points to the phase-entry contract instead of listing phase
  commands.
- [ ] `prompt.md` tells the model to check the workflow registry before
  recommending recapture.
- [ ] `prompt.md` does not restate policy already owned by `references/*`.
- [ ] `prompt.md` does not restate behavior already owned by phase
  `agents/*/AGENT.md`.
- [ ] `prompt.md` does not contain feature runbooks for compose, extraction,
  promotion, replay healing, or review commands.

## Structure

- [ ] The core capture/analyze/generate/verify pipeline details live outside
  the entry prompt.
- [ ] Optional operations are not numbered as core phases.
- [ ] Checkpoint names may appear, but checkpoint contracts live in a reference
  or owner document.
- [ ] CLI command lists do not appear in `prompt.md`; they live in a reference
  or agent projection.
- [ ] The file stays short enough to act as an entry loader, not a runbook.
- [ ] The prompt does not expose version labels such as `v1` unless the label is
  needed for a user-visible choice.

## Drift Risk

- [ ] A policy has exactly one owner document.
- [ ] The prompt points to the owner rather than copying the policy.
- [ ] Runtime-enforced behavior is not described as prompt-enforced behavior.
- [ ] Public entry wording does not imply internal playbooks are top-level
  entry surfaces.
