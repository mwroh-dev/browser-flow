# Distribution Readiness — dev repo ↔ public bundle separation

**Date:** 2026-05-24
**Status:** design (approved direction, pending user spec review)

## Goal

Make the project distributable as a clean, PII-free public skill bundle **without
compromising the development repository**. The development repo keeps everything
(full history, dev-process scaffolding, validator green); a separate **public
bundle** ships only the principled product surface. Cleanliness is achieved **at
the source** and locked by **hard gates**, so the bundle build is a trivial copy
and regressions are structurally impossible.

## Core philosophy (decided)

1. **Clean at the source, not at bundle time.** The shipping files in the dev repo
   are themselves distilled to their essence (PII-free, no history archaeology,
   only the principle). The bundle does **not** transform/strip during build.
2. **Bundle = dumb allowlist copy.** Because the source is already clean, building
   the bundle is `copy(allowlist)`. No per-build PII stripping, no knowledge
   emptying, no comment rewriting. Single source of truth; dev and bundle never
   diverge.
3. **Hard gates = the executable definition of "distribution-clean."** Instead of
   defining "what is allowed in distribution" in prose, the gates encode it and
   fail the build when violated. The gates run in `npm run check` (dev) and in the
   bundle build, so the dev repo stays clean continuously and future work cannot
   reintroduce the mess.
4. **Distill to substance, delete history.** History-only units (dead guards,
   obsolete checks, redundant tests, archaeological doc sections) are **deleted**,
   not migrated. Survivors keep only the principle (the *why/what*), not the
   provenance stamp (the *when/which-phase*).

## Architecture

```
dev repo (this repo)                     public bundle (dist/)
─────────────────────                    ─────────────────────
everything tracked                       allowlist subset, already-clean
full history, tasks/, .governance(gone)  dist/.git → public GitHub repo clone
validator green                          dumb copy of allowlisted paths
npm run check enforces hard gates        same gates pass by construction
        │                                        ▲
        └──── scripts/publish/build-bundle.mjs ──┘  (copy allowlist → dist/, preserve dist/.git)
```

- `dist/` is **gitignored** in the dev repo. Inside it lives a checkout of the
  public distribution repo (`dist/.git` → public remote).
- Workflow: `node scripts/publish/build-bundle.mjs` → review `git -C dist status`
  → commit in `dist/` → push. **The subfolder is the distribution repo.**
- **Allowlist, not denylist.** Nothing enters `dist/` unless explicitly listed, so
  `profiles/` (cookies), `artifacts/`, `tasks/`, `_temp/` cannot leak by default.

## Component 1 — validate-skill redefinition

`validate-skill.mjs` (553 lines, ~50 checks) accreted three concerns. It is
redefined to **one**: *"is this skill bundle structurally valid for install/use?"*

| Concern | Current checks | Decision |
|---------|----------------|----------|
| ① Skill-bundle structure | required files, AGENT.md sections/order, SKILL.md `surface`, manifest references, prompt.md constitutional invariants, 5-agent projected-view linkage (L31–224) | **KEEP** — validator's proper job |
| ② Behavioral regression guards | grep-asserts that specific scripts implement specific features (Phases 34–58, L229–477) | **TRIAGE** (see criteria below) |
| ③ Dev-process schedule gate | Phase-22 governance gate: phase-count cadence forces periodic reviews; reads `.governance/state.json` + `tasks/phases/` (L482–551) | **REMOVE** + delete `.governance/state.json` |

**Why ③ is removed (not made conditional):** it validates *internal development
progress*, not skill validity; it is the root cause of every dev-only-dir coupling
conflict; the phase-numbered cadence it enforced is over; "conditional" leaves dead
code and confusing sometimes-on behavior.

### ② Triage criteria (the heart — must not become a jumble)

For **each** of the ~25 grep-guards, identify the invariant `I` it asserts and the
file `F` it greps, then decide:

