# Phase 90 (Scored Resolver P1) — Signal Capture Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Run single test files with `node --test --import=./tests/_setup.mjs <file>`. Real-Chrome e2e: hard timeout + zombie-kill + `rm -f profiles/*/Singleton* profiles/*/RunningChromeVersion`. In-page strings in `locator-capture.mjs` use NO backtick/`${` (String.raw discipline). Test helpers/arrow params need JSDoc types (strict checkJs).

**Goal:** Expand the captured per-element locator fingerprint with the signals the scored resolver (P2) needs — `href`, `neighborTexts`, `cleanId` (dynamic-id-filtered), `type`, `alt` — all sanitized (agent-blind). This is capture-side only; the scorer that consumes them is P2.

**Architecture:** The recorder already assembles the locator `{role,name,structuralKey,elementKey,relXPath,box,viewport}` per click/fill at `recorder-script.mjs:172-180` using in-page `__bf*` helpers from `locator-capture.mjs`. Add in-page helpers (`__bfIsDynamicId`, `__bfNeighborTexts`, attribute reads) + a Node mirror `isDynamicId` (twin of `filterDynamicClasses`), extend the assembled locator, extend the Zod `LocatorShape` (additive-optional), and extend `sanitizeLocator` to redact the new text signals.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test`, TS strict checkJs. No new deps, no LLM. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-scored-resolver-design.md` §3(a), §2.2.

---

