# Engineering Log — Browser Flow

How this project was actually built: the arc, and — more usefully — the points
where the roadmap *bent*. This is an engineering log, not a changelog. The value
is in the pivots: a wall was hit, a root cause was found, the direction changed.

**Browser Flow** is a local-only browser-automation *compiler*: capture a one-time
demo, compile it to a deterministic CDP-direct runner, and replay it forever at
zero token cost — with enough self-knowledge that a model can repair it when the
site changes.

**At a glance:** ~108 phases across 10 epochs · a large `node:test` suite (see `npm run check`) · CDP-direct (zero Playwright at runtime) · `tsc --noEmit` clean ·
30 paper-backed design principles applied as a placement rubric · 4 scraping
value-props (token-0 reuse / composable / cross-flow reuse / self-repair).

> Granular record: `tasks/phases/` (one file per phase) and `tasks/lessons.md`
> (append-only learnings). This log is the curated arc over them.

---

## The Arc — 10 epochs

| # | Epoch | Phases | What it delivered |
|---|-------|--------|-------------------|
| I | Architecture & governance foundation | 0–10 | 5-agent model, layer authority, code-level safety, orchestrator-gated context. |
| II | Schema & artifact formalization | 11–32 | phrase-grep → Zod validation for every artifact; governance + eval-audit cycles. |
| III | Real-site capture attempts | 33–51 | ancestor-chain capture, DOM snapshots, page-node graph, staleness — then hit a wall (gate cascade). |
| IV | Gate relocation | 52–59 | moved fail-closed gates capture-time → persistence-time; real-site capture unblocked. |
| V | Atomic fingerprinting & variables | 60–63 | selector disambiguation, workflow-state machine, interactive variable extraction. |
| VI | CDP-direct migration | 64–72 | full Playwright → CDP-direct; recovered 9 capability axes; runner rewritten. |
| VII | Resolver intelligence & self-healing | 73–89 | layered resolver, drift-aware execution, dependency graph, mold-diff, heal-agent, breadth exploration. |
| VIII | Scored resolution & scope-agent | 90–97 | scored multi-signal resolver, reactive scoring loop, multi-tab, scope-agent (A/B). |
| IX | Data extraction (scraping) | (2026-05-23) | `bf extract` — LLM derives an extractor once, runs deterministically forever; durable configs; self-repair on drift. |
| X | Deploy & knowledge re-homing | (2026-05-24) | AGENTS.md/CLAUDE.md cross-tool wiring (Codex + Claude); lessons re-homed into enforced layers via a confirmed-principle rubric. |

Each epoch is feature → test → debug → fix. The interesting parts are the seams
between them.

---

## Roadmap pivots — where direction changed

Each: **Limitation** (the wall) → **Root cause** (why) → **How it surfaced** (how
we found out) → **Outcome** (what changed).

### 1. Flat workflow → page-node graph (Epoch III, phases 34–39)
- **Limitation:** a flat step-sequence can't express multi-page flows or dedup the
  same page visited twice; a naive cost estimate (100 flows = 400 MB) conflated
  flow-count with page-count.
- **Root cause:** *page identity was never modeled* — capture was step-centric.
- **How it surfaced:** the user's vision kept repeating the same *nouns*
  ("page-unit accumulation", "web of connections"). Treating repeated nouns as a
  **data model** (not a process) revealed page = dedup node, flow = traversal,
  snapshot = time-series.
- **Outcome:** page-as-node (structure-hash identity) → dedup, graph traversal,
  staleness detection. Storage became O(pages), not O(steps).

### 2. Capture-time → persistence-time security gates (Epoch IV, phases 51–54)
- **Limitation:** after ~20 capture phases, real-site capture *still* failed —
  five individually-correct fail-closed gates collectively blocked the primary
  use-case.
- **Root cause:** enforcement sat at capture-time (kills the run) instead of the
  persistence boundary (protects *committed* knowledge). `artifacts/` are
  ephemeral debug; `knowledge/` is what must stay clean.
- **How it surfaced:** Phase 51 fail-close diagnosis → eval audit found the five
  independent gates → the cumulative blast was the real defect, not any one gate.
- **Outcome:** scanning warns (not blocks) on ephemeral artifacts; the
  registry-write gate stays fail-closed. Real-site capture now runs end-to-end.

### 3. Playwright → CDP-direct (Epoch VI, phases 64–72)
- **Limitation:** Playwright's tunnel hid the low-level signal the project needed
  (network events, frame hierarchy, origin boundaries, proxy-auth).
