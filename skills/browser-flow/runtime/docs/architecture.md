# Architecture

Scope: derived view of repository structure and command surface.
Source of truth for layer boundaries: `AGENTS.md`. Source of truth for
runtime semantics: `scripts/`. Pattern application map:
`docs/patterns-applied.md`.

## What browser-flow is

A local-only browser workflow compiler. Given one browser demo, it
produces:

- `path.yaml` — the action sequence
- `recipe.yaml` — the intent description
- `runner.mjs` — a runnable CDP-direct replay (uses browser-flow's `scripts/cdp/` layer, no Playwright runtime dep)
- `verification.json` + `security.json` — truthfulness proof

Only `browser-flow` is a public entry surface.
Internal playbooks are agent-owned and are not top-level model entry surfaces.
The source repository keeps canonical runtime and role definitions under
`agents/`, `scripts/`, `knowledge/`, and `surfaces/`. Install-time projections
materialize as `.codex/skills/browser-flow/` for Codex and
`.claude/browser-flow` + `.claude/commands/browser-flow.md` for Claude.
For the `surfaces/` source map, see `surfaces/README.md`.

## Pipeline

The pipeline is a strict serial chain of four phase agents, walked by
the orchestrator role identity. Each phase consumes the previous
phase's artifact, so no lane (parallel) opportunity exists in the
runtime pipeline (`phase-vs-lane-execution`).

```
orchestrator
  → capture:   prepare → [user demo] → done
  → analyzer:  analyze
  → generator: generate
  → verifier:  verify
```

| Step | Acting agent | CLI | What it does |
|------|--------------|-----|--------------|
| prepare | capture | `node scripts/cli.mjs prepare` | Starts Chrome with isolated debug profile, launches observer daemon |
| [demo] | capture | (user action) | User performs the demo in the browser |
| done | capture | `node scripts/cli.mjs done` | Signals daemon to stop, persists sanitized events |
| analyze | analyzer | `node scripts/cli.mjs analyze` | Compiles events into path.yaml + recipe.yaml |
| generate | generator | `node scripts/cli.mjs generate` | Generates CDP-direct runner from path.yaml |
| verify | verifier | `node scripts/cli.mjs verify` | Replays workflow, enforces truthfulness gates |

At each phase entry the LLM loads the projected view declared in the
public `browser-flow` adapters and self-identifies as the phase agent.
There is no JS dispatcher; the work is done by a single LLM
re-anchoring on each phase agent's `AGENT.md` + `openai.yaml` +
phase-specific reference. Private helper playbooks stay agent-owned;
they are runtime mechanics, not additional public entry surfaces.

## Layer Map

```
skills/browser-flow/           ← released/installable package source
  SKILL.md                       skill declaration (surface: repo_skill)
  prompt.md                      LLM instruction set (Pipeline Entry Protocol)
  manifest.json                  routing metadata
  references/                    phase-bound reference materials
  scripts/validate-skill.mjs     package validator
  agents/                        projected phase role identities
  skills/                        generated internal sub-agent wrappers
  runtime/                       self-contained runtime root

surfaces/                      ← source templates for public/installable views
  browser-flow/public/           shared public entry instruction + references
  browser-flow/adapters/         host-specific Codex/Claude wrappers
  browser-flow/package/          installable package templates + validator
  release/                       public release README/HISTORY source

agents/                        ← role identities + private playbooks (definitions only, no .mjs)
  orchestrator/                  entry role; walks the four phase agents
  capture/                       prepare + done lifecycle
  analyzer/                      event compilation
  generator/                     runner generation
  verifier/                      replay verification

scripts/                       ← runtime executable code the agents call
  commands/                      thin CLI dispatch
  cdp/                           CDP-direct layer: client + chrome-binary + session-manager + browser-session + 7 watchdogs + locator-resolver
  observe/                       capture orchestration on CDP layer (recorder-script, observer-daemon, page-evidence)
  sanitize/                      event sanitization
  analyze/                       workflow compilation
  generate/                      runner generation (emits CDP-direct runner.mjs)
  verify/                        replay verification (subprocess delegation to runner.mjs)
  security/                      local-only enforcement, secret scanning
  registry/                      workflow registry writer
  fixtures/                      synthetic / docs / stateful / submit / secret + proxy-server
  lib/                           shared utilities

knowledge/                     ← committed semantic learning
  registry/workflows.json        cross-agent verified-workflow catalog
  {agent-type}/episodic/         per-agent run records (placeholder)
  {agent-type}/semantic/         per-agent learned patterns (placeholder)
  orchestrator/meta/             cross-agent pipeline performance (placeholder)

artifacts/                     ← immutable episodic run evidence (gitignored)
docs/                          ← human-facing rationale (this file, patterns-applied.md)
tests/                         ← test suite
tasks/                         ← session planning and lessons (not runtime)
```

## Security Model

Code-level enforcement (the Hook layer in `multi-layered-safety-via-
code`) is the only deterministic safety mechanism. Prompt instructions
in `prompt.md` are an advisory Role/Rule layer above the hooks.

1. **`scripts/security/local-only.mjs`** — `assertLocalUrl`,
   `assertLocalWorkflow` — blocks non-local targets at every entry
   point (capture, verify).
2. **`scripts/security/scan-artifacts.mjs`** — scans run artifacts
   for leaked secrets, high-entropy tokens, sensitive headers.
3. **`scripts/sanitize/`** — strips raw secrets and session values
   from captured events before persistence.

Per-agent layer mapping lives in each `agents/{name}/AGENT.md` under
`## Safety Layers`.

## Real-Site Authentication Modes

Real-site support separates target scope from credential storage. `--unmasked`
allows external URL/origin capture; it does not allow raw credential material to
be written into run artifacts or durable knowledge.

| User intent | Mode | Where auth lives | Artifact policy |
|---|---|---|---|
| Public page or public data | `public-read` | none | registry stores origin-scoped metadata only |
| Already logged-in browser | `attached-browser` | user's live Chrome profile | no cookie capture; runner attaches to the supplied browser |
| Reusable login session | `keychain-session` | OS keychain, referenced by `sessionRef` | no raw cookie artifacts; session is injected at replay time |
| Flow-specific browser state | `persistent-profile` | named profile directory | profile state stays in the profile directory, not registry/artifacts |
| Save cookies or passwords in files | rejected | n/a | forbidden; use attach, keychain, or profile mode instead |

If a user asks for broad convenience ("do everything", "save the login too"),
the orchestrator must offer the supported secure modes above. It must refuse raw
cookies, passwords, tokens, or session values as file artifacts, even when the
request is explicit. This preserves the invariant that `artifacts/`,
`knowledge/`, and the registry are sanitized surfaces, while still supporting
logged-in workflows through a live browser, OS keychain, or per-flow profile
directory.

## Replay Proof Model

Replay verification must prove the user-visible workflow state, not every
network request that happened near the captured boundary. Proof selection is
therefore layered:

- Locator replay uses replay identity signals. Skeleton summaries are page mold
  evidence only and must not become the source of target identity.
- Stateful visual surfaces are proved by the resolved control state plus a
  rendered surface or resource-family signal.
- Exact network proofs remain valid when they are explicit intent evidence or
  the primary domain proof.
- Analyzer must not add an automatically selected global
  `verification.expectedNetwork` GET on top of a high-confidence
  `stateful-surface-proof` for a layered/rendered surface. That duplicate proof
  can over-constrain truthful CSR/SSR replays.

The verifier semantic record for this rule lives in
`knowledge/verifier/semantic/replay-flake-causes.md`; code-encoded hypothesis
provenance is tracked there with the commits that implemented each rule.

## Validation Status

- Test suite is the single source of truth — run `npm run check` (lint + typecheck + skill-validate + pii/provenance scans + `npm test`).
- Validation runs as part of `npm run check`:
  - `npm run lint` — node syntax check across `scripts/` and `tests/`
  - `npm run typecheck` — TypeScript noEmit
  - `npm run validate-skill` — skill bundle + 5-agent linkage +
    Safety Layers section + openai.yaml schema
  - `npm test` — `node:test` suite, serialized
- Pattern application map: `docs/patterns-applied.md` records which
  confirmed patterns are applied where, with the target phase for any
  remaining gaps.