- **DELETE** when any holds:
  - `I` is already covered by a real behavioral test in `tests/` (the grep is
    redundant paranoia).
  - `I` is obsolete (the feature/phase it guarded was superseded or removed).
  - `I` has no behavioral substance (asserts "source text contains string X" where
    X is not a real contract) — **history cruft, delete boldly.**
- **MIGRATE (as a *proper* test)** only when **all** hold:
  - `I` protects a live, current behavioral contract, **and**
  - it is **not** already covered by an existing test, **and**
  - it can be re-expressed as a genuine behavioral test (exercise the behavior,
    assert the outcome).
- **Forbidden:** copying a grep-assert verbatim into `tests/`. A migrated check must
  *earn* its place by testing behavior, not source text. If an invariant is real
  but only checkable by source-grep, reconsider whether it is a contract at all;
  default to DELETE.

The per-guard decision table is produced during execution (Component 6) by
sub-agents cross-referencing each guard against `tests/`.

## Component 2 — Hard gates (executable definition of distribution-clean)

New code-level gates, wired into `npm run check` and the bundle build:

- **`scripts/security/pii-scan.mjs`** — scans the shipping surface for real PII:
  real home paths (`/Users/<name>/…`), real email addresses, real personal names.
  Whitelists synthetic fixtures (`example.com`, `x@y.com`, `/Users/x/…`). Fails on
  any hit.
- **`scripts/security/no-provenance.mjs`** — scans the shipping surface for
  development archaeology: `Phase \d+`, lesson markers `(#\d+ …)`. Fails on any hit.
  **Exceptions:** designated *narrative* docs are exempt (see Gate Exceptions).
- **`allowlist-leak` check** (in build) — asserts `dist/` contains no path outside
  the allowlist (defense against denylist thinking).
- **`bundle-integrity` check** (in build) — runs `npm run check` *inside* `dist/`;
  the bundle must be standalone-valid.

### Gate exceptions

- `docs/ENGINEERING-LOG.md` is the **designated narrative home** for the development
  story; it intentionally references epochs and phase ranges. It is **exempt** from
  `no-provenance`. (If desired later, distill it to epoch names without precise
  phase numbers — out of scope here.)
- `docs/research-applied.md` uses a "changed (phase · commit)" citation format;
  during P2 its phase·commit stamps are **reworded** to plain change descriptions
  rather than blanket-scrubbed, then it too is exempt.
- The gate scripts themselves and any test that asserts the gate's behavior may
  contain the literal pattern strings (whitelisted by path).

## Component 3 — Source distillation (P2)

Bring the shipping surface to pass the gates. Scale measured: ~730 provenance
markers (scripts 312 · tests 215 · docs 110 · .codex 85 · AGENTS 9).

- **PII redact:** the one real-PII hit, `docs/baseline/runner-synthetic.mjs:189`
  (`/Users/cielo-iamdt/…` reportPath), → generic placeholder. (The file is a frozen
  baseline; redacting an irrelevant absolute path does not affect comparison
  integrity, which depends on the runner body, not the host path.)
- **Provenance scrub (원론만):** remove `Phase \d+` / `(#\d+ …)` markers from
  surviving code comments and contract docs, **keeping the principle** (e.g.
  `// Phase 43: parser-backed DOM sanitize…` → `// parser-backed DOM sanitize…`).
  Per-comment judgment, not blind `sed`.
- **History-unit deletion:** delete whole units that exist only as history (handled
  per-component: ② dead guards in C1; redundant/obsolete tests in C5).
- **Knowledge:** **as-is copy.** Committed knowledge is already clean — episodic
  dirs contain only `.gitkeep`, `registry/workflows.json` is reset to empty, and
  `knowledge/pages` / `knowledge/scraping` run-derived data is untracked. No
  emptying transform needed.

## Component 4 — Bundle build system

- **`scripts/publish/build-bundle.mjs`** — reads an allowlist manifest, syncs
  listed paths into `dist/` (preserving `dist/.git`), runs `allowlist-leak` +
  `bundle-integrity`, writes a build stamp. Idempotent; safe to re-run.