- **Root cause:** Playwright was a *constraint on capability*, not a convenience —
  atomic fingerprinting and breadth traversal need direct CDP.
- **How it surfaced:** the baseline comparison (Playwright codegen) exposed it —
  codegen conflated action with verification and emitted brittle selectors; the
  *noise was the evidence*.
- **Outcome:** full migration — zero Playwright at runtime, 9 capability axes
  recovered, the runner rewritten on a deterministic CDP session lifecycle.

### 4. Single-signal → scored multi-signal resolver (Epochs VII–VIII, phases 81–93)
- **Limitation:** a lone CSS selector matched 70+ elements on real pages; framework
  -volatile IDs / ARIA / text are each fragile alone.
- **Root cause:** the generator captured ancestor-chain + sibling fingerprints but
  *didn't consume them* — it resolved on the selector only.
- **How it surfaced:** "infrastructure ahead of capability" — data was being
  collected but not used; the fix was to consume the signals before scoring them.
- **Outcome:** a layered resolver (selector → ancestor → role → text) with
  coverage-aware scoring and a reactive confidence gate that holds on drift instead
  of mis-clicking.

### 5. "Just a CDP script" → self-healing, composable compiler (Epoch IX, 2026-05-23)
- **Limitation:** an extractor that's just a generated CDP script is undifferentiated
  from hand-written automation — and breaks silently when the page changes.
- **Root cause:** the moat isn't *running* automation (Playwright also runs at zero
  tokens); it's *who maintains it*. Hand-written scripts are write-once-break-often.
- **How it surfaced:** clarifying the value-props against both competitors
  (hand-scripts vs live LLM agents) located the real edge: **maintenance**.
- **Outcome:** scraping built as four props — derive-once/run-forever (token-0),
  composable, cross-flow reuse, and **self-repair** (a golden oracle detects drift;
  a heal-agent re-derives the config or honestly reports `unrepairable`).

### 6. Host-side capture wait → in-page self-capture (Epoch X, 2026-05-24) — *specced, not landed*
- **Limitation:** the affordance/snapshot capture intermittently misses
  intermediate pages (~50% flake under load on `verify-breadth-enrichment`).
- **Root cause:** the host observes a navigation, then *asynchronously* calls back
  into the page to capture — but the drive can navigate away in that gap. You
  cannot capture a page you have already left; waiting *longer* only widens the gap.
- **How it surfaced:** four reverted fix attempts (epoch guard, load-wait,
  load-wait + drain) — each measured against a baseline ×10 flake gate that caught
  the regression immediately; a probe then showed only the first navigation landed.
- **Outcome (designed):** capture must happen *in-page*, at the page's own
  readiness event, pushed via binding — eliminating the host round-trip race.
  Spec: `docs/superpowers/plans/2026-05-24-capture-reliability-spec.md`. The
  host-side approach was reverted; the daemon stays known-good.

### 7. Create KB entries → re-home into enforced layers (Epoch X, 2026-05-24)
- **Limitation:** durable insights lived in `tasks/lessons.md` — *remembered but
  not enforced*; a rule and a heuristic sat in the same flat notes.
- **Root cause:** a lesson is reference-only. A rule belongs in a code gate or
  AGENTS.md; a semantic learning in `knowledge/`; a role refinement in an AGENT.md.
- **How it surfaced:** the initial plan misread the goal (write new KB docs); the
  correction was to use the external KB's confirmed principles as a *classification
  rubric* (the 5-question placement test), not as a write target.
- **Outcome:** product-system insights re-homed into their canonical forms;
  collaboration-process insights kept separately. Inert notes → active structure.

---

## Current limitations (honest)

| Item | State |
|------|-------|
| **Capture-timing flake** (`verify-breadth-enrichment`) | Root-caused; in-page self-capture fix **specced, not landed**. ~10% isolated / ~40% full-suite. Does not affect the scraping deploy path (post-replay snapshots). |
| **Resolver-precision backlog** | morph / anonymous-element / ordinal tie-break resolution and several real-browser e2e proofs are unit-proven but not end-to-end-verified (`tasks/todo.md`). |
| **Composition dependency-graph** | planned (variable subset/reorder safety), not started. |

These are stated plainly because knowing the boundary is part of the engineering —
each is diagnosed, with a derivation path, not an unknown.

---

*Maintained as the curated index over `tasks/phases/` + `tasks/lessons.md`. The
design specs behind each pivot live in `docs/superpowers/{specs,plans}/`.*
