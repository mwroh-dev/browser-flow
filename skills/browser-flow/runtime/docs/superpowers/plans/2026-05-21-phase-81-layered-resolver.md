# Phase 81 — Layered element resolution: deterministic core ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Real-Chrome e2e (81.10/81.11) MUST use a hard `{timeout}` + zombie-kill cleanup; remove `profiles/*/Singleton*` + `RunningChromeVersion` before any `node --test` run (lessons.md — dangling symlinks crash the test walker).**

**Goal:** Resolve replay targets via a multi-signal voting ladder so capture/replay survives unstable CSS, missing ids/data-*, and computed/absent accessible names (the Phase 80 Keep gap2). Deterministic core only — visual layer is Phase 82.

**Architecture:** Capture computes signals IN-PAGE (recorder) to avoid the navigation race: a `locator{role, name(computed), structuralKey, elementKey, relXPath, box, viewport}` per click/fill. Replay tries: fast-path(data-*/id/name) → role+computed-name (`Accessibility.queryAXTree`) → structuralKey (in-page matcher) → relXPath → coordinate+hit-test, returning `{backendNodeId, layerUsed, confidence}`. The structural-key + relXPath algorithms are shared: one in-page form (in the recorder string + an injectable replay matcher) and a Node mirror for unit tests, kept honest by an equivalence test.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test`, TS strict checkJs. No new deps (visual/pixelmatch is Phase 82). Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-layered-resolver-design.md` (approved; 3 open decisions accepted as proposed).

---

## Decisions locked (from spec review)
1. Ladder order = first-confident-match; when the winning rung is brittle (coords), cross-check one more rung; low-confidence → flag in report.
2. Structural-key/relXPath kept in BOTH in-page string + Node mirror, guarded by an equivalence test.
3. Visual `shotRef` deferred to Phase 82.
4. **No cryptographic hash** — use a canonical STRING key (`structuralKey`); matching is string equality. Trivially identical in-page and in Node (no `crypto.subtle` async needed).

---

## File Structure
- Create `scripts/lib/structural-fp.mjs` — `filterDynamicClasses`, `buildStructuralKey(descriptor)`, `buildElementKey(descriptor)` (Node mirror; pure).
- Create `scripts/lib/rel-xpath.mjs` — `buildRelXPath(descriptor)` (Node mirror; pure).
- Create `scripts/observe/locator-capture.mjs` — the SHARED in-page source string (`structuralKeyInPageSource`) injected by both recorder (capture) and resolver (replay matcher). Exports the string + the parsed functions for the equivalence test.
- Modify `scripts/observe/recorder-script.mjs` — enhanced `accessibleNameOf`; emit `locator{...}` + click coords.
- Modify `scripts/sanitize/event-sanitizer.mjs` — preserve `locator`.
- Modify `scripts/analyze/compile.mjs` — carry `locator` onto steps.
- Modify `scripts/lib/schemas.mjs` — `Step.locator` optional shape.
- Modify `scripts/cdp/locator-resolver.mjs` — `resolveLocator` ladder.
- Modify `scripts/cdp/watchdogs/action.mjs` — `clickByCoords` + hit-test.
- Modify `scripts/generate/generate-runner.mjs` — use `resolveLocator`; record `layerUsed`.
- Modify `scripts/fixtures/site-server.mjs` — `noanchor` fixture (no id/data-*/aria; only structure/coords).
- Tests: unit per lib + an equivalence test + a deterministic capture→replay e2e + Keep retry.

---

