# Phase 79 — Search teardown + orphan recovery (listable surface → orphan → search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Real-Chrome e2e tasks (79.3) MUST use a hard `{timeout}` + guaranteed cleanup — see lessons.md "real-browser e2e hard timeout".**

**Goal:** Give verify a *listable surface* so it can (a) recover orphan test-dummies left by a prior crashed teardown (idempotency — the folded 78.5) and (b) discover a teardown delete-path by deterministic keyword search over the captured page (`search` strategy, the manual-seed reduction of the BFS north-star).

**Architecture:** One shared primitive lib (`affordance-search.mjs`) over two surfaces: the **captured** surface (`knowledge/pages/<pageKey>/selectors.json[].text/actions`) for analyze-time `search` discovery, and the **live** surface (`installAccessibilityWatchdog().getFullAxTree(targetId)` → `{role,name}`) for replay-time orphan enumeration. Orphan recovery reuses the existing recorded teardown delete steps as a per-name recipe (re-run with the discovered orphan name substituted), bypassing the irreversible-skip like Phase 77 teardown. `search` emits a `{strategy:"search"}` teardown that is human-verified on first verify exactly like `record`.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test` (`--import=./tests/_setup.mjs`), TS strict + checkJs (`npm run check` must stay GREEN).

**Spec:** `docs/superpowers/specs/2026-05-20-human-in-loop-verify-design.md` §③ (search/BFS) + §⑤ (self-cleaning/orphan recovery).

---

## Assumptions (surface before execution; user may correct)

1. **`search` is deterministic, not an LLM call.** The repo has no LLM seam; `safety-classify`/`variable-proposer`/`spec-agent` are all deterministic keyword stand-ins. `search` follows that pattern: keyword match over `selectors.json[].text` (+ `actions` includes `"click"`). The external agent supplies the NL intent and confirms the result — the *primitive* is deterministic. Default delete keywords: `삭제 / delete / remove / trash / 지우기 / 휴지통` (case-insensitive), overridable.
2. **Orphan sweep mechanism.** After the recorded teardown, enumerate live AX nodes whose `name` matches the dummy prefix (`getFullAxTree` → filter by `isDummyName`), and for each leftover re-run the teardown's existing delete steps with the *name-bearing fill step's value* set to that orphan name. Best-effort, recorded as `orphanSweep`, never throws. Requires a "delete-by-name" teardown shape (a `fill` step + a `click`/`submit` delete step). Sites with no listable AX surface → sweep records `available:false` and is a no-op.
3. **Fixture gains a rendered list.** The selfclean `/selfclean` page renders the store into `<ul id="item-list">` as `<li data-bf="item">name</li>` so the live AX surface (role `listitem`, name = text) is enumerable. This is the listable-surface stand-in for a real site's item list.
4. **BFS stays out of scope** (north-star). `search` is the manual-seed reduction; BFS (auto-traverse `neighbors.json` for delete paths) is a later phase.

---

## File Structure

- Create: `scripts/lib/affordance-search.mjs` — pure: `findDeleteAffordances(selectorEntries, keywords?)`, `findDummyItemNames(axNodes, prefix)`
- Create: `tests/lib/affordance-search.test.mjs`
- Modify: `scripts/fixtures/site-server.mjs` — render store into `#item-list`
- Modify: `scripts/generate/generate-runner.mjs` — orphan-sweep block after teardown; record `orphanSweep`
- Modify: `scripts/verify/verify-run.mjs` — surface `orphanSweep` in the report
- Modify: `scripts/lib/teardown.mjs` — `buildSearchTeardown(selectorEntries, intent, dummyNaming?)`
- Modify: `scripts/commands/teardown.mjs` + `scripts/cli.mjs` — `bf teardown --search --intent "<nl>"`
- Modify: `scripts/lib/schemas.mjs` — `VerificationV1` additive-optional `orphanSweep`
- Tests: `tests/lib/teardown.test.mjs`, `tests/commands/teardown.test.mjs`, `tests/generate/runner.test.mjs`, `tests/e2e/verify-orphan-recovery.test.mjs`

---

## Task 79.1: affordance-search pure primitives

**Files:** Create `scripts/lib/affordance-search.mjs`; Test `tests/lib/affordance-search.test.mjs`