- **`scripts/publish/bundle-allowlist.json`** — the declarative allowlist.

### Allowlist (initial)

INCLUDE: `.codex/skills/**` · `scripts/**` (excluding `scripts/publish/**` is
optional — TBD in plan) · `knowledge/**` (committed base) · `tests/**` (post-P3) ·
`AGENTS.md` · `CLAUDE.md` · `README.md` · `package.json` · `package-lock.json` ·
`tsconfig.json` · public docs (`architecture.md`, `patterns-applied.md`,
`research-applied.md`, `baseline-comparison.md`, `capture-semantics.md`,
`ENGINEERING-LOG.md`, `baseline/**`) · a bundle-appropriate `.gitignore`.

EXCLUDE: `tasks/**` · `.governance/**` (removed) · `docs/superpowers/**` ·
`docs/roadmap.md` · `.claude/**` · `profiles/**` · `artifacts/**` · `coverage/**` ·
`node_modules/**` · `_temp/**` · `dist/**`.

### Open items to resolve in the plan
- `js-yaml` is a `devDependency`; confirm whether `scripts/lib/yaml.mjs` uses it at
  runtime. If yes, move to `dependencies` in the bundle's `package.json` (else
  `npm install --production` bundles break).
- `.husky/` + `package.json` `"prepare": "husky"`: include husky (so the public
  repo also runs the gates on pre-commit) vs strip dev tooling. Lean: include, with
  hooks wired to `npm run check`.
- Whether `scripts/publish/**` itself ships in the bundle (the bundle does not need
  to rebuild itself). Lean: exclude.

## Component 5 — Tests distillation (P3)

Apply the same "strip traces, keep 알맹이" principle to `tests/` (139 files):
- DELETE redundant tests (duplicate coverage), obsolete tests (removed features),
  and tests that only restate a deleted guard.
- KEEP the substantive behavioral tests; scrub provenance markers from their
  names/comments (gate-enforced).
- Fold in any ② guards that earned migration (C1) as proper tests here.

## Component 6 — Execution: phased + parallel cheap-model sub-agents

**Phasing (de-risk a large refactor):**
- **P1 — deployable state.** Remove ③ + delete `.governance/state.json`; ② triage;
  `pii-scan` gate + redact the one hit; legacy sweep (`knowledge/pages`, `_temp`);
  bundle skeleton (`build-bundle.mjs` + allowlist + `dist/` gitignore). End state:
  the project builds a clean bundle and `npm run check` is green.
- **P2 — provenance scrub + `no-provenance` gate.** Scrub ~730 markers (with gate
  exceptions), then turn the gate on.
- **P3 — tests audit.** Distill `tests/` to substance.

Each phase is independently verified (`npm run check`) and committed.

**Execution method (per user directive):** the triage/scrub fan-out is delegated to
**parallel, low-cost-model observer sub-agents**, split by search type:
- **simple search** (grep/enumeration, e.g. "list every `Phase \d+` site",
  "every test importing X") → cheap model (haiku).
- **content search/analysis** (judgment, e.g. "does guard G duplicate test T?",
  "is this comment principle or archaeology?") → mid model (sonnet).
The main context keeps only the conclusions (decision tables), not the file dumps.

## Non-goals
- Rewriting the dev repo's history or `tasks/` content (dev-only, never ships).
- Restructuring runtime architecture (CDP-direct, pipeline) — unchanged.
- Distilling `ENGINEERING-LOG.md` to remove phase numbers (it is the narrative home).

## Risks
- **Over-scrubbing** removes useful context → mitigated by per-comment judgment
  (sonnet), not blind `sed`, and by review between phases.
- **Guard mis-triage** drops a real contract → mitigated by the "migrate only if not
  already covered, as a real test" criterion + `npm run check` after each phase.
- **Bundle drift** (dev clean ≠ bundle clean) → impossible by construction: same
  gates run in both; bundle is a dumb copy.
```
