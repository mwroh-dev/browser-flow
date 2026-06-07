# Phase 80 — SPA capture enhancement: contenteditable + role-based resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Real-Chrome e2e (80.6/80.7) MUST use a hard `{timeout}` + zombie-kill cleanup (lessons.md).**

**Goal:** Make capture+replay work on modern SPA sites (Google Keep et al.) by capturing contenteditable typing + role-less clicks, and resolving them at replay via the accessibility tree (role+name) instead of brittle CSS selectors.

**Architecture:** Three coordinated changes proven viable by a CDP spike on real Keep (2026-05-20): (1) the in-page recorder emits each target's *explicit role* + accessible name and adds a contenteditable capture path; (2) `deriveAtomicLocator` uses that explicit role so role-strategy atomic-fps are produced for `role=textbox` / `role=button` on non-semantic tags; (3) the runner replays contenteditable fills via `DOM.focus(backendNodeId)` + `Input.insertText`, resolving the node through the existing AX-based `resolveAtomicFpLocator`.

**Spike evidence (de-risked):** On real Keep, the note Title is a contenteditable `<div role="textbox" aria-label="제목">`; `Accessibility.getFullAXTree` exposes it as `{role:"textbox", name:"제목"}`; `DOM.focus(backendNodeId)` + `Input.insertText("…")` typed into it successfully; buttons (확인/닫기/이미지 추가/보관처리/더보기…) all expose role+name. So `resolveAtomicFpLocator`'s role strategy (`findBackendNodeId(role,name)`) + insertText is sufficient.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test` (`--import=./tests/_setup.mjs`), TS strict checkJs. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-20-human-in-loop-verify-design.md` (the real-site capture this whole arc targets).

---

## Assumptions (surface before execution; user may correct)

