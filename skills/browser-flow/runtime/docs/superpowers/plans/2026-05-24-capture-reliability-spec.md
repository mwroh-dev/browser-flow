# Capture Reliability — Design Spec

> **Status:** SPEC (design-level). Not yet decomposed into granular TDD task plans.
> Approval gate: review before any code. This touches **shared CDP capture infra
> that every e2e depends on** — and the author regressed it twice already (see
> Risks). Per-phase granular plans + a measured flake-rate gate follow approval.

**Goal:** Eliminate the capture-timing flake (`verify-breadth-enrichment` ~50%
under full suite; B1 e2e 1/3) by replacing the fixed `sleep(200ms)`-after-
navigation with a **condition-based readiness gate** bound to the navigation's
`loaderId` (an epoch guard), so a capture (a) waits until the page is actually
ready and (b) is never attributed to the wrong document.

**Architecture:** The daemon's two `Page.frameNavigated` capture handlers
(snapshot + affordance-skeleton) currently do `await delay(200)` then capture
fire-and-forget. Replace that with: **bind to `frame.loaderId` → await a readiness
gate (load → network-idle → [DOM-quiet]) → epoch-guard before writing → `/done`
drains pending captures.** `loaderId` is the natural generation token: it already
flows through `frameNavigated`, `Page.lifecycleEvent` (via `lifecycle.getEventsFor`),
and every `Network.*` event.

**Tech Stack:** Node ESM, CDP (`chrome-remote-interface`), the existing
`lifecycle`/`network` watchdogs + in-page recorder script. `node:test`. No new deps.

**Research basis** (see `tasks/lessons.md` 2026-05-24 + the deploy-research):
Luo et al. FSE 2014 (async-wait = 45% of flaky → condition waits, not sleeps);
Playwright `frames.ts` networkidle (in-flight==0 for 500ms); CDP `Page.lifecycleEvent`
(`load`/`networkIdle`/`networkAlmostIdle`); MutationObserver debounce (DOM quiescence);
Crawljax / Mesbah TWEB 2012 (DOM edit-distance for "new stable state"); generation
token + AbortController (WHATWG) for capture↔navigation race.

---

## 1. Locked Design Decisions

### ① `loaderId` is the epoch token (the missing piece from the 2 prior regressions)
Every capture binds to the `loaderId` from its triggering `Page.frameNavigated`.
Before appending to `snapshotEntries`/`skeletonEntries`, it verifies that
`loaderId` is still the **latest** navigation for that target; if a newer
navigation has occurred, the capture is **stale → discarded** (not written under
the old URL). This is the exact fix for the cross-navigation contamination that
made the author's adaptive-poll attempts regress: a slow capture is now SAFE
because it can only ever write for its own document.

### ② Readiness gate replaces `delay(200)` — ordered AND of signals
```
PHASE 1  load        — lifecycle.getEventsFor(targetId) has {loaderId, name:"load"}   (required)
PHASE 2  network-idle — in-flight requests == 0 sustained 500ms (≤2 fallback for SSE/WS) (Plan B)
PHASE 3  dom-quiet    — MutationObserver: no mutations for 300ms                          (Plan C)
hard timeout 10s → best-effort capture + log "incomplete" (never silently drop)
```
Phases are added incrementally (Plans A→C). Plan A ships PHASE 1 + epoch guard +
drain — enough to fix the static-page flake. Plans B/C harden dynamic/SPA pages.

### ③ `/done` drains in-flight captures
Track each capture promise in `pendingCaptures[]`; `/done` does
`await Promise.allSettled(pendingCaptures)` before writing the manifests. Combined
with the epoch guard, late captures land correctly instead of racing the write.

### ④ Reuse, don't rebuild
`lifecycle.getEventsFor(targetId)` already exposes `{loaderId, name}` events — PHASE 1
is a query, not new plumbing. The network watchdog already sees every request/
response — PHASE 2 adds an in-flight counter to it. The recorder script already
injects in-page — PHASE 3 adds a MutationObserver there.

---

## 2. Constitution Compliance Map