- [ ] **Step 1: failing test**
```js
import test from "node:test";
import assert from "node:assert/strict";
import { findDeleteAffordances, findDummyItemNames } from "../../scripts/lib/affordance-search.mjs";

test("findDeleteAffordances matches clickable elements whose text is a delete keyword", () => {
  const selectors = [
    { selector: "button#a", actions: ["click"], text: "삭제" },
    { selector: "button#b", actions: ["click"], text: "Create" },
    { selector: "a#c", actions: ["click"], text: "Remove item" },
    { selector: "input#d", actions: ["fill"], text: "delete" }, // not clickable → excluded
  ];
  const hits = findDeleteAffordances(selectors);
  assert.deepEqual(hits.map((h) => h.selector), ["button#a", "a#c"]);
});

test("findDeleteAffordances honors custom keywords + carries atomicFp inputs", () => {
  const selectors = [{ selector: "button", actions: ["click"], text: "지우기", ancestors: [{ role: "button" }] }];
  const hits = findDeleteAffordances(selectors, ["지우기"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, "지우기");
});

test("findDummyItemNames returns AX node names matching the dummy prefix (deduped)", () => {
  const ax = [
    { role: "listitem", name: "__bf_test__dead" },
    { role: "listitem", name: "real-item" },
    { role: "listitem", name: "__bf_test__dead" },
    { role: "button", name: "__bf_test__ignore-me" }, // non-listitem still matches by name; caller filters role if needed
  ];
  assert.deepEqual(findDummyItemNames(ax, "__bf_test__"), ["__bf_test__dead", "__bf_test__ignore-me"]);
});
```

- [ ] **Step 2: run, expect fail.** `node --test --import=./tests/_setup.mjs tests/lib/affordance-search.test.mjs`

- [ ] **Step 3: implement `scripts/lib/affordance-search.mjs`**
```js
import { isDummyName } from "./dummy-naming.mjs";

/** Default delete-affordance keywords (case-insensitive substring match on element text). */
export const DEFAULT_DELETE_KEYWORDS = ["삭제", "delete", "remove", "trash", "지우기", "휴지통"];

/**
 * @typedef {{ selector: string, actions?: string[], text?: string, ancestors?: Array<Record<string, unknown>>, siblings?: unknown, fieldName?: string }} SelectorEntry
 */

/**
 * Find clickable elements whose visible text matches a delete keyword.
 * Pure deterministic search over a captured page's selectors.json entries.
 * @param {SelectorEntry[]} selectorEntries
 * @param {string[]} [keywords]
 * @returns {SelectorEntry[]}
 */
export function findDeleteAffordances(selectorEntries, keywords) {
  const kws = (keywords ?? DEFAULT_DELETE_KEYWORDS).map((k) => k.toLowerCase());
  const list = Array.isArray(selectorEntries) ? selectorEntries : [];
  return list.filter((e) => {
    if (!e || typeof e !== "object") return false;
    const actions = Array.isArray(e.actions) ? e.actions : [];
    if (!actions.includes("click")) return false;
    const text = typeof e.text === "string" ? e.text.toLowerCase() : "";
    if (!text) return false;
    return kws.some((k) => text.includes(k));
  });
}

/**
 * From live AX nodes, return the (deduped, in-order) names matching the dummy prefix.
 * @param {Array<{ role?: string, name?: string }>} axNodes
 * @param {string} prefix
 * @returns {string[]}
 */
export function findDummyItemNames(axNodes, prefix) {
  const seen = new Set();
  const out = [];
  for (const n of Array.isArray(axNodes) ? axNodes : []) {
    const name = typeof n?.name === "string" ? n.name : "";
    if (name && isDummyName(name, prefix) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
```

- [ ] **Step 4: run, expect pass; `npm run check` → typecheck 0.**

- [ ] **Step 5: commit** — `phase 79: affordance-search pure primitives (findDeleteAffordances + findDummyItemNames)`

---

## Task 79.2: fixture renders item list + runner orphan-sweep

**Files:** Modify `scripts/fixtures/site-server.mjs`, `scripts/generate/generate-runner.mjs`; Test `tests/generate/runner.test.mjs`

### 79.2a — fixture renders the store list