1. **Contenteditable capture = commit-on-blur**, not per-keystroke. A `focusout` listener: if the blurred target `isContentEditable`, emit one `input` event with `value = textContent`, `contentEditable: true`. Mirrors the existing `change`-on-input semantics (one final value). Simpler than coalescing keystrokes; matches how the rest of the pipeline expects one fill per field.
2. **Click broadening**: extend the click `closest()` matcher to also catch role-bearing / interactive non-semantic elements: add `[role]`, `[jsaction]`, `[tabindex]`, `[contenteditable]`, `summary`. Accepts some extra clicks; the analyze/compile + atomic-fp + verify path-mismatch checks filter noise. (Keep's create-note + menu items are role-less `<div jsaction>`.)
3. **Replay resolves fills via atomic-fp (AX), not raw selector**, when the step is contentEditable (selectors like bare `div` are useless on SPAs). Non-contenteditable fills keep the existing `typeIntoSelector(selector)` path (fixtures rely on it) to minimize blast radius.
4. **Role source**: the recorder emits the element's explicit `role` (`getAttribute("role") || implicitRoleOf`); `deriveAtomicLocator` prefers the emitted role over tag-implicit. Accessible name = existing `text`/aria-label capture.
5. **No content-clearing before insertText** — create flows start empty; dummy substitution replaces the value anyway. (Documented limit: re-running against a pre-filled field would append.)
6. **BFS / search-orphan-sweep coupling unchanged** — out of scope here.

---

## File Structure

- Modify: `scripts/observe/recorder-script.mjs` — emit `role`+name on click/input; broaden click matcher; add contenteditable `focusout` capture.
- Modify: `scripts/lib/atomic-fp.mjs` — `deriveAtomicLocator` uses emitted explicit `role`.
- Modify: `scripts/cdp/watchdogs/action.mjs` — add `typeIntoBackendNodeId(targetId, backendNodeId, text)` (focus + `Input.insertText`).
- Modify: `scripts/analyze/compile.mjs` — pass `contentEditable` (+ `role`) from input event → fill step.
- Modify: `scripts/generate/generate-runner.mjs` — contenteditable fill replay via atomic-fp + `typeIntoBackendNodeId`.
- Modify: `scripts/lib/schemas.mjs` — `Step` allows optional `contentEditable`/`role` (passthrough already permits; add explicit optional for shape lock).
- Fixtures/tests: `scripts/fixtures/site-server.mjs` (a `spa` fixture: role-less div button + contenteditable role=textbox field), `tests/lib/atomic-fp.test.mjs`, `tests/analyze/compile.test.mjs`, `tests/generate/runner.test.mjs`, `tests/e2e/verify-contenteditable.test.mjs`, plus a capture e2e.

---

## Task 80.1: recorder-script — role emission + broadened clicks + contenteditable capture

**Files:** Modify `scripts/observe/recorder-script.mjs`. (In-page string; verified by the capture e2e in 80.6, not unit-testable directly.)

- [ ] **Step 1: broaden the click matcher.** In the `click` listener (~line 169-171), change:
```js
? event.target.closest("a,button,[role=button],[data-bf],[data-testid]")
```
to:
```js
? event.target.closest("a,button,[role],[data-bf],[data-testid],[jsaction],[tabindex],summary,[contenteditable]")
```

- [ ] **Step 2: emit `role` on the click event.** In the click `emit({...})` (~line 183), add a `role` field using the element's explicit-or-implicit role:
```js
role: target.getAttribute("role") || implicitRoleOf(target),
```
(`implicitRoleOf` already exists in this script.)

- [ ] **Step 3: add contenteditable capture.** After the `change` listener (~line 209), add a `focusout` listener (focusout bubbles; blur does not):
```js
document.addEventListener("focusout", (event) => {
  const t = event.target;
  if (!(t instanceof Element) || !(/** @type {HTMLElement} */ (t)).isContentEditable) {
    return;
  }
  const ce = t.closest('[contenteditable=""],[contenteditable="true"]') || t;
  const fieldName = ce.getAttribute("aria-label") || ce.getAttribute("name") || ce.id || "";
  const ceSelector = selectorFor(ce);
  emit({
    type: "input",
    selector: ceSelector,
    fieldName,
    contentEditable: true,
    role: ce.getAttribute("role") || "textbox",
    secret: SECRET_FIELD_PATTERN.test(fieldName),
    value: cleanText(ce.innerText || ce.textContent),
    ancestors: collectAncestors(ce),
    siblings: countSiblings(ce, ceSelector)
  });
}, true);
```

- [ ] **Step 4: also emit `role` on the existing `change`/input listener** (~line 200) for consistency:
```js
role: target.getAttribute("role") || implicitRoleOf(target),
```

- [ ] **Step 5: commit** — `phase 80: recorder captures contenteditable (focusout) + emits role + broadens click matcher`

## Task 80.2: atomic-fp uses emitted explicit role

**Files:** Modify `scripts/lib/atomic-fp.mjs`; Test `tests/lib/atomic-fp.test.mjs`

- [ ] **Step 1: failing test** — an event with explicit `role:"textbox"`, `text:"제목"` (or fieldName), `siblings:{totalMatchingSelector:2, totalMatchingRole:1}` yields `{strategy:"role", role:"textbox", name:"제목"}`. Also a `role:"button"` on a `div` selector yields role strategy. (Add to existing atomic-fp.test.mjs; match its style.)

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** — in `deriveAtomicLocator` (line ~162), prefer the emitted role and a name from text-or-fieldName:
```js
const text = typeof event.text === "string" && event.text.trim()
  ? event.text.trim()
  : (typeof event.fieldName === "string" ? event.fieldName.trim() : "");
const explicitRole = typeof event.role === "string" ? event.role.trim() : "";
const tag = tagOfSelector(typeof event.selector === "string" ? event.selector : "");
const role = explicitRole || IMPLICIT_ROLE_BY_TAG.get(tag) || "";
if (role && totalMatchingRole === 1 && text.length > 0) {
  return { strategy: "role", role, name: text };
}
```
Add `role?: string` and `fieldName?: string` to the `AtomicFpInput` typedef (top of file). Keep the ancestor-scope fallback unchanged.

- [ ] **Step 4: run, expect pass; `npm run check` GREEN.**

- [ ] **Step 5: commit** — `phase 80: deriveAtomicLocator uses emitted explicit role (enables role=textbox/button on non-semantic tags)`

## Task 80.3: action.typeIntoBackendNodeId (focus + Input.insertText)

**Files:** Modify `scripts/cdp/watchdogs/action.mjs`. (Verified via the e2e in 80.6.)

- [ ] **Step 1: implement** — add to the returned watchdog object (alongside `typeIntoSelector`):
```js
async typeIntoBackendNodeId(targetId, backendNodeId, text) {
  const sid = sessionManager.getSessionId(targetId);
  if (!sid) throw new Error(`no sessionId for ${targetId}`);
  await client.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sid).catch(() => {});
  await client.send("DOM.focus", { backendNodeId }, sid);
  await client.send("Input.insertText", { text }, sid);
},
```
Add `typeIntoBackendNodeId` to the `ActionWatchdog` typedef.

- [ ] **Step 2: `npm run check` GREEN** (typedef + no callers yet).

- [ ] **Step 3: commit** — `phase 80: action.typeIntoBackendNodeId (focus + Input.insertText) for contenteditable replay`

## Task 80.4: runner replays contenteditable fills via atomic-fp

**Files:** Modify `scripts/generate/generate-runner.mjs`; Test `tests/generate/runner.test.mjs`

- [ ] **Step 1: failing test** — generated source contains a contenteditable branch (e.g. `typeIntoBackendNodeId` + `contentEditable`).
```js
test("generated runner replays contentEditable fills via backendNodeId", () => {
  const source = generateRunner(/* runId with a contentEditable fill step */);
  assert.match(source, /contentEditable/);
  assert.match(source, /typeIntoBackendNodeId/);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** — in the forward `fill` branch (~line 303-316) and the teardown fill branch, when `step.contentEditable` is truthy, resolve via atomic-fp and type into the backendNodeId:
```js
} else if (step.action === "fill") {
  const backendNodeId = await resolveNodeId(bs, targetId, step);
  // field-name signature check (existing) ...
  const value = step.secret ? process.env.BROWSER_FLOW_SECRET_0 ?? "" : step.value ?? "";
  if (step.contentEditable) {
    await action.typeIntoBackendNodeId(targetId, backendNodeId, value);
  } else {
    await action.typeIntoSelector(targetId, step.selector, value);
  }
}
```
Apply the same `contentEditable` branch in the teardown fill block. (`resolveNodeId` = the runner's atomic-fp resolver already used by clicks.)

- [ ] **Step 4: run, expect pass; `npm run check` GREEN.**

- [ ] **Step 5: commit** — `phase 80: runner replays contentEditable fills via atomic-fp backendNodeId + insertText`

## Task 80.5: compile passes contentEditable + role through

**Files:** Modify `scripts/analyze/compile.mjs`, `scripts/lib/schemas.mjs`; Test `tests/analyze/compile.test.mjs`

- [ ] **Step 1: failing test** — a sanitized `input` event with `contentEditable:true` + `role:"textbox"` compiles to a fill step carrying `contentEditable:true` (and atomicFp role strategy). Add to compile.test.mjs.

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** — in compile's input-event branch (~line 117-134), copy the flags onto the fill step:
```js
const fillStep = {
  action: "fill",
  selector: event.selector ?? "",
  fieldName: event.fieldName ?? "",
  // existing fields...
};
if (event.contentEditable) fillStep.contentEditable = true;
const fillAtomicFp = deriveAtomicLocator(event);
if (fillAtomicFp) fillStep.atomicFp = fillAtomicFp;
```
In `schemas.mjs` `Step`, add optional `contentEditable: z.boolean().optional()` and `role: z.string().optional()` (Step is passthrough but lock the shape).

- [ ] **Step 4: run, expect pass; `npm run check` GREEN.**

- [ ] **Step 5: commit** — `phase 80: compile carries contentEditable flag from input event to fill step`

## Task 80.6: deterministic spa fixture + capture→replay e2e (regression gate)

**Files:** Modify `scripts/fixtures/site-server.mjs`; Test `tests/e2e/verify-contenteditable.test.mjs` (+ optionally a capture e2e)

- [ ] **Step 1: add a `spa` fixture page** at `/spa`: a role-less `<div jsaction role="button" aria-label="create">Create</div>` and a contenteditable `<div role="textbox" aria-label="Title" contenteditable="true"></div>`, plus a tiny store + a way to assert the typed value landed (e.g., a "save" div-button that POSTs the contenteditable text; GET shows it). Mirror the selfclean fixture's store pattern.

- [ ] **Step 2: replay e2e (hard timeout 90s)** — author a workflow.json whose fill step has `contentEditable:true` + `atomicFp:{strategy:"role",role:"textbox",name:"Title"}`, and a click step on the role-less div (atomicFp role=button name=create). `generateRunner` + `verifyRun`. Assert the contenteditable received the value (server store / evidence) and the role-less click worked. This proves 80.2/80.3/80.4 deterministically.
```js
test("verify-contenteditable: role-resolved contenteditable fill + role-less div click replay", { timeout: 90000 }, async () => { /* ... */ });
```

- [ ] **Step 3: run with the background wall-clock guard; kill zombie Chrome before/after.** Fix until green.

- [ ] **Step 4: (capture half) OPTIONAL real-Chrome capture e2e** — `prepare` on the `spa` fixture, CDP-script a click + contenteditable type + blur, `done`, `analyze`, assert the workflow has a `contentEditable` fill step with a role atomic-fp. Hard timeout. If too flaky/heavy, document that the capture half is covered by the real-site retry (80.7) + the recorder-script review, and rely on 80.2/80.4/80.5 unit tests + the replay e2e.

- [ ] **Step 5: commit** — `phase 80: spa fixture + contenteditable capture→replay e2e (regression gate)`

## Task 80.7: real-site Keep retry (human-in-loop validation)

**Files:** none (validation runbook); record outcome in the phase doc.

- [ ] **Step 1** — `bf prepare --unmasked --profile-name notebooklm --start-url https://keep.google.com/`; operator records create-titled-note; `bf done`.
- [ ] **Step 2** — second capture: operator records delete-note (open note → 더보기/menu → 삭제); `bf done`.
- [ ] **Step 3** — `bf spec` (login=yes, sandbox=no→dummy, teardown=record, irreversible=no), `bf analyze`, `bf teardown --record <cleanupRunId>`, `bf generate`.
- [ ] **Step 4** — `bf verify` first-mode (human auth once → keychain) replays with a dummy title + teardown → self-clean. Assert Keep has no leftover `__bf_test__` notes.
- [ ] **Step 5** — record the honest outcome (what captured, what replayed, any remaining gap) in the phase doc. Real-site retry is manual; not a CI gate.