| Principle | How this design satisfies it |
|-----------|------------------------------|
| `evaluation-before-implementation` | The flake-rate metric + acceptance gate (§5) is defined BEFORE code. A phase ships only if it provably lowers (never raises) the measured flake rate. |
| `harness-hill-climbing` | One signal per plan (A: load+epoch, B: networkidle, C: dom-quiet). One change → measure → attribute. The author's regressions came from bundling an unguarded poll; this isolates changes. |
| `code-over-prompt` | The gate is deterministic CDP/JS — zero model calls. |
| `direction-maintenance` + `failure-logging-anti-survivorship` | On timeout, capture best-effort AND log the incomplete condition (loaderId, which phase stalled) — never a silent partial capture. |
| `schema-valid-not-runtime-executable` (analog) | "Execution-based confirmation": a capture is taken only after a real readiness SIGNAL, not an assumed delay. |
| `multi-layered-safety-via-code` | Hard 10s timeout is a code-level backstop against pathological pages (persistent SSE/WS that never idle). |
| `constraint-hierarchy-over-accumulation` | One always-on invariant (epoch guard); the rest are positive readiness signals, not accumulated prohibitions. |
| `atomic-commit-traceability` | Phased; each plan independently verifiable + reversible (single-file-ish, measurable). |

---

## 3. Interfaces (what each watchdog must expose)

### lifecycle.mjs (PHASE 1) — already sufficient
`getEventsFor(targetId) → {name, loaderId, timestamp}[]` exists. A capture checks:
`events.some(e => e.loaderId === myLoaderId && e.name === "load")`. **No change needed**
(optionally add a `waitForLifecycle(targetId, loaderId, name, timeoutMs)` helper to
avoid hand-rolled polling in the daemon).

