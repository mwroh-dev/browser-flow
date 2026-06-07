# Phase 88 — Active Exploration (replay-based read-only graph BFS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Real-Chrome e2e (88.5) MUST use a hard `{timeout}` + zombie-kill + `rm -f profiles/*/Singleton* profiles/*/RunningChromeVersion`.** Single test files run with `node --test --import=./tests/_setup.mjs <file>` (bare `node --test` gives false isolation-guard failures). Runner/daemon-embedded identifiers must stay < 24 chars (security-scan high-entropy rule).

**Goal:** Expand the page-node graph by **actively clicking only safe (navigational, read-only) affordances** to depth 2, discovering new page-nodes/edges. CUD (create/update/delete) affordances are **recorded but never clicked** (destination filled lazily later, out of scope). Fork-return is **replay from the seed**. First cut targets a **synthetic fixture** with a known graph for deterministic verification.

**Architecture:** A pure `classifyAffordance` (navigate / cud / skip — conservative, reuses the Phase-76 irreversible keywords). A pure BFS orchestrator `exploreGraph(deps, options)` over **injected** side-effect ops (navigate / replay / enumerate / clickObserve) → unit-testable with fakes. A CDP driver wires the real ops (createBrowserSession + action + lifecycle + `resolveLocator` + `__bfAffordanceSkeleton`). `bf explore` runs it against the synthetic `explore` fixture and persists discovered edges to a per-page-node `explored-edges.json` (separate from compile's `neighbors.json`, no clobber).

**Tech Stack:** Node ESM `.mjs`, `node --test`, TS strict checkJs. No new deps, no LLM. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-active-exploration-readonly-bfs-design.md`.

---

## Decisions locked (spec §2 + §9 resolved)
1. depth = 2; **navigate-only click**; CUD recorded-not-clicked; replay-from-seed return; conservative classifier; synthetic-first.
2. **§9.1 classifier source**: export `isIrreversibleText(text)` from `scripts/lib/safety-classify.mjs` (wrap the existing `IRREVERSIBLE_PATTERN`; `classifyIrreversible` reuses it — DRY). New `affordance-classifier.mjs` = `isIrreversibleText` (CUD subset) **+** a create/update keyword set (추가/add/create/저장/save/수정/edit/update/등록/upload/post …) for the full CUD bucket.
3. **§9.2 replay re-resolve failure**: skip that affordance + log (v1; synthetic is stable). Never throw out of BFS.
4. **§9.3 persistence**: dedicated per-page-node `explored-edges.json` (`{pageKey, edges:[{to, via:{role,name,structuralKey}, kind:"navigate"|"cud"}]}`) via a new `pagePaths().exploredEdgesPath`. Does NOT touch compile's `neighbors.json`.
5. **§9.4 budget**: per-node navigate cap = 20, total click budget = 60, depth ≤ 2.
6. **§9.5 explore fixture graph** (deterministic expected graph): see Task 88.2.

---

## File Structure
- `scripts/lib/safety-classify.mjs` — export `isIrreversibleText(text)`.
- `scripts/lib/affordance-classifier.mjs` (new) — `classifyAffordance({role,name})`.
- `scripts/fixtures/site-server.mjs` — `explore` fixture routes (branchy graph + CUD button + click-counter).
- `scripts/explore/explorer.mjs` (new) — pure `exploreGraph(deps, options)` BFS.
- `scripts/explore/cdp-explorer.mjs` (new) — wires real CDP ops → calls `exploreGraph`.
- `scripts/commands/explore.mjs` (new) + `scripts/cli.mjs` — `bf explore`.
- `scripts/lib/config.mjs` — `exploredEdgesPath` in `pagePaths`.
- Tests: `tests/lib/affordance-classifier.test.mjs`, `tests/explore/explorer.test.mjs`, `tests/e2e/verify-active-exploration.test.mjs`, `tasks/phases/phase-88-active-exploration-bfs.md`.

---

## Task 88.1: affordance classifier (pure)
**Files:** `scripts/lib/safety-classify.mjs`, `scripts/lib/affordance-classifier.mjs`; Test `tests/lib/affordance-classifier.test.mjs`

- [ ] **safety-classify.mjs**: add + export `export function isIrreversibleText(text) { return IRREVERSIBLE_PATTERN.test(String(text || "")); }` and refactor `classifyIrreversible` to use it on the haystack (behavior identical — keep its existing tests passing).
- [ ] **Failing test** (`tests/lib/affordance-classifier.test.mjs`):
```js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyAffordance } from "../../scripts/lib/affordance-classifier.mjs";