- [ ] **Step 1:** In `site-server.mjs`, change `selfcleanPage()` to accept the store and render items. Replace the empty `<ul id="item-list"></ul>` with rendered `<li>`s:
```js
function selfcleanPage(items = []) {
  const lis = items.map((n) => `<li data-bf="item">${escapeHtml(n)}</li>`).join("");
  return `
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Self-Clean Demo</title><style>${style}</style></head>
  <body>
    <main>
      <h1 data-bf-evidence="selfclean-heading">Self-Clean Demo</h1>
      <form id="create-form" method="POST" action="/api/selfclean/create">
        <label>Item name<input data-bf="item-name" name="itemName" /></label>
        <button data-bf="item-create" type="submit">Create</button>
      </form>
      <form id="delete-form" method="POST" action="/api/selfclean/delete">
        <label>Delete item<input data-bf="item-name-delete" name="itemName" /></label>
        <button data-bf="item-delete" type="submit">Delete</button>
      </form>
      <ul id="item-list">${lis}</ul>
    </main>
  </body>
</html>`;
}
```
At the `GET /selfclean` route, pass the live store: change the responder to `respondHtml(response, selfcleanPage([...selfcleanStore]))`. (Find the `if (url.pathname === "/selfclean")` branch ~line 436.)

- [ ] **Step 2:** Manual check — `node -e` start fixture, `fetch /api/selfclean/create` then `fetch /selfclean`, assert the HTML contains `data-bf="item"`. (Or rely on the 79.3 e2e.) Keep `npm run check` GREEN.

### 79.2b — runner orphan-sweep block

- [ ] **Step 3: failing test** in `tests/generate/runner.test.mjs`:
```js
test("generated runner contains an orphan-sweep block (AX enumerate by dummy prefix → re-run delete recipe)", () => {
  const source = generateRunner(/* a runId whose workflow has teardown + dummyNaming */);
  assert.match(source, /orphanSweep/);
  assert.match(source, /findDummyItemNames/);
  assert.match(source, /installAccessibilityWatchdog/);
});
```
(Match the existing runner.test.mjs setup pattern for building a runId with a teardown workflow.)

- [ ] **Step 4: run, expect fail.**

- [ ] **Step 5: implement** — in `generate-runner.mjs`:
  - Add an import alongside the others: `import { installAccessibilityWatchdog } from "${rel(...accessibilityImportPath)}";` and `import { findDummyItemNames } from "${rel(affordanceImportPath)}";` and `import { isDummyName } from "${rel(dummyNamingImportPath)}";` (compute the rel paths like the existing `sessionStateImportPath`).
  - AFTER the existing teardown block (~line 507, after the `for (const tStep ...)` loop) and BEFORE the report build, add:
```js
// Phase 79: orphan recovery sweep. After the recorded teardown, enumerate live
// items whose name matches the dummy prefix and re-run the teardown's delete
// recipe per leftover (idempotent recovery from a prior crashed teardown).
// Best-effort + recorded; never throws. Bypasses irreversible-skip (cleanup).
let orphanSweep = { available: false, found: [], removed: [], errors: [] };
const _prefix = workflow.teardown && workflow.teardown.dummyNaming && workflow.teardown.dummyNaming.prefix;
const _tdSteps = workflow.teardown && Array.isArray(workflow.teardown.steps) ? workflow.teardown.steps : [];
const _fillStep = _tdSteps.find((s) => s.action === "fill");
const _actionStep = _tdSteps.find((s) => s.action === "click" || s.action === "submit");
if (_prefix && _fillStep && _actionStep) {
  const ax = await installAccessibilityWatchdog(bs);
  try {
    const nodes = await ax.getFullAxTree(targetId);
    const orphans = findDummyItemNames(nodes, _prefix);
    orphanSweep = { available: true, found: orphans, removed: [], errors: [] };
    for (const name of orphans) {
      try {
        await action.typeIntoSelector(targetId, _fillStep.selector, name);
        if (_actionStep.action === "click") {
          const { backendNodeId } = await resolveAtomicFpLocator(bs, targetId, _actionStep);
          await action.clickByBackendNodeId(targetId, backendNodeId);
        } else {
          const fbn = await resolveAtomicFpLocator(bs, targetId, _actionStep).then((r) => r.backendNodeId);
          if (_actionStep.submitterSelector) {
            const sub = { selector: _actionStep.submitterSelector, atomicFp: _actionStep.submitterAtomicFp };
            const sbn = await resolveAtomicFpLocator(bs, targetId, sub).then((r) => r.backendNodeId);
            await action.clickByBackendNodeId(targetId, sbn);
          } else {
            await evaluateOnNode(bs, targetId, fbn, \`function() { this.requestSubmit(); }\`);
          }
        }
        if (_actionStep.expectUrl) {
          await waitForExpectedUrl(bs, targetId, _actionStep.expectUrl, workflow.verification.transitionTimeoutMs);
        }
        orphanSweep.removed.push(name);
      } catch (sErr) {
        orphanSweep.errors.push({ name, error: sErr instanceof Error ? sErr.message : String(sErr) });
      }
    }
  } catch (axErr) {
    orphanSweep = { available: false, found: [], removed: [], errors: [{ name: "*", error: axErr instanceof Error ? axErr.message : String(axErr) }] };
  } finally {
    await ax.dispose().catch(() => {});
  }
}
```
  - Add `orphanSweep` to the runner's report object (both success + error report paths), next to `teardownSteps`.
  - NOTE on navigation: each delete re-loads `/selfclean?...` (the list shrinks). After a delete redirect the page is fresh; the next iteration's `typeIntoSelector` targets the reloaded form — fine because the orphan list was captured once up-front. If `expectUrl` differs from the list page, the loop must re-navigate; for the selfclean fixture delete redirects to `/selfclean/done` (no list) — so re-`goto` the start page between iterations: after each removal, if more orphans remain, `await action`-navigate back. Implement: after the loop body, if `_actionStep.expectUrl` is set and not the list page, navigate to `resolveFixtureStartPath()` before the next fill. (Keep it simple: re-run the AX enumeration is NOT needed — names captured up-front; just ensure the delete form is present each iteration by navigating to start.)

