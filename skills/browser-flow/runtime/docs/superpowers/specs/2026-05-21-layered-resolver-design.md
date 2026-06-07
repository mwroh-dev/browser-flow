# Layered Element Resolution — Design Spec

**Status:** proposed (user-approved direction: "여러가지 방법을 미리 세팅" — full ladder incl. visual).
**Date:** 2026-05-21
**Motivation:** Phase 80 made capture/replay work on semantic + simple-SPA shapes, but real Google Keep exposed the limit: when an element has unstable CSS classes, no stable id/data-*, and a *computed* (not DOM-attribute) accessible name, our single-track atomic-fp can't re-find it. Worse, some sites give no ARIA and no text at all. No single locator is a master key — so we capture **multiple orthogonal signals per element** and resolve via a **voting fallback ladder**.

## Research basis (web, 2026-05-21)
- **browser-use** (CDP-direct, confirmed from source `browser_use/dom/views.py`): primary locator is a **stable structural hash** = `sha256(parent-tag-path + whitelisted-static-attrs-with-dynamic-classes-filtered + computed AX name)`; fallbacks `element_hash` (all classes), positional `xpath`, standalone `ax_name`, session-only `backendNodeId`, `bounds` (coords).
- **Stagehand**: `Accessibility.getFullAXTree` role+name; caches resolved XPath for deterministic replay.
- **Skyvern**: injects a per-element id + `sha256` structural/text hash; `elementFromPoint` occlusion hit-test; vision only as last resort.
- **Healenium**: weighted LCS DOM-tree match to heal a broken locator after failure.
- **Robula+** (academic): robust *relative* XPath via iterative refinement + fragile-attr blacklist (≫ less brittle than absolute XPath).
- **CDP mechanics:** computed name via `Accessibility.getPartialAXTree({backendNodeId})` (capture) / `Accessibility.queryAXTree({backendNodeId:root, accessibleName, role})` (replay); coords via `DOM.getContentQuads`→centroid→`Input.dispatchMouseEvent` + `DOM.getNodeForLocation` hit-test; visual via `Page.captureScreenshot({clip})` + `pixelmatch` (pure-JS, no native dep) against a *coarse DOM candidate set*. AOM `element.computedName` is abandoned/flagged — do NOT use.

## The fingerprint (captured per click/fill target)
A `locator` object persisted on each `workflow.steps[]` entry (additive; existing `atomicFp` kept as one rung for back-compat):
```
locator: {
  // semantic
  role: string,                 // explicit || implicit
  name: string,                 // computed accessible name (see capture below)
  // structural
  structuralHash: string,       // dynamic-class-filtered (browser-use style)
  elementHash: string,          // strict (all classes) — more precise, more brittle
  relXPath: string,             // Robula+-style relative xpath
  tagPath: string[],            // parent tag chain (for hash recompute + debug)
  // geometric
  box: { cx: number, cy: number, w: number, h: number },   // CSS px, viewport-relative
  viewport: { w: number, h: number, dpr: number },
  // visual (Phase 82)
  shotRef?: string              // path to element PNG crop (capture-only; matched at replay)
}
```

## Capture — how each signal is produced
**Decision: compute signals IN-PAGE in the recorder** (no daemon-side per-click CDP enrichment), to avoid the navigation race (a navigating click destroys the element before a daemon CDP round-trip). The recorder already runs in-page on every click/focusout.
- **name (computed):** enhance `accessibleNameOf` to follow ARIA name precedence in-page: `aria-label` → resolve `aria-labelledby` ids → associated `<label for>`/wrapping `<label>` → `placeholder` → `title` → trimmed text. (Covers Keep's "제목" whether it's an attr, a label, or labelledby — and degrades to text.) Not spec-perfect, but the ladder tolerates misses.
- **role:** `getAttribute("role") || implicitRoleOf` (Phase 80 already emits this).
- **structuralHash / elementHash:** in-page hash over `tagPath + static attrs + name`, with `filterDynamicClasses()` (drop hashed/stateful/animation classes via heuristics: long random tokens, `:hover`/`is-`/`has-` state prefixes, etc.). **The identical hash algorithm runs in-page at BOTH capture and replay** → it lives in one shared in-page-injectable source (like `recorder-script.mjs`), with a Node mirror for unit tests.
- **relXPath:** in-page Robula+-style builder.
- **box/viewport:** `el.getBoundingClientRect()` + `window.innerWidth/Height` + `devicePixelRatio` (in-page; cheap, no race).
- **shotRef (Phase 82):** daemon `Page.captureScreenshot({clip: box*dpr})` best-effort right after the event — **only persists for non-navigating, persistent targets** (timing limit documented).

