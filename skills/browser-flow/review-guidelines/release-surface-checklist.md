# Release Surface Checklist

Use this checklist when reviewing installed browser-flow skill surfaces.

## Public Surface

- [ ] `browser-flow` remains the only public entry skill.
- [ ] Internal playbooks under `skills/*` are not advertised as top-level entry
  surfaces.
- [ ] Public entry wording stays model-facing and does not expose private
  playbooks as user choices.

## Mechanical Validation Boundary

- [ ] `scripts/validate-skill.mjs` checks files, manifest shape, role metadata,
  command wiring, and schema wiring.
- [ ] `scripts/validate-skill.mjs` does not enforce `prompt.md` policy prose.
- [ ] Tests that read markdown check public packaging boundaries only, not full
  policy wording.

## Runtime Contract

- [ ] Commands exposed in CLI metadata have registry handlers.
- [ ] Artifact schema versions exist for runtime-produced result artifacts.
- [ ] Package-local validation does not depend on host-project adapter files.