## Task 80.8: Phase 80 doc + governance

- [ ] **Step 1** — governance: read `.governance/state.json` (constraint last 76 → next 81; if Phase 80 doc makes max phase 80, 80<81 → no constraint review; eval last 72 → next 82 → no audit). Run `validate-skill.mjs`.
- [ ] **Step 2** — write `tasks/phases/phase-80-spa-capture.md` (quote the arc goal; document the spike evidence, the three changes, the deterministic fixture gate + the real-site retry outcome, and remaining limits: unnamed/ambiguous textboxes, content-clearing).
- [ ] **Step 3** — commit.

---

## Self-Review

- **Goal coverage:** capture contenteditable (80.1) ✓, role-based atomic-fp (80.2) ✓, contenteditable replay (80.3/80.4) ✓, flag propagation (80.5) ✓, deterministic proof (80.6) ✓, real-site validation (80.7) ✓.
- **Spike-grounded:** the AX role=textbox+name resolution + focus+insertText is proven on real Keep, not assumed.
- **Placeholder scan:** 80.1-80.5 concrete code; 80.6/80.7 reference existing fixture/e2e/capture patterns with implementer notes.
- **Type consistency:** `contentEditable`/`role` flow recorder → compile (80.5) → schemas Step → runner (80.4). `typeIntoBackendNodeId` typedef (80.3) used by runner (80.4). `deriveAtomicLocator` role precedence (80.2) consumed by compile + runner resolver.
- **Real-Chrome risk:** only 80.6 (and optional capture e2e) + 80.7 launch Chrome — hard timeout + zombie-kill mandated.
- **Governance:** Phase 80 → constraint Δ=4 (<5), eval Δ=8 (<10) → no gate (verified in 80.8).

## Execution Handoff

Plan saved. Options: **1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review; controller runs 80.6/80.7 (real-Chrome) directly. **2. Inline.** After 80 lands, the Keep create→delete real-site mutating e2e (the original Phase-80 goal) is finally achievable end-to-end.