- [ ] **Step 6: run, expect pass; `npm run check` GREEN** (synthetic/docs/... have no teardown → block skipped → unchanged).

- [ ] **Step 7: commit** — `phase 79: fixture renders item-list + runner orphan-sweep (AX enumerate by prefix → re-run delete recipe)`

---

## Task 79.3: verify surfaces orphanSweep + idempotent orphan-recovery e2e

**Files:** Modify `scripts/verify/verify-run.mjs`, `scripts/lib/schemas.mjs`; Test `tests/e2e/verify-orphan-recovery.test.mjs`

- [ ] **Step 1:** In `schemas.mjs`, add additive-optional to `VerificationV1` (passthrough, but lock the shape):
```js
orphanSweep: z.object({
  available: z.boolean(),
  found: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  errors: z.array(z.object({ name: z.string(), error: z.string() })).default([])
}).optional(),
```

- [ ] **Step 2:** In `verify-run.mjs`, the runner report already flows via the spread-merge (`report = { ...onDisk, ... }`); `orphanSweep` propagates automatically. Add nothing unless a test shows it's dropped — if so, explicitly copy it like `teardownSteps`.

- [ ] **Step 3: failing e2e** `tests/e2e/verify-orphan-recovery.test.mjs` (model on `tests/e2e/verify-self-cleaning.test.mjs`, **hard timeout 90s**):
```js
test("verify-orphan-recovery: pre-existing orphan + freshly-created dummy both swept clean", { timeout: 90000 }, async () => {
  // 1. start selfclean fixture; PRE-SEED an orphan via POST /api/selfclean/create itemName=__bf_test__dead
  // 2. write the SAME selfclean workflow as verify-self-cleaning.test.mjs (forward create + teardown delete,
  //    inputs:[itemName], safety.sandbox.available=false, teardown.dummyNaming={__bf_test__,8})
  // 3. generateRunner(runId); verifyRun(runId, { headless: true })
  // 4. forward creates __bf_test__<new>; recorded teardown deletes __bf_test__<new>; orphan sweep removes __bf_test__dead
  // 5. assert /api/selfclean/list is EMPTY (both gone)
  // 6. assert result.report.orphanSweep.available === true && removed includes "__bf_test__dead"
});
```

- [ ] **Step 4: run** with the background wall-clock guard (see lessons.md). Kill zombie Chrome before/after: `pkill -9 -f "Google Chrome.*remote-debugging"`. Expect: store empty, `orphanSweep.removed` includes `__bf_test__dead`.

- [ ] **Step 5:** Fix until green. `npm run check` GREEN.

- [ ] **Step 6: commit** — `phase 79: verify surfaces orphanSweep + idempotent orphan-recovery e2e (pre-seeded orphan swept clean)`

---

## Task 79.4: buildSearchTeardown (deterministic discovery)

**Files:** Modify `scripts/lib/teardown.mjs`; Test `tests/lib/teardown.test.mjs`