test("cud: irreversible + create/update keywords", () => {
  for (const name of ["Delete", "삭제", "결제", "Save", "저장", "Add item", "추가", "Edit", "수정", "Send"]) {
    assert.equal(classifyAffordance({ role: "button", name }), "cud", name);
  }
});
test("navigate: links and explicit nav buttons", () => {
  assert.equal(classifyAffordance({ role: "link", name: "Catalog" }), "navigate");
  assert.equal(classifyAffordance({ role: "link", name: "" }), "navigate"); // bare link still navigable
  assert.equal(classifyAffordance({ role: "button", name: "View details" }), "navigate");
  assert.equal(classifyAffordance({ role: "button", name: "더보기" }), "navigate");
});
test("skip: ambiguous buttons + inputs (conservative — do not click)", () => {
  assert.equal(classifyAffordance({ role: "button", name: "Process" }), "skip");
  assert.equal(classifyAffordance({ role: "textbox", name: "Title" }), "skip");
  assert.equal(classifyAffordance({ role: "button", name: "" }), "skip");
});
test("cud takes precedence over a nav-looking name", () => {
  // a button that both navigates and mutates → conservative cud
  assert.equal(classifyAffordance({ role: "button", name: "Save and view" }), "cud");
});
```
- [ ] **Implement** `scripts/lib/affordance-classifier.mjs`:
```js
import { isIrreversibleText } from "./safety-classify.mjs";

const CUD_PATTERN = /(추가|\badd\b|create|생성|새 |\bnew\b|저장|save|수정|\bedit\b|update|등록|register|업로드|upload|작성|\bpost\b|댓글|comment|좋아요|\blike\b|rename|이름.?바꾸기)/i;
const SAFE_NAV_PATTERN = /(보기|view|open|열기|상세|detail|다음|\bnext\b|더보기|more|이전|\bprev\b|tab|탭|filter|필터|catalog|목록|list|home|홈|back to)/i;

/**
 * Conservative read-only-navigation classifier.
 * cud  = irreversible/CUD keyword (recorded, NEVER clicked)
 * navigate = role=link, or a button whose name is an explicit nav term (clicked)
 * skip = everything else — ambiguous buttons, inputs (not clicked)
 * @param {{ role?: string, name?: string }} aff
 * @returns {"navigate" | "cud" | "skip"}
 */