## Replay — the resolver ladder (`resolveLocator`, vote + fallback)
Try in order; first confident match wins; record `layerUsed` + `confidence`:
1. **Fast path** (unchanged): `data-bf`/`data-testid`/`id`/`name` unique CSS.
2. **Role + computed name:** `Accessibility.queryAXTree({backendNodeId: doc, accessibleName: name, role})` → `backendDOMNodeId`. (Replay page is loaded + stable, so the CDP round-trip is safe here.)
3. **Structural hash:** inject the shared in-page matcher → walk candidates, recompute `structuralHash`, return the unique match (fall to `elementHash` to disambiguate ties).
4. **Relative XPath:** evaluate `relXPath`; accept if unique.
5. **Coordinate + hit-test:** scroll-into-view, re-derive centroid from a fresh box (or restore viewport + use saved box), `DOM.getNodeForLocation(cx,cy)` → confirm the node's hash/role matches before clicking (occlusion guard).
6. **Visual (Phase 82):** screenshot-clip each coarse candidate (by role/tag), `pixelmatch` vs `shotRef`; pick best below a diff threshold. Disambiguator only.

If ≥2 layers agree → high confidence. If only a brittle layer (coords/visual) matches → low confidence → surface to the external agent / verify path.

## Architecture changes
- `recorder-script.mjs`: enhanced name computation, structural-hash + relXPath builders, box/viewport, coords on click. (Shared hash/xpath logic factored so replay injects the same.)
- New `scripts/lib/structural-fp.mjs` + `scripts/lib/rel-xpath.mjs`: Node mirrors of the in-page algorithms (canonical for unit tests; the in-page string must stay byte-equivalent in behavior — covered by an integration test).
- `event-sanitizer.mjs` / `compile.mjs` / `schemas.mjs`: carry the `locator` object through (Phase 79/80 pattern).
- `cdp/locator-resolver.mjs`: the ladder (queryAXTree, in-page hash matcher, xpath, coords+hit-test, visual).
- `cdp/watchdogs/action.mjs`: coordinate click + `Page.captureScreenshot` crop.
- New dep (Phase 82): `pixelmatch` + `pngjs` (pure-JS).
- Runner: use `resolveLocator` (supersedes direct `resolveAtomicFpLocator`, which becomes rung 2-ish).

## Staging (delivers the full ladder, sequenced)
- **Phase 81 — deterministic core ladder:** fingerprint model + computed-name + structural-hash + relative-XPath + coordinate/hit-test. No native deps, no timing race. Solves Keep + covers name-independent cases (structure + coords). Includes the governance **constraint review** (due at phase 81: last review @76, +5).
- **Phase 82 — visual layer:** screenshot capture (with the passive-timing caveat) + `pixelmatch` candidate disambiguation. Completes the full ladder.

## Open decisions (for user review)
1. **Confidence/voting policy:** require ≥2 agreeing layers for "high", else flag? Or first-match-wins with per-layer trust ranking? (Proposed: first-match by ladder order, but cross-check with one more layer when the match is from a brittle rung.)
2. **Structural-hash in-page/Node duplication:** acceptable to maintain the algorithm in two forms (in-page string + Node lib) guarded by an equivalence test? (Proposed: yes — the only way to run the same hash at capture in-page and replay in-page while keeping unit-testability.)
3. **Visual capture timing:** accept that `shotRef` only reliably captures for non-navigating/persistent targets in passive recording? (Proposed: yes — document the limit; visual is a disambiguator, not primary.)

## Out of scope
- LLM/vision-model resolution (we have no runtime LLM; the capture data could feed an external agent, but no model call in our runtime).
- Self-healing baseline-tree storage (Healenium-style) — possible future rung.