- [ ] **Step 1: failing test**
```js
import { buildSearchTeardown } from "../../scripts/lib/teardown.mjs";

test("buildSearchTeardown discovers a delete affordance from captured selectors", () => {
  const selectors = [
    { selector: "[data-bf=\"item-delete\"]", actions: ["click"], text: "Delete", ancestors: [{ role: "button" }] },
    { selector: "[data-bf=\"item-create\"]", actions: ["click"], text: "Create" }
  ];
  const td = buildSearchTeardown(selectors, "delete the item");
  assert.equal(td.strategy, "search");
  assert.equal(td.steps.length, 1);
  assert.equal(td.steps[0].action, "click");
  assert.equal(td.steps[0].selector, "[data-bf=\"item-delete\"]");
  assert.deepEqual(td.dummyNaming, { prefix: "__bf_test__", hashLen: 8 });
});

test("buildSearchTeardown returns empty steps when no affordance matches", () => {
  const td = buildSearchTeardown([{ selector: "button", actions: ["click"], text: "Create" }], "remove");
  assert.deepEqual(td.steps, []);
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** in `teardown.mjs`:
```js
import { findDeleteAffordances } from "./affordance-search.mjs";
import { deriveAtomicFp } from "./atomic-fp.mjs"; // confirm exact export name; else inline {strategy:"role"...} from entry

/**
 * Build a `search`-strategy teardown by deterministically discovering a delete
 * affordance in a captured page's selectors. Human-verified on first verify
 * (same gate as `record`). Empty steps = nothing found → operator falls back to record.
 * @param {import("./affordance-search.mjs").SelectorEntry[]} selectorEntries
 * @param {string} intent  natural-language cleanup intent (operator-supplied; reserved for ranking)
 * @param {{ prefix: string, hashLen: number }} [dummyNaming]
 */