export function classifyAffordance(aff) {
  const name = String((aff && aff.name) || "");
  const role = String((aff && aff.role) || "");
  if (isIrreversibleText(name) || CUD_PATTERN.test(name)) return "cud"; // cud wins
  if (role === "link") return "navigate";
  if (role === "button" && SAFE_NAV_PATTERN.test(name)) return "navigate";
  return "skip";
}
```
- [ ] Run: `node --test --import=./tests/_setup.mjs tests/lib/affordance-classifier.test.mjs` → pass. Also run the existing safety-classify test to confirm no regression. `npm run check` GREEN. Commit `phase 88: affordance classifier (navigate/cud/skip, conservative)`.

## Task 88.2: explore fixture (known graph)
**Files:** `scripts/fixtures/site-server.mjs`; Test `tests/fixtures/explore-fixture.test.mjs` (or fold into an existing fixture test)

- [ ] Add an in-memory `let exploreCudClicks = 0;` counter + routes implementing this **known graph**:
  - `GET /explore` (hub): `<a data-bf="to-a" href="/explore/a">Section A</a>`, `<a data-bf="to-b" href="/explore/b">Section B</a>`, `<button data-bf="cud-del">Delete everything</button>` (the CUD trap — its handler/JS calls `POST /explore/cud` which increments `exploreCudClicks`). A `<input>` (skip). 
  - `GET /explore/a`: `<a data-bf="to-ax" href="/explore/a/x">Detail X</a>` (depth-2 node).
  - `GET /explore/a/x`: leaf (`<h1>` only).
  - `GET /explore/b`: `<a data-bf="back" href="/explore">Back to hub</a>` (cycle → hub already visited).
  - `POST /explore/cud`: `exploreCudClicks += 1; res 200`.
  - `GET /explore/cud-count`: returns `{ clicks: exploreCudClicks }` (test reads this to assert the CUD button was NOT clicked).
- [ ] **Expected graph** (depth 2 from `/explore`, navigate-only): edges `explore→explore/a` (to-a), `explore→explore/b` (to-b), `explore→(cud)` (cud-del, to:null, NOT clicked), `explore/a→explore/a/x` (to-ax); `explore/b→explore` recorded but hub already visited (no re-explore); `explore/a/x` leaf. The `<input>` is skip. The "Delete everything" button is `cud`.
- [ ] Test: a fixture test asserting each route serves the expected affordances (GET each path, check the data-bf controls present) + `/explore/cud-count` starts at 0.
- [ ] `npm run check` GREEN. Commit `phase 88: explore fixture (known 2-depth graph + CUD trap + click counter)`.

## Task 88.3: explorer BFS core (pure)
**Files:** `scripts/explore/explorer.mjs`; Test `tests/explore/explorer.test.mjs`

- [ ] **Failing test** — drive the BFS with an in-memory fake site (so it's pure/deterministic, no Chrome). Deps injected:
  - `enumerate(pageKey)` → affordances at that page (array `{role,name,structuralKey}`).
  - `clickObserve(clickPrefix, aff)` → destination pageKey (the fake "replay prefix then click aff" — returns where it lands). Records into a `clicked[]` array so the test asserts CUD was never passed to clickObserve.
  - `classify` = the real `classifyAffordance`.
```js
import test from "node:test";
import assert from "node:assert/strict";
import { exploreGraph } from "../../scripts/explore/explorer.mjs";
import { classifyAffordance } from "../../scripts/lib/affordance-classifier.mjs";

// Fake site: hub -> a (link), hub -> b (link), hub -> [Delete] (cud), a -> a/x (link), b -> hub (link, cycle)
const SITE = {
  "hub":  [{ role: "link", name: "A", structuralKey: "ka" }, { role: "link", name: "B", structuralKey: "kb" }, { role: "button", name: "Delete", structuralKey: "kd" }],
  "a":    [{ role: "link", name: "X", structuralKey: "kx" }],
  "ax":   [],
  "b":    [{ role: "link", name: "Hub", structuralKey: "kh" }]
};
const DEST = { "ka": "a", "kb": "b", "kx": "ax", "kh": "hub" }; // navigate destinations by structuralKey

