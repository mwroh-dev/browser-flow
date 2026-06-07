# Capture & Knowledge Design Semantics

Design principles for the capture phase and the `knowledge/` data model.
Each section states the principle, the failure that surfaced it, and the
effect on the system. Source references cite the lessons date where natural.

---

## Knowledge Graph Cardinality: pageKey, flow, snapshot

**Principle.** The durable knowledge unit is the *page node*, keyed by
`pageKey` (structural identity of a page). A *flow* is a traversal across
the page-node graph — it is NOT a separate storage unit. A *snapshot* is
a time-series entry on a page node. Storage grows as O(|unique pages|),
not O(|flows|).

**Origin.** [2026-05-19] Cost estimation assumed flow × page = 1:1; actual
cardinality is N flows : 1 page-node → estimates were N× too high.

**Effect.** Any new `knowledge/` artifact must declare: "dedup key = X;
cardinality = Y per X." Without this constraint, cost and storage estimates
drift back to the wrong model.

---

## Framework-Volatile Selectors: Capture Semantic, Not Hash

**Principle.** CSS-in-JS and framework-generated selectors (`.mat-mdc-X`,
`#mat-input-N`) are unstable across framework versions and render cycles.
The page-node must store *semantic* selectors (XPath, ARIA role, visible
text) — never framework hash IDs.

**Origin.** [2026-05-21] Unstable Material Design selectors caused
non-deterministic locator failures; the page-node stored hash IDs that
changed between renders.

**Effect.** Selector resilience is structural, not retry-based. Capturing
the wrong selector class means no amount of retrying recovers correctness.
See also: **Selector Versioning Context** below.

---

## Selector Versioning Context

**Principle.** When a page's selector generation depends on a framework
version (Material Design, React, Angular), record the framework version as
part of the page-node's selector metadata. Version skew between capture
and replay is a known drift source.

**Origin.** [2026-05-21] Selector healing revealed that `.mat-mdc-*` IDs
shifted after a library update; no version metadata existed to detect it.

**Effect.** `knowledge/pages/<pageKey>/` mold entries should include
`selectorContext: { framework, version }` where detectable, enabling
drift attribution.

---

## Mold and Snapshot Capture Timing

**Principle.** Page mold (structural template) is captured post-settle,
pre-navigate. Snapshot is captured post-navigate. If the flow navigates
away before the page has settled, the snapshot is incomplete — producing
a false `drift` on the next replay.

**Rule.** Capture must *settle on the data page* — let it finish rendering
before navigating on. This is intentional design, not an incidental delay.

**Origin.** [2026-05-21] Rapid navigate-away yielded
incomplete snapshot; downstream verify flagged spurious drift.

**Effect.** `bf prepare --snapshot-dom` captures DOM state; the capture
agent's settle discipline (see `agents/capture/AGENT.md`) determines whether
that state is complete. Also applies to page-node mold.

---

## Page Settle vs. Transition Timeout

**Principle.** "Transition timeout" errors on large or async pages hide the
real cause: the page has not settled. `domcontentloaded` ≠ ready.
Resolution that fires against an unsettled DOM is non-deterministic.
The fix is a *settle-poll* (network-idle check or custom signal), not a
longer fixed delay.

**Origin.** [2026-05-21] `transitionTimeoutMs`
finger-pointing led to wrong step resolution; retry with settle-check
raised success rate from 0/4 to 3/4.

**Effect.** Capture must emit a "page settled" signal before locator
resolution. See `scripts/observe/` for the readiness-gate design.
Do NOT substitute a fixed `setTimeout`; the settle signal must be
condition-driven.

---

## Transient Failure Enumeration for Retry

**Principle.** The retry whitelist must enumerate *all* failure modes that
share the same root cause (page-not-settled). An incomplete whitelist
produces partial recovery — some modes stop retrying while others still
fire. The list is short and must be explicit.

**Known modes for page-not-settled root:**
1. `ambiguous-locator` — multiple candidates resolve from unsettled DOM
2. `action-path-mismatch` — path-guard rejects a wrong pick caused by DOM
   instability
3. `resolveLocator-no-candidates` — empty result because lazy elements
   have not yet mounted

**Origin.** [2026-05-21] Retry covered modes 1 and 2 only;
mode 3 still failed → 1/4 success. Adding mode 3 → 3/4 success. Missing
mode = silent incomplete recovery.

**Effect.** Any change to resolve logic must re-audit all three modes.
Retry predicates are a whitelist, never a blacklist. See also
`agents/generator/AGENT.md` (action-path guard).

---

## Verification Oracle Fidelity

**Principle.** The golden oracle used at verify time must match the one
generated at capture time, exactly. Capture produces the first golden;
verify replays against it. Any mismatch signals either drift (page changed)
or a capture-timing artifact (incomplete settle).

**Origin.** [2026-05-20] Stale oracle without re-capture
caused drift to go undetected; "approximately correct" replay was accepted
when it should have been flagged.

**Effect.** Verify phase invariant: (1) capture golden oracle, (2) replay
against golden, (3) exact match = pass. Approximate or cached oracles are
not acceptable. See `agents/verifier/AGENT.md`.