export function buildSearchTeardown(selectorEntries, intent, dummyNaming) {
  const hits = findDeleteAffordances(selectorEntries);
  const steps = [];
  if (hits.length > 0) {
    const best = hits[0]; // first match; ranking by `intent` overlap is a later refinement
    const step = { action: "click", selector: best.selector, text: best.text };
    const fp = deriveAtomicFp({ selector: best.selector, text: best.text, ancestors: best.ancestors, siblings: best.siblings });
    if (fp) step.atomicFp = fp;
    steps.push(step);
  }
  return { strategy: "search", steps, dummyNaming: dummyNaming ?? { prefix: "__bf_test__", hashLen: 8 } };
}
```
**Implementer note:** open `scripts/lib/atomic-fp.mjs` and use its real export (the report cited a derivation around line 147–172). If the export signature differs, adapt the call; if no clean export exists, omit `atomicFp` (selector-only is valid — the runner falls back to `DOM.querySelector`). Do NOT invent an API.

- [ ] **Step 4: run, expect pass; `npm run check` GREEN.**

- [ ] **Step 5: commit** — `phase 79: buildSearchTeardown — deterministic delete-affordance discovery (search strategy)`

---

## Task 79.5: `bf teardown --search` command

**Files:** Modify `scripts/commands/teardown.mjs`, `scripts/cli.mjs`; Test `tests/commands/teardown.test.mjs`

- [ ] **Step 1: failing test** — set up a main run dir with a `workflow.json` AND a page-node dir with `selectors.json` containing a delete affordance (write under `getPageNodePaths`/`getPagesRoot` — match how `compile.mjs` writes page nodes; use the `BROWSER_FLOW_PAGES_PATH` test override). Run `runTeardownCommand({ runId, search: { intent, pageKey } })`; assert the main `workflow.json` now has `teardown.strategy === "search"` with the discovered click step. Re-read via `parseWorkflowArtifact`.
```js
test("bf teardown --search links a search-discovered teardown into main workflow", async () => {
  // write main workflow.json (with a pageKey on a step) + knowledge/pages/<pageKey>/selectors.json (delete button)
  // runTeardownCommand({ runId: mainId, search: { intent: "delete item", pageKey } })
  // re-read main workflow → teardown.strategy "search", steps[0].selector === the delete selector
});
```

- [ ] **Step 2: run, expect fail.**

- [ ] **Step 3: implement** — extend `teardown.mjs` command:
  - `teardownCommand(options)`: read `--search` (flag) + `--intent <nl>` + `--page <pageKey>` (or default to the last step's `pageKey`). When `--search` present, load `knowledge/pages/<pageKey>/selectors.json` (via config path helper), call `buildSearchTeardown(selectors, intent)`, set `mainWorkflow.teardown`, re-validate with `parseWorkflowArtifact`, write. Keep the existing `--record` path unchanged (mutually exclusive; error if both).
  - Register the new flags in `cli.mjs` help text.
```js
// in runTeardownCommand, branch:
if (input.search) {
  const pageNode = readJson(getPageNodePaths(input.search.pageKey).selectorsPath); // confirm helper name
  mainWorkflow.teardown = buildSearchTeardown(pageNode.selectors, input.search.intent);
} else {
  // existing record branch
  mainWorkflow.teardown = buildRecordTeardown(cleanupWorkflow.steps);
}
```
**Implementer note:** confirm the page-node path helper in `config.mjs` (the research cited `selectors.json` under `knowledge/pages/<pageKey>/`). Use the real exported helper; do not hardcode the path if a helper exists.

- [ ] **Step 4: run, expect pass; typecheck 0.**

- [ ] **Step 5: commit** — `phase 79: bf teardown --search links search-discovered teardown into workflow`

---

## Task 79.6: Phase 79 doc + governance

**Files:** Create `tasks/phases/phase-79-search-teardown.md`

- [ ] **Step 1: governance check** — read `.governance/state.json`. `last_constraint_review_phase=76` (next at 81 > 79 → no review). `last_eval_audit_phase=72` (next at 82 > 79 → no audit). Run `node .codex/skills/browser-flow/scripts/validate-skill.mjs` → must print "browser-flow skill validated". No governance task needed; note this in the doc.

- [ ] **Step 2: write `tasks/phases/phase-79-search-teardown.md`** (phase-doc format; quote operator: spec §③ "the operator declares cleanup intent in natural language; the system 'looks it up' by searching the captured DOM / network / page-node graph" + the 78.5-fold decision). Document: listable surface (captured selectors.json + live AX tree), deterministic `search` discovery (no LLM seam → keyword stand-in), orphan recovery (AX enumerate by prefix → re-run delete recipe), the orphan-recovery e2e as regression gate, BFS still north-star.

- [ ] **Step 3: commit** — `phase 79 doc — search teardown + orphan recovery (listable surface; BFS still north-star)`

---

## Self-Review

- **Spec §③ coverage:** deterministic `search` discovery (79.4) ✓, `bf teardown --search` link (79.5) ✓ — `record` (Phase 77) + `search` now both ship; BFS deferred (documented) ✓.
- **Spec §⑤ coverage (folded 78.5):** listable surface (79.1 live+captured) ✓, orphan sweep in runner (79.2) ✓, verify surface + idempotent e2e (79.3) ✓.
- **Placeholder scan:** 79.1/79.4 complete code; 79.2/79.3/79.5 reference established patterns (existing teardown loop, verify-self-cleaning e2e, compile page-node writer) with implementer notes flagging the two unconfirmed exports (`deriveAtomicFp`, page-node path helper) — implementer must use the real APIs, not invent.
- **Type consistency:** `SelectorEntry` shape (79.1) reused in `buildSearchTeardown` (79.4). `orphanSweep {available,found[],removed[],errors[{name,error}]}` consistent runner (79.2) → schema (79.3). Reuses `isDummyName`/`findDummies` (78.1), `installAccessibilityWatchdog().getFullAxTree` (cdp/watchdogs/accessibility.mjs), `resolveAtomicFpLocator`/`action` (existing runner).
- **Real-Chrome risk:** only 79.3 launches Chrome — mandated hard timeout + zombie kill (lessons.md). 79.1/79.4/79.5 are pure/no-Chrome.
- **Governance:** Phase 79 doc → constraint Δ=3 (<5), eval Δ=7 (<10) → no gate (verified in 79.6 Step 1).

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-20-phase-79-search-teardown.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review. **Exception:** 79.3 (real-Chrome e2e) — the controller runs/verifies it directly (subagents have hung on real-Chrome e2e this session; lessons.md), or dispatches with an explicit hard-timeout mandate.

**2. Inline Execution** — execute in this session with checkpoints.

Phase 80+ (BFS auto-teardown over `neighbors.json`; real-site mutating e2e now that self-cleaning + orphan recovery exist) detailed after 79 lands.