## Task 81.1: locator schema
**Files:** `scripts/lib/schemas.mjs`; `tests/lib/schemas` (if present) or rely on compile test.
- [ ] Add to `Step` (it's `.passthrough()`; add explicit optional for shape-lock):
```js
locator: z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  structuralKey: z.string().optional(),
  elementKey: z.string().optional(),
  relXPath: z.string().optional(),
  box: z.object({ cx: z.number(), cy: z.number(), w: z.number(), h: z.number() }).partial().optional(),
  viewport: z.object({ w: z.number(), h: z.number(), dpr: z.number() }).partial().optional()
}).passthrough().optional()
```
- [ ] `npm run check` GREEN. Commit `phase 81: Step.locator multi-signal fingerprint schema`.

## Task 81.2: structural-fp Node lib
**Files:** Create `scripts/lib/structural-fp.mjs`; Test `tests/lib/structural-fp.test.mjs`
- [ ] **Failing test:**
```js
import { filterDynamicClasses, buildStructuralKey, buildElementKey } from "../../scripts/lib/structural-fp.mjs";
test("filterDynamicClasses drops hashed/state classes, keeps semantic", () => {
  assert.deepEqual(
    filterDynamicClasses(["btn", "css-1a2b3c", "is-active", "PrimaryButton", "x8f9q2k7zz"]).sort(),
    ["PrimaryButton", "btn"].sort()
  );
});
test("buildStructuralKey is stable + ignores dynamic classes", () => {
  const a = buildStructuralKey({ tagPath: ["main","form","div"], tag: "button", staticAttrs: { role: "button", type: "submit" }, classes: ["btn","css-xyz123ab"], name: "Save" });
  const b = buildStructuralKey({ tagPath: ["main","form","div"], tag: "button", staticAttrs: { type: "submit", role: "button" }, classes: ["btn","css-DIFFERENT99"], name: "Save" });
  assert.equal(a, b); // attr order + dynamic class differences don't change the key
});
test("buildElementKey differs from structuralKey by retaining all classes", () => {
  const d = { tagPath: ["div"], tag: "button", staticAttrs: {}, classes: ["btn","css-xyz123ab"], name: "X" };
  assert.notEqual(buildStructuralKey(d), buildElementKey(d));
});
```
- [ ] **Implement** `structural-fp.mjs`:
```js
// A class token is "dynamic" if it looks generated/stateful.
const DYNAMIC_RE = /(^|[-_])(is|has|js)[-_]|^(css|sc|jsx)-|[a-z]?[0-9a-f]{6,}$|[a-z0-9]{8,}$/i;
/** @param {string[]} classes */
export function filterDynamicClasses(classes) {
  return (Array.isArray(classes) ? classes : []).filter((c) => typeof c === "string" && c && !DYNAMIC_RE.test(c));
}
/** @param {{tagPath?:string[],tag?:string,staticAttrs?:Record<string,string>,classes?:string[],name?:string}} d */
function canonical(d, keepAllClasses) {
  const tagPath = (d.tagPath ?? []).join(">");
  const attrs = Object.entries(d.staticAttrs ?? {}).filter(([,v]) => v != null && v !== "").sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join(",");
  const classes = (keepAllClasses ? (d.classes ?? []) : filterDynamicClasses(d.classes ?? [])).slice().sort().join(".");
  return `${tagPath}|${d.tag ?? ""}|${attrs}|${classes}|${(d.name ?? "").trim()}`;
}
export function buildStructuralKey(d) { return canonical(d, false); }
export function buildElementKey(d) { return canonical(d, true); }
```
- [ ] Test pass; `npm run check` GREEN. Commit `phase 81: structural-fp lib (dynamic-class-filtered structural/element keys)`.

## Task 81.3: rel-xpath Node lib
**Files:** Create `scripts/lib/rel-xpath.mjs`; Test `tests/lib/rel-xpath.test.mjs`
- [ ] **Failing test:** `buildRelXPath` anchors at the nearest ancestor with a stable id/data-* and builds a tag-indexed path down; falls back to absolute-ish tag path when no anchor.
```js
import { buildRelXPath } from "../../scripts/lib/rel-xpath.mjs";
test("buildRelXPath anchors at nearest stable ancestor", () => {
  const chain = [
    { tag: "main", id: "", dataBf: "" },
    { tag: "form", id: "checkout", dataBf: "", indexAmongTag: 1, sameTagSiblings: 1 },
    { tag: "div", id: "", dataBf: "", indexAmongTag: 2, sameTagSiblings: 3 },
    { tag: "button", id: "", dataBf: "", indexAmongTag: 1, sameTagSiblings: 2 }
  ];
  assert.equal(buildRelXPath(chain), "//*[@id='checkout']/div[2]/button[1]");
});
```
- [ ] **Implement:** walk from target up; the first ancestor (incl. target's ancestors) with `id` or `dataBf`/`dataTestid` becomes the anchor (`//*[@id='X']` or `//*[@data-bf='X']`); below it emit `tag[index]` only when `sameTagSiblings>1` else `tag`. No anchor → `//tag[index]/...` from the top captured ancestor. (Complete code in implementation; keep it ~40 lines, deterministic.)
- [ ] Test pass; `npm run check` GREEN. Commit `phase 81: rel-xpath lib (anchor-at-stable-ancestor relative xpath)`.

## Task 81.4: shared in-page locator-capture source + equivalence test
**Files:** Create `scripts/observe/locator-capture.mjs`; Test `tests/observe/locator-equivalence.test.mjs`
- [ ] Create `locator-capture.mjs` exporting a string `locatorCaptureSource` that defines, in-page, `__bfFilterDynamicClasses`, `__bfBuildStructuralKey(el)`, `__bfBuildElementKey(el)`, `__bfBuildRelXPath(el)`, `__bfComputedName(el)`, `__bfDescriptor(el)` — using the SAME canonical rules as the Node libs (81.2/81.3). `__bfComputedName`: `aria-label` → resolve `aria-labelledby` (split ids, concat their text) → `<label for=id>` / wrapping `<label>` → `placeholder` → `title` → trimmed innerText (cap 80).
- [ ] **Equivalence test:** `new Function(locatorCaptureSource + "; return {struct: __bfBuildStructuralKey, ...}")` won't work without a DOM. Instead: extract the PURE helpers (`__bfFilterDynamicClasses`, and a `__bfCanonical(descriptor)`) so they take plain descriptors (not elements); eval them via `new Function` and assert they produce byte-identical output to `structural-fp.mjs`/`rel-xpath.mjs` on shared sample descriptors. (Element-extraction parts are covered by the e2e in 81.10.)
- [ ] Commit `phase 81: shared in-page locator-capture source + Node-equivalence test`.

## Task 81.5: recorder emits locator + coords
**Files:** `scripts/observe/recorder-script.mjs`
- [ ] Enhance `accessibleNameOf` to the computed-name precedence (mirror `__bfComputedName`).
- [ ] In click + focusout + change emits, add `locator: { role, name, structuralKey: __bfBuildStructuralKey(target), elementKey, relXPath, box: {cx,cy,w,h from getBoundingClientRect}, viewport: {w:innerWidth,h:innerHeight,dpr:devicePixelRatio} }` and (click only) `coords: {x: rect.cx, y: rect.cy}`. Inline the `locatorCaptureSource` helpers into the recorder IIFE (import the string at daemon assembly OR paste-equivalent). **String.raw: no backticks/`${` in additions.**
- [ ] Validate injected script parses (`new Function`). `npm run check` GREEN. Commit `phase 81: recorder emits multi-signal locator (computed name + structuralKey + relXPath + box)`.

## Task 81.6: sanitizer preserves locator
**Files:** `scripts/sanitize/event-sanitizer.mjs`; `tests/security/sanitizer.test.mjs`
- [ ] In click/submit + input branches, copy `locator` through (it's structural, not PII — but run its `name` through `sanitizeText` and redact if `fieldNameIsForbidden`). Add to `RawEvent` typedef. Regression test: a click/input with `locator` survives sanitize (mirrors the Phase 80 gap1 fix — capture→sanitize must not drop fingerprint fields).
- [ ] `npm run check` GREEN. Commit `phase 81: sanitizer preserves locator fingerprint (capture→sanitize)`.

## Task 81.7: compile carries locator
**Files:** `scripts/analyze/compile.mjs`; `tests/analyze/compile.test.mjs`
- [ ] In click + input branches, copy `event.locator` onto the step. Test: a sanitized event with `locator` compiles to a step with `locator`.
- [ ] `npm run check` GREEN. Commit `phase 81: compile carries locator onto workflow steps`.

## Task 81.8: resolveLocator ladder
**Files:** `scripts/cdp/locator-resolver.mjs`; Test `tests/cdp/` (unit where possible) + covered by e2e
- [ ] Add `resolveLocator(session, targetId, step)` returning `{ backendNodeId, layerUsed, confidence }`:
  1. fast-path: existing `data-bf/id/name` selector if `step.selector` is specific + unique.
  2. role+name: if `locator.role` && `locator.name` → `Accessibility.queryAXTree({backendNodeId: docRoot, accessibleName: locator.name, role: locator.role})` → first visible match's `backendDOMNodeId`.
  3. structuralKey: inject an in-page matcher (`locatorCaptureSource` + a walker) that returns the backendNodeId of the unique node whose `__bfBuildStructuralKey` equals `locator.structuralKey` (use `elementKey` to break ties); map the returned objectId → backendNodeId via `DOM.requestNode`/`describeNode`.
  4. relXPath: `Runtime.evaluate(document.evaluate(relXPath ...))`; accept if single match → backendNodeId.
  5. coords+hit-test: scroll-into-view a prior candidate or use `locator.box`; `DOM.getNodeForLocation({x,y})` → backendNodeId; cross-check the node's structuralKey matches (brittle-rung cross-check per decision 1).
  Keep `resolveAtomicFpLocator` as an internal helper (rung within). Return `confidence: "high"` when ≥2 rungs agree or a stable rung (1-3) hits; `"low"` when only coords hit.
- [ ] `npm run check` GREEN. Commit `phase 81: resolveLocator voting ladder (fast → role+name → structuralKey → relXPath → coords+hit-test)`.

## Task 81.9: action coordinate click + hit-test
**Files:** `scripts/cdp/watchdogs/action.mjs`
- [ ] Add `clickByCoords(targetId, x, y)` (dispatchMouseEvent press+release) and a `nodeAtPoint(targetId, x, y)` helper (`DOM.getNodeForLocation`) for the resolver's hit-test. Typedef updates.
- [ ] `npm run check` GREEN. Commit `phase 81: action clickByCoords + nodeAtPoint hit-test`.

## Task 81.10: runner uses resolveLocator + no-anchor fixture + e2e (deterministic gate)
**Files:** `scripts/generate/generate-runner.mjs`; `scripts/fixtures/site-server.mjs`; Test `tests/e2e/verify-noanchor.test.mjs`
- [ ] Runner: replace the `resolveNodeId` body to call `resolveLocator`; record `layerUsed` per step in the report.
- [ ] `noanchor` fixture page: a create flow whose interactive elements have **no id, no data-*, no aria** and **randomized class names per load** — only structure + text + position are stable. (Forces rungs 3-5.)
- [ ] e2e (hard timeout 90s): capture is simulated by authoring a workflow with the captured `locator` (structuralKey/relXPath/box) for the noanchor elements, then `verifyRun` must still resolve + complete via the structural/coords rungs (assert `layerUsed` ∈ {structuralKey, relXPath, coords} and the flow's server effect landed). This proves name-independent resolution end-to-end.
- [ ] `npm run check` GREEN. Commit `phase 81: runner uses resolveLocator + no-anchor fixture e2e (name-independent resolution gate)`.

## Task 81.11: real Keep retry (human-in-loop)
- [ ] Re-capture Keep create→delete (now: enhanced computed-name + structuralKey captured; verify via `bf done` raw→sanitized→`bf analyze` that the title step has a non-empty `locator.name` or `structuralKey`). Then verify replay resolves the title. Record honest outcome in the doc. Manual; not a CI gate.

## Task 81.12: governance constraint review + Phase 80 & 81 docs
- [ ] **Constraint review (DUE @81: last @76, +5).** Per `constraint-hierarchy-over-accumulation`: review accumulated rules/skills for contradiction/bloat; record outcome; bump `.governance/state.json` `last_constraint_review_phase` → 81. Run `validate-skill.mjs`.
- [ ] Write `tasks/phases/phase-80-spa-capture.md` (honest: 80.1-80.6 + gap1 fix; 80.7 Keep blocked by gap2 → motivated Phase 81) AND `tasks/phases/phase-81-layered-resolver.md` (the ladder, decisions, no-anchor gate, Keep outcome, Phase 82 visual pending).
- [ ] Commit.

---

## Self-Review
- **Spec coverage:** computed-name (81.5 recorder + 81.8 rung2) ✓, structural key (81.2/81.4/81.8 rung3) ✓, relXPath (81.3/81.8 rung4) ✓, coords+hit-test (81.8 rung5 + 81.9) ✓, capture→sanitize→compile plumbing (81.5/81.6/81.7 — closes the Phase-80 gap1 class) ✓, no-anchor deterministic gate (81.10) ✓, Keep (81.11) ✓, governance constraint review (81.12) ✓. Visual = Phase 82 (out).
- **Capture/replay symmetry:** shared `locator-capture.mjs` source + Node mirrors + equivalence test (81.4) — the structural key/xpath are computed identically at capture (recorder) and replay (injected matcher).
- **No-placeholder risk:** 81.3 (relXPath full code) + 81.4 (element-extraction equivalence) + 81.8 (objectId→backendNodeId mapping, queryAXTree visibility filter) are the trickiest — implementer must confirm CDP return shapes (`queryAXTree` returns AXNode[] with `backendDOMNodeId`; `getNodeForLocation` returns `{backendNodeId}`); flagged.
- **Real-Chrome:** only 81.10 + 81.11; hard timeout + Singleton cleanup mandated.
- **Governance:** constraint review IS due at 81 — included as 81.12.

## Execution Handoff
Subagent-driven. Pure libs (81.2/81.3/81.4) + plumbing (81.1/81.6/81.7) → fresh subagents. Resolver + recorder + runner (81.5/81.8/81.9/81.10) are integration — standard model + careful review. Controller runs 81.10/81.11 (real Chrome) directly. Phase 82 (visual pixelmatch) after 81 lands.