### network.mjs (PHASE 2) — add in-flight tracking + idle query
```jsonc
// new exposed surface on the NetworkWatchdog return:
{
  inflightCount(): number,                  // requestWillBeSent ++ ; loadingFinished|loadingFailed --
  whenIdle(opts?: { threshold?: 0|2, quietMs?: 500, timeoutMs?: 10000 }): Promise<boolean>
}
```
Must also listen to `Network.loadingFailed` (currently only `loadingFinished`) so
failed requests decrement the counter. `threshold:2` (networkAlmostIdle) is the
SSE/WebSocket fallback (real sites like Keep/NotebookLM hold persistent
connections — CDP issue #154: `networkIdle` never fires there).

### recorder-script.mjs (PHASE 3) — add MutationObserver quiet signal
In-page: a `MutationObserver(subtree+childList+attributes)` with a debounce timer;
when no mutations for `DEBOUNCE_MS` (300), report quiescence via a binding
(`__browserFlowDomQuiet({ loaderId, quietAt })`). The daemon resolves PHASE 3 on
that signal. **Constraint:** the recorder script is a `String.raw` template — NO
backticks / `${` inside (incl. comments) — see lessons 2026-05-23.

### observer-daemon.mjs — the orchestration change (both handlers + done)
```
const capture = (async () => {
  const myLoaderId = params.frame.loaderId;
  await readinessGate(targetId, myLoaderId, { phases });   // load [∧ networkidle ∧ domquiet], 10s cap
  if (!isLatestLoader(targetId, myLoaderId)) return;        // EPOCH GUARD — stale → discard
  const html/skeleton = capture(...);                        // enumerate the RIGHT document
  if (!isLatestLoader(targetId, myLoaderId)) return;         // re-check after async enumerate
  entries.push({ ... });
})();
pendingCaptures.push(capture);
// in /done, before manifest writes:
await Promise.allSettled(pendingCaptures);
```
`isLatestLoader` = the most recent `frameNavigated` loaderId for that target
(track `latestLoaderByTarget`).

---

## 4. File Structure

| Path | Plan | Change |
|------|------|--------|
| `scripts/observe/observer-daemon.mjs` | A | epoch guard (`latestLoaderByTarget`), readiness gate call (replace both `delay(200)`), `pendingCaptures` + drain in `/done` |
| `scripts/cdp/watchdogs/lifecycle.mjs` | A | (optional) add `waitForLifecycle(targetId, loaderId, name, timeoutMs)` helper |
| `scripts/observe/readiness-gate.mjs` | A | NEW — pure-ish `readinessGate(deps, targetId, loaderId, opts)` composing the phase signals + timeout (testable with stubbed deps) |
| `scripts/cdp/watchdogs/network.mjs` | B | in-flight counter + `loadingFailed` + `inflightCount()`/`whenIdle()` |
| `scripts/observe/recorder-script.mjs` | C | in-page MutationObserver + `__browserFlowDomQuiet` binding |
| `tests/observe/readiness-gate.test.mjs` | A | unit-test the gate logic with stubbed signals (load present/absent, stale loaderId, timeout) |
| `tests/cdp/watchdogs/network-idle.test.mjs` | B | in-flight counter + whenIdle unit tests |

The gate's **decision logic** is extracted to `readiness-gate.mjs` so it is unit-
testable WITHOUT a browser (inject fake "events"/"inflight" sources). The browser-
dependent wiring stays thin in the daemon. This keeps the regression-prone part
(timing logic) under deterministic test, addressing the "can't unit-test browser
timing" gap that hid the original bug.

---

## 5. Verification Strategy (the load-bearing section — author regressed twice)

**Baseline first (before any change):** measure the current flake rate.
- `verify-breadth-enrichment` isolated ×10 and full-suite ×5 → record pass/total.
- This is the control. Acceptance is defined relative to it.

**Per-phase acceptance gate (a phase ships ONLY if all hold):**
1. New gate unit tests pass (deterministic, no browser).
2. `verify-breadth-enrichment` isolated **10/10** (was 8/8 before any change; must not drop).
3. `verify-breadth-enrichment` full-suite flake rate **≤ baseline** across ×5 runs (target: → 0).
4. `npx tsc --noEmit` 0 errors.
5. No NEW failures elsewhere in the full suite across the ×5 runs.

**If a phase raises the flake rate (as both prior attempts did): revert immediately**
(`git checkout`), record why in lessons, do not iterate on the broken approach.

**Measurement harness:** a throwaway loop (`for i in $(seq 10); do node --test <file>; done`)
counting pass/fail — NOT a single run (1 pass is meaningless for a flaky test;
lessons 2026-05-24).

**Golden eval cases (dual-polarity) for the gate unit tests:**
- Golden: load-present + latest loaderId → capture proceeds.
- Golden: load arrives after 1s → gate waits then proceeds (no fixed-sleep miss).
- Red: a newer loaderId arrived → stale capture discarded (epoch guard).
- Red: load never fires (10s) → timeout → best-effort + incomplete-logged.
- Red (B): persistent SSE keeps 5 in-flight → networkAlmostIdle(≤2) fallback prevents infinite stall.

---

## 6. Decomposition (phased plans — build + measure in order)

| Plan | Scope | Fixes | Risk |
|------|-------|-------|------|
| **A** (do first) | epoch guard + wait-for-`load` + `/done` drain + `readiness-gate.mjs` (PHASE 1 only) | static-page flake (breadth, catalog) — the observed failures | low-med (shared infra, but PHASE 1 is a strict improvement over a blind 200ms) |
| **B** | native networkidle in network.mjs + add PHASE 2 to gate | dynamic/XHR pages; SSE/WS via ≤2 fallback | med |
| **C** | MutationObserver DOM-quiet in recorder + PHASE 3 | SPA route changes (no network after bundle) | med (in-page String.raw care) |
| **D** (optional/later) | `requestIdleCallback` paint-flush + Crawljax DOM edit-distance (reusable for golden-probe drift) | precision; visual-stability captures | low value now |

Plan A alone is expected to resolve the known flakes (the failing pages are static,
reached by click-navigation — `load` + epoch guard covers them). B/C are hardening
for the real-site dynamic cases. Stop after A if measurement shows the flake gone,
and reassess B/C against real-site captures.

---

## 7. Risks

- **R1 — Shared-infra blast radius:** both `frameNavigated` handlers feed EVERY
  capture; every e2e depends on them. Mitigation: PHASE-1-only Plan A, gate logic
  unit-tested in isolation, measured flake gate (§5), immediate revert on regression.
- **R2 — Author has regressed this twice** (adaptive poll, await-on-done+poll) by
  omitting the epoch guard. This spec makes the epoch guard the FIRST, always-on
  invariant — the specific missing piece. Do not add settle-lengthening without it.
- **R3 — `networkIdle`/`load` may not fire** on pathological pages (CDP #154,
  persistent connections). Mitigation: hard 10s timeout + best-effort + ≤2 fallback.
- **R4 — Capture latency increase:** waiting for `load` (vs 200ms) lengthens each
  capture. Bounded by the 10s cap; acceptable for correctness. Measure suite
  wall-time delta; if egregious, tune per-phase timeouts.

## 8. Handoff

On approval, expand **Plan A** to granular TDD (writing-plans format): baseline
measurement → `readiness-gate.mjs` + unit tests → daemon wiring (epoch guard +
gate + drain) → measured acceptance gate → commit. Do not start B/C until A's
flake-rate gate passes (`harness-hill-climbing`).

---

## 9. EMPIRICAL FINDINGS & REVISED DIRECTION (2026-05-24 Plan-A attempt)

Plan A was attempted and **reverted** (daemon left at known-good). The measured
acceptance gate (breadth isolated ×10) caught **4 distinct regressions**, each
revealing a deeper layer. Recorded so the next attempt does not repeat them.

**Baseline measured:** breadth isolated 9/10 (flake fires ~10% even unloaded;
full-suite ~40% from session history).

**What was tried and what each revealed (all via the daemon's `frameNavigated`
capture handlers + the `readiness-gate`):**
1. **epoch guard + post-enumerate discard + drain → 0/10.** Probe showed the
   docs drive churns through 3 loaderIds (root→catalog→detail→detail-again). The
   "discard if superseded" guard threw away the *valid* catalog capture because
   `latest` had moved to detail by write-time. **→ Decision ① (epoch discard) is
   WRONG for drive-capture:** breadth/snapshot INTENTIONALLY records intermediate
   pages the drive leaves. Discard is right only for single-settle-page (scraping).
2. **load-wait, no discard, no drain → 1/10.** `skeleton-manifest.json` was not
   written: captures are fire-and-forget; load-wait makes them slower than the old
   200ms, so `/done` raced them. The old 200ms "worked" 9/10 only by usually
   beating `/done`.
3. **load-wait + drain, no discard → 0/10.** Manifest now written, but contained
   **only the FIRST navigation (docs root)**; catalog/detail enumerates returned
   **empty** (`__bfAffordanceSkeleton()` = []). The intermediate captures' enumerate
   ran *after the drive had already navigated away* → blank/transitional page.

**Root insight (supersedes the §1 design):** this is **not a timing bug fixable by
a host-side wait.** It is the *"can't capture a page you have already left"*
problem. The host (daemon) observes `frameNavigated`, then asynchronously calls
back into the page to enumerate — but the drive can navigate away in that gap, and
waiting longer (for `load`) only widens the gap. The 200ms "works" ~90% only
because it occasionally lands inside the page's brief dwell window.

**Revised design direction (for the next attempt):** **in-page self-capture.** The
page must capture ITS OWN affordance skeleton / DOM at its own `load` (or a
MutationObserver-quiesce) event, from inside the page, and PUSH it to the host via
a binding (`__browserFlowRecord`-style) — synchronously with being loaded, before
the host can race a navigation. This eliminates the host-side round-trip gap
entirely. The recorder script (`recorder-script.mjs`) already injects in-page and
has a binding channel; the skeleton/snapshot capture should move there. The
host-side `readiness-gate.mjs` (waitForLoad) is NOT the right tool for drive-capture
and is left unmerged.

**Status:** daemon reverted to known-good; `readiness-gate.mjs` + tests + this spec
exist on branch `feat/capture-reliability` (unmerged). The flake remains a known
pre-existing limitation — it does NOT affect the deployable scraping path (which
uses post-replay `bf extract` on captured snapshots, with the documented
"settle on the data page" usage note).