## Decisions locked (from spec)
1. Capture **raw** signal values in P1; **stability tiering + weights live in the P2 scorer** (don't store per-signal stability now — derive at scoring time from signal type + heuristics). Keeps the locator shape simple.
2. `cleanId` = the element id IF not dynamic, else `""` (dynamic-id detection mirrors `filterDynamicClasses`).
3. `neighborTexts` v1 = DOM-proximity text (immediate prev/next siblings + parent's own direct text), length-capped, sanitized. (Visual-rectangle proximity = later.)
4. agent-blind: `neighborTexts`/`alt` redacted through the existing locator sanitize boundary; `href` through `sanitizeUrl`.

## File Structure
- `scripts/lib/structural-fp.mjs` — add `isDynamicId(id)` (Node) mirroring the `DYNAMIC_RE` heuristic.
- `scripts/observe/locator-capture.mjs` — add in-page `__bfIsDynamicId`, `__bfNeighborTexts` (NO backtick/`${`).
- `scripts/observe/recorder-script.mjs` — extend the locator object (~line 178) with `href`, `neighborTexts`, `cleanId`, `type`, `alt`.
- `scripts/lib/schemas.mjs` — extend `LocatorShape` (additive-optional fields).
- `scripts/sanitize/event-sanitizer.mjs` — extend `sanitizeLocator` to redact `neighborTexts`/`alt` + `sanitizeUrl(href)`.
- Tests: `tests/lib/structural-fp.test.mjs` (add), `tests/sanitize/event-sanitizer.test.mjs` (add), `tests/observe/locator-capture.test.mjs` (syntax), `tests/e2e/verify-signal-capture.test.mjs` (new), `tasks/phases/phase-90-resolver-signal-capture.md`.

---

## Task 90.1: dynamic-id detection (Node mirror + in-page)
**Files:** `scripts/lib/structural-fp.mjs`, `scripts/observe/locator-capture.mjs`; Test `tests/lib/structural-fp.test.mjs`

- [ ] **Failing test** (add to `tests/lib/structural-fp.test.mjs`):
```js
import { isDynamicId } from "../../scripts/lib/structural-fp.mjs";
test("isDynamicId flags auto-generated ids, keeps semantic ones", () => {
  for (const id of ["mwAtQ", "mwDw", "ember123", ":r1a:", "radix-:R2:", "a1b2c3d4e5"]) assert.equal(isDynamicId(id), true, id);
  for (const id of ["firstHeading", "search", "p-search", "main-content", "submit-btn"]) assert.equal(isDynamicId(id), false, id);
  assert.equal(isDynamicId(""), false);
});
```
- [ ] **Implement** `isDynamicId` in `structural-fp.mjs` — a heuristic regex for auto-generated ids: MediaWiki `^mw[A-Za-z0-9]+$`, Ember `^ember\d+$`, React/Radix `:r.*:`/`:R.*:`, long opaque token `^[a-z0-9]{8,}$` / hex-ish, framework prefixes. Return false for empty/semantic. Keep it conservative (only flag clearly-generated). Export it. (Mirror the `filterDynamicClasses`/`DYNAMIC_RE` style; you may compose a `DYNAMIC_ID_RE`.)
- [ ] **In-page mirror**: add `__bfIsDynamicId(id)` to `locator-capture.mjs`'s `locatorCaptureSource` with the SAME logic (string-concat, no backtick/`${`). Add a note that it must stay equivalent to the Node `isDynamicId` (like the structuralKey twin).
- [ ] Run: `node --test --import=./tests/_setup.mjs tests/lib/structural-fp.test.mjs` → pass. `npm run check` GREEN. Commit `phase 90: isDynamicId detection (Node + in-page mirror)`.

## Task 90.2: in-page neighbor-text + attribute helpers
**Files:** `scripts/observe/locator-capture.mjs`; syntax verified

- [ ] Add to `locatorCaptureSource` (NO backtick/`${`; `var`/string-concat; mirror existing `__bf*` style):
  - `__bfNeighborTexts(el)` → returns an array of short visible-text strings from DOM-proximity: immediate previousElementSibling + nextElementSibling innerText, + the element's parent's *own* direct text-node text (not full subtree), each `.replace(/\s+/g," ").trim().slice(0, 60)`, drop empties, cap the array length (e.g. 6). Read-only enumeration.
  - (href/cleanId/type/alt are simple attribute reads — done inline in 90.3, no helper needed, EXCEPT cleanId uses `__bfIsDynamicId`.)
- [ ] Verify the injected script still parses + the new fn is present:
  `node -e "import('./scripts/observe/locator-capture.mjs').then(m=>{ new Function(m.locatorCaptureSource); console.log('SYNTAX OK'); })"` → SYNTAX OK; `grep -c "__bfNeighborTexts\|__bfIsDynamicId" scripts/observe/locator-capture.mjs`.
- [ ] `npm run check` GREEN (locator-equivalence tests must still pass — you ADDED functions, didn't change existing ones). Commit `phase 90: in-page __bfNeighborTexts helper`.

## Task 90.3: recorder assembles the new signals
**Files:** `scripts/observe/recorder-script.mjs`

- [ ] Read `recorder-script.mjs` around the locator assembly (~line 172-180, the `{ role, name, structuralKey, elementKey, relXPath, box, viewport }` object). Confirm its injection form + that `__bfIsDynamicId`/`__bfNeighborTexts`/`__bfComputedName` are in scope (same injected `locatorCaptureSource`).
- [ ] Extend the assembled locator object with:
```
href: (el.getAttribute("href") || ""),
neighborTexts: __bfNeighborTexts(el),
cleanId: (el.id && !__bfIsDynamicId(el.id)) ? el.id : "",
type: (el.getAttribute("type") || ""),
alt: (el.getAttribute("alt") || "")
```
  (Match recorder-script's exact string/JS style. `href` raw here — normalization/sanitize happens in 90.4. Keep empty-string defaults so the shape is stable.)
- [ ] Verify recorder-script still parses (`node --check` or import). `npm run check` GREEN. Commit `phase 90: recorder captures href/neighborTexts/cleanId/type/alt on the locator`.

## Task 90.4: schema + sanitize the new signals (agent-blind)
**Files:** `scripts/lib/schemas.mjs`, `scripts/sanitize/event-sanitizer.mjs`; Test `tests/sanitize/event-sanitizer.test.mjs`

- [ ] `schemas.mjs` `LocatorShape`: add `href: z.string().optional()`, `neighborTexts: z.array(z.string()).optional()`, `cleanId: z.string().optional()`, `type: z.string().optional()`, `alt: z.string().optional()`. (Additive — older locators still parse.)
- [ ] **Failing test** (add to `tests/sanitize/event-sanitizer.test.mjs`, match its style): a captured event whose `locator` has `neighborTexts: ["letmein secret"]`, `alt: "tok_abcdef123456"`, `href: "https://x.com/p?token=SECRET"`, `name: "<forbidden>"` → after `sanitizeLocator`/event-sanitize, the secret-bearing text is redacted (neighborTexts/alt run through the same redaction as `name`; href through `sanitizeUrl`). Assert no raw secret remains.
- [ ] **Implement** in `event-sanitizer.mjs` `sanitizeLocator` (the fn that already redacts `locator.name`): extend to also map `neighborTexts` (redact each string like name), `alt` (like name), `href` (`sanitizeUrl(href)`). Keep `structuralKey`/`cleanId`/`type`/`role` as-is (structural; cleanId already dynamic-filtered, type/role are enums-ish). Mirror the existing name-redaction call.
- [ ] Run the sanitize test → pass. `npm run check` GREEN. Commit `phase 90: schema + agent-blind sanitize for new locator signals`.

## Task 90.5: capture e2e + doc + governance
**Files:** Test `tests/e2e/verify-signal-capture.test.mjs`; `tasks/phases/phase-90-resolver-signal-capture.md`

- [ ] **e2e** (`{ timeout: 90000 }`, zombie-kill + Singleton cleanup). Use a fixture page (extend an existing fixture OR add a small `signals` fixture in site-server.mjs) containing an element with: a stable id + a dynamic-looking id sibling, an `<a href>`, an `<input type alt>`, and neighbor text. Drive a capture (prepare→drive→done→analyze) clicking that element → read the compiled `workflow.json` step.locator and assert it carries: `href` (non-empty), `neighborTexts` (non-empty array incl. a known neighbor word), `cleanId` (= the stable id; "" if the clicked element's id is dynamic), `type`/`alt` as expected. (Model the capture/drive on `tests/e2e/full-loop.test.mjs` + the demo-driver.)
- [ ] **Governance**: constraint review last @86 (next @91 > 90 → none); eval audit last @82 (next @92 > 90 → none). `npm run validate-skill` PASS. No gate. (NOTE: P2 = phase 91 will hit the constraint-review gate; P3 = phase 92 the eval-audit gate — flag in those plans.)
- [ ] **Phase doc** `tasks/phases/phase-90-resolver-signal-capture.md`: quote spec §3(a) + the user signal-coverage quote (paraphrase 금지); document the added signals, dynamic-id detection, neighbor-text v1 (DOM proximity), agent-blind sanitize, raw-capture/stability-deferred-to-P2, builds-on, what P2 consumes.
- [ ] `npm run check` GREEN. Commit `phase 90: signal-capture e2e + doc`.

---

## Self-Review
- **Spec coverage:** §3(a) signal expansion → 90.1-90.4 ✓ (href/neighborTexts/cleanId/type/alt); §2.4 agent-blind → 90.4 sanitize ✓; dynamic-id detection (caveat) → 90.1 ✓. Stability-meta deferred to P2 (decision §1, documented).
- **Placeholder scan:** 90.1/90.4 ship code+tests; 90.2/90.3 reference the in-page string style + the exact assembly site (recorder-script:178) with concrete fields — the neighbor-text "proximity definition" is the one judgment call (flagged, v1 = DOM siblings + parent direct text).
- **Type consistency:** new locator fields `href:string, neighborTexts:string[], cleanId:string, type:string, alt:string` consistent across recorder assembly (90.3) → schema (90.4) → sanitize (90.4) → P2 scorer (consumes). `isDynamicId` Node + `__bfIsDynamicId` in-page kept equivalent (twin, like structuralKey).
- **agent-blind:** neighborTexts/alt redacted like name; href via sanitizeUrl (90.4 test asserts no raw secret).
- **String.raw discipline:** 90.2 in-page helpers no backtick/`${` (syntax-checked).
- **Governance:** none at 90; P2(91)=constraint review, P3(92)=eval audit flagged.

## Execution Handoff
Subagent-driven. 90.1 (isDynamicId, pure + in-page twin) + 90.4 (schema+sanitize) → fresh subagents. 90.2 (in-page helper, String.raw discipline) careful. 90.3 (recorder assembly) standard. Controller runs 90.5 (real Chrome). After P1: P2 = deterministic coverage-aware scorer (signal-similarity + resolver-score + resolveLocator replacement + same-name fixture + threshold calibration) — the core, and a constraint-review phase (91).
