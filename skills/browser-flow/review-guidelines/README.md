# Browser Flow Review Guidelines

These guidelines replace prose-specific validation in `scripts/validate-skill.mjs`.
Use them when reviewing skill, agent, reference, and prompt changes that require
judgment about ownership, readability, or model behavior.

`validate-skill.mjs` is limited to mechanical checks: required files, manifest
shape, role metadata, command registry wiring, and runtime schema wiring. It must
not require specific policy wording in `prompt.md`.

Run a guideline review when a change touches:

- `prompt.md`
- `agents/*/AGENT.md`
- `references/*.md`
- `skills/*/SKILL.md`
- runtime command or artifact contracts that affect model instructions

Recommended review output lives in
`review-guidelines/reports/review-report-template.md`.

Guideline reviews are not build gates by themselves. They are the review contract
for a human or model reviewer to apply before broad prompt or agent-document
changes are accepted.