test("exploreGraph: depth-2 BFS, cud recorded-not-clicked, cycle skip", async () => {
  const clicked = [];
  const graph = await exploreGraph({
    seedPageKey: "hub",
    enumerate: async (pageKey) => SITE[pageKey] || [],
    clickObserve: async (prefix, aff) => { clicked.push(aff.structuralKey); return DEST[aff.structuralKey] || "hub"; },
    classify: classifyAffordance
  }, { depth: 2, navCapPerNode: 20, totalBudget: 60 });

  // edges discovered (from -> to via kind)
  const e = (from, key) => graph.edges.find((x) => x.from === from && x.via.structuralKey === key);
  assert.equal(e("hub", "ka").to, "a");
  assert.equal(e("hub", "ka").kind, "navigate");
  assert.equal(e("hub", "kb").to, "b");
  assert.equal(e("hub", "kd").kind, "cud");
  assert.equal(e("hub", "kd").to, null);                 // cud not navigated
  assert.ok(!clicked.includes("kd"), "CUD affordance must NEVER be clicked");
  assert.equal(e("a", "kx").to, "ax");                   // depth 2 reached
  // b -> hub edge recorded but hub already visited → not re-explored (no depth-3)
  assert.ok(!graph.edges.some((x) => x.from === "ax"), "leaf ax has no outgoing");
  // visited set is the 4 reachable nav nodes
  assert.deepEqual([...graph.nodes].sort(), ["a", "ax", "b", "hub"]);
});
```
- [ ] **Implement** `scripts/explore/explorer.mjs` `exploreGraph(deps, options)`:
  - frontier queue of `{ pageKey, clickPrefix }`, `visited = new Set()`, `edges = []`, `nodes = new Set()`, `clicks = 0`.
  - start: enqueue `{ seedPageKey, [] }`, depth tracked per frontier item (`depth: 0`).
  - loop while frontier non-empty and `clicks < totalBudget`: dequeue `node`; if visited skip; `visited.add`; `nodes.add(node.pageKey)`; `affs = await enumerate(node.pageKey)`; for each aff (cap `navCapPerNode` navigates): `c = classify(aff)`:
    - `cud`: `edges.push({from: node.pageKey, to: null, via: aff, kind: "cud"})` (no click).
    - `navigate` and `node.depth < depth` and budget: `clicks++`; `dest = await clickObserve(node.clickPrefix, aff)`; `edges.push({from, to: dest, via: aff, kind: "navigate"})`; `nodes.add(dest)`; if `dest` not visited and `node.depth+1 < depth`... (enqueue with `depth: node.depth+1`, `clickPrefix: [...node.clickPrefix, aff]`). (Careful: enqueue even at depth boundary so its edges-from could be recorded only if within depth — but per spec depth 2 = explore hub(0) + its children(1); children's children(2) are recorded as nodes via edges but only expanded if depth allows. Match the test: ax is reached (edge a→ax) and is a leaf with no outgoing because depth budget stops expanding it.)
    - `skip`: ignore.
  - return `{ nodes, edges }`.
  - Pure: only calls injected `enumerate`/`clickObserve`/`classify`. No CDP, no IO.
- [ ] Run the test → pass. `npm run check` GREEN. Commit `phase 88: pure BFS explorer (depth-2, cud-safe, cycle-skip)`.

## Task 88.4: CDP explorer driver + bf explore command
**Files:** `scripts/explore/cdp-explorer.mjs`, `scripts/commands/explore.mjs`, `scripts/cli.mjs`, `scripts/lib/config.mjs`; Test `tests/commands/explore.test.mjs` (light — command shape)

- [ ] `config.mjs` `pagePaths`: add `exploredEdgesPath: resolve(pageDir, "explored-edges.json")`.
- [ ] `scripts/explore/cdp-explorer.mjs`: build the real deps for `exploreGraph`:
  - `enumerate(pageKey)`: (the driver is already AT the page after navigate+replay) → `Runtime.evaluate(locatorCaptureSource + "; __bfAffordanceSkeleton()")` → affordances.
  - `clickObserve(clickPrefix, aff)`: `navigate(seedUrl)`; for each prior aff in clickPrefix → `resolveLocator` + `action.clickByBackendNodeId` + settle; then `resolveLocator(aff)` + click + settle; read `currentUrl` → `derivePageKey(url, fixture)`. On any resolve failure → return a sentinel/skip (caught, logged).
  - Uses: createBrowserSession, installActionWatchdog, installLifecycleWatchdog, resolveLocator, locatorCaptureSource, derivePageKey. Reuse the demo-driver/daemon CDP patterns. Identifiers <24 chars.
- [ ] `scripts/commands/explore.mjs` `runExploreCommand({ fixture, depth, headless })`: start the fixture server (synthetic), createBrowserSession, build deps via cdp-explorer, `await exploreGraph(deps, {depth: depth??2, navCapPerNode:20, totalBudget:60})`, persist edges grouped by `from` pageKey → `pagePaths(from).exploredEdgesPath`, close session+server, return `{ fixture, depth, nodes:[...], edges:[...] }`. `exploreCommand(options)` parses `--fixture`/`--depth`/`--headless`.
- [ ] `cli.mjs`: import + register `if (command === "explore") { ...JSON.stringify(await exploreCommand(options))... }` (mirror the `cleanup`/`heal` blocks) + help line `explore   Discover navigable graph from a page (read-only BFS, depth 2) — --fixture <x> [--depth N] (Phase 88)`.
- [ ] Light unit/source test: `tests/commands/explore.test.mjs` asserts `exploreCommand` requires `--fixture` and the cli help lists `explore`. (Full behavior in 88.5 e2e.)
- [ ] `npm run check` GREEN. Commit `phase 88: bf explore command + CDP explorer driver`.

## Task 88.5: active-exploration e2e (real Chrome) + doc + governance
**Files:** Test `tests/e2e/verify-active-exploration.test.mjs`; `tasks/phases/phase-88-active-exploration-bfs.md`

- [ ] **e2e** (`{ timeout: 120000 }`, zombie-kill + Singleton cleanup at start). `runExploreCommand({ fixture: "explore", depth: 2, headless: true })`:
  - Assert discovered `edges`/`nodes` == the expected graph (88.2): nav edges hub→a, hub→b, a→a/x; cud edge hub→(cud-del, to:null, kind:"cud"); nodes = {explore, explore/a, explore/b, explore/a/x}; no expansion past depth 2.
  - **CUD safety assertion**: `fetch(<baseUrl>/explore/cud-count)` (or read via the returned report) → `clicks === 0` — the "Delete everything" button was recorded but NEVER clicked.
  - Assert `explored-edges.json` was written for the hub page-node with the nav + cud edges.
  - (The explorer starts its own fixture server; capture its baseUrl from the command result or have the command expose it for the cud-count check.)
- [ ] Run: `node --test --import=./tests/_setup.mjs tests/e2e/verify-active-exploration.test.mjs` → PASS.
- [ ] **Governance**: constraint review last @86 (next @91 > 88 → none); eval audit last @82 (next @92 > 88 → none). `npm run validate-skill` PASS. No gate, no state bump.
- [ ] **Phase doc** `tasks/phases/phase-88-active-exploration-bfs.md`: quote spec §1 + user quotes (paraphrase 금지); document depth-2 navigate-only BFS, CUD recorded-not-clicked + lazy-fill deferral, replay-from-seed return, conservative classifier + cud-safety, synthetic-first, deferrals (real-site/CUD-fill/depth>2).
- [ ] `npm run check` GREEN. Commit `phase 88: active-exploration e2e + doc`.

---

## Self-Review
- **Spec coverage:** §3(a) classifier → 88.1 ✓; §3(b) explorer (pure core 88.3 + CDP driver 88.4) ✓; §3(c) command → 88.4 ✓; §3(d) persistence → 88.4 (`explored-edges.json`) ✓; §3(e) safety → classifier gate (88.1) + cud-not-clicked (88.3 unit + 88.5 e2e cud-count) ✓; §5 fixture → 88.2 ✓. §8 deferrals untouched.
- **Placeholder scan:** 88.1/88.3 ship full code+tests. 88.4 (CDP driver) describes the injected ops concretely + reuses named existing modules (resolveLocator/locatorCaptureSource/derivePageKey/action) — the one judgment area (flagged: clickObserve replay loop). 88.2 fixture graph is fully specified.
- **Type consistency:** affordance `{role,name,structuralKey}` consistent: classifier(88.1) ↔ skeleton(87) ↔ explorer deps(88.3) ↔ CDP enumerate(88.4). edge `{from,to,via,kind}` identical across 88.3/88.4/88.5. `exploreGraph(deps, options)` signature stable.
- **Safety:** cud is NEVER passed to clickObserve (88.3 unit asserts; 88.5 e2e asserts cud-count==0). Conservative classifier (ambiguous→skip/cud). synthetic-first → zero real-site mutation.
- **Governance:** neither gate due at 88.
- **<24-char rule:** CDP driver identifiers kept short (88.4 note).

## Execution Handoff
Subagent-driven. 88.1 (classifier, pure) + 88.3 (BFS core, pure) → fresh subagents, mechanical TDD. 88.2 (fixture) standard. 88.4 (CDP driver — escaping/<24-char + replay loop) careful. Controller runs 88.5 (real Chrome). After 88: read-only graph BFS lands; follow-ups = real-site exploration (full safety stack), CUD destination lazy-fill, depth>2.
