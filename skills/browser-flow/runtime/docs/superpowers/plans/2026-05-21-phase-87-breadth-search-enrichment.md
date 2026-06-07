# Phase 87 — breadth-search read-only affordance enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Real-Chrome e2e (87.4) MUST use a hard `{timeout}` + zombie-kill + `rm -f profiles/*/Singleton* profiles/*/RunningChromeVersion`.** Single test files run with `node --test --import=./tests/_setup.mjs <file>` (bare `node --test` gives false isolation-guard failures).

**Goal:** Each captured page-node persists its **full affordance skeleton** (every interactive element, not just the touched step locators), and heal reads it at runtime so drift diffs compare the whole page. Read-only (no clicks/navigation), capture-time, no new command.

**Architecture:** The observer daemon already fires on main-frame `Page.frameNavigated` and snapshots per page-node. Add a read-only skeleton capture on that hook (`__bfAffordanceSkeleton` from Phase 85), persisted to a `skeleton-manifest.json`. `compile` folds it into each `mold.json` (full skeleton; falls back to the Phase-85 touched-locator derivation when absent). The runner's drift-hold branch reads `pagePaths(heldPageKey).moldPath` at runtime (pages tree = outside the security-scanned run dir) for `storedSkeleton`, falling back to step locators. Fulfils the "runtime mold read" deferred in Phase 85.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test`, TS strict checkJs. No new deps, no LLM. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-breadth-search-readonly-enrichment-design.md`.

---

## Decisions locked (spec §2 + §9 resolved)
1. **read-only** enumeration (no clicks/navigation); **capture-time** (no new command); scope = **mold + heal runtime read** (candidate-edges/staleness/active = deferred).
2. **§9.1 transport** = dedicated `skeleton-manifest.json` (`{schemaVersion, entries:[{url, skeleton}]}`), mirroring `snapshots-manifest.json`. compile maps each entry's `url` → pageKey with the same helper it uses for snapshots.
3. **§9.2 settle** = on main-frame `Page.frameNavigated`, `delay(200)` then evaluate (mirror the existing snapshot timing); best-effort (a failed capture never fails the run).
4. **§9.3 multi-visit** = latest-wins per pageKey (compile folds to the last entry for a pageKey).
5. **§9.4 pages-root** = rely on env propagation: the runner's runtime `pagePaths` uses `getPagesRoot()` (`BROWSER_FLOW_PAGES_PATH` or default), and `spawnRunner` inherits `process.env` — same isolation the registry/pages already use.

---

## File Structure
- `scripts/lib/config.mjs` — add `skeletonManifestPath` to `getRunPaths` (mirror `snapshotsManifestPath`).
- `scripts/observe/observer-daemon.mjs` — on main-frame `Page.frameNavigated` capture the affordance skeleton (read-only) → `skeletonEntries[]`; persist `skeleton-manifest.json` at `/done`.
- `scripts/analyze/compile.mjs` — read the skeleton manifest, map url→pageKey, fold latest-per-pageKey; `writePageNode` writes `mold.json` from the captured skeleton, else the Phase-85 touched-locator fallback.
- `scripts/generate/generate-runner.mjs` — drift-hold branch: read `pagePaths(heldPageKey).moldPath` at runtime for `storedSkeleton`, fallback to step locators. Add `pagePaths` import.
- Tests: `tests/analyze/compile.test.mjs` (add), `tests/generate/runner.test.mjs` (add), `tests/e2e/verify-breadth-enrichment.test.mjs` (new), `tasks/phases/phase-87-breadth-search-enrichment.md`.

---

## Task 87.1: skeleton capture in the daemon
**Files:** `scripts/lib/config.mjs`, `scripts/observe/observer-daemon.mjs`

- [ ] `config.mjs` `getRunPaths`: add `skeletonManifestPath: resolve(runRoot, "skeleton-manifest.json")` next to `snapshotsManifestPath`.
- [ ] `observer-daemon.mjs`:
  - Import the enumerator source: `import { locatorCaptureSource } from "./locator-capture.mjs";` (already in `scripts/observe/`).
  - Add `const skeletonEntries = [];` next to `snapshotEntries`.
  - Register a main-frame `Page.frameNavigated` handler **unconditionally** (NOT gated on `snapshotMode` — skeleton enrichment is always-on; the existing snapshot handler stays gated). It can be a second `session.client.on("Page.frameNavigated", ...)` listener:
```js
session.client.on("Page.frameNavigated", async (params, sessionIdArg) => {
  const p = /** @type {any} */ (params);
  if (p.frame?.parentId !== undefined && p.frame?.parentId !== null) return; // main frame only
  try {
    await delay(200);
    const sid = /** @type {string | undefined} */ (sessionIdArg);
    const targetId = sid ? findTargetIdBySessionId(session, sid) : null;
    if (!targetId) return;
    const url = await dom.currentUrl(targetId).catch(() => "");
    if (!url) return;
    const expr = "(function(){ " + locatorCaptureSource + "; return (typeof __bfAffordanceSkeleton === 'function') ? __bfAffordanceSkeleton() : []; })()";
    const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
    const skeleton = r && r.result && Array.isArray(r.result.value) ? r.result.value : [];
    if (skeleton.length > 0) skeletonEntries.push({ url, skeleton });
  } catch (skeletonError) {
    console.error("skeleton capture failed:", skeletonError instanceof Error ? skeletonError.message : String(skeletonError));
  }
});
```
  - At `/done` (next to the snapshots-manifest write), persist unconditionally when non-empty:
```js
if (skeletonEntries.length > 0) {
  writeJson(runPaths.skeletonManifestPath, { schemaVersion: 1, entries: skeletonEntries });
}
```
- [ ] Verify: `npm run check` GREEN (daemon behavior itself is proven by 87.4 e2e — this task is wiring + types). Confirm `grep -n "skeletonEntries\|skeletonManifestPath\|__bfAffordanceSkeleton" scripts/observe/observer-daemon.mjs` shows the additions.
- [ ] Commit `phase 87: daemon captures read-only affordance skeleton per page-node`.

## Task 87.2: compile folds captured skeleton into mold.json
**Files:** `scripts/analyze/compile.mjs`; Test `tests/analyze/compile.test.mjs`

- [ ] **Failing test** (add to `tests/analyze/compile.test.mjs`, match its existing setup style): write a `skeleton-manifest.json` to the run dir before `compileRun`, where the manifest's skeleton for a page contains an affordance whose `structuralKey` is NOT in any captured step. After compile, read `pagePaths(<pageKey>).moldPath` and assert its `skeleton` includes that non-touched `structuralKey`. Add a second test: with NO manifest, mold.json falls back to the touched-locator derivation (Phase 85 behavior — assert a touched key present, manifest absent).
- [ ] Run: `node --test --import=./tests/_setup.mjs tests/analyze/compile.test.mjs` → FAIL (mold has only touched keys).
- [ ] **Implement** in `compile.mjs`:
  - Near the page-node write loop (where `pageSteps` is computed, ~line 200), load the skeleton manifest once: `const skeletonByPageKey = readSkeletonManifest(runId);` where `readSkeletonManifest` reads `getRunPaths(runId).skeletonManifestPath` (via `readJsonIfExists`), maps each `entry.url` → pageKey using the SAME url→pageKey helper compile already uses for snapshots (find it near the snapshot-lift function ~line 500), folding latest-wins per pageKey → `Map<pageKey, skeleton[]>`. Empty map if manifest absent.
  - Pass the page's captured skeleton into `writePageNode(pageKey, node, fixture, pageSteps, capturedSkeleton)` (`capturedSkeleton = skeletonByPageKey.get(pageKey) ?? null`).
  - In `writePageNode`, change the mold derivation: if `capturedSkeleton` is a non-empty array, use it (dedupe by structuralKey, normalize to `{role,name,structuralKey}`); else keep the existing `pageSteps` touched-locator derivation. Write the same `{schemaVersion, pageKey, skeleton}` shape.
- [ ] Run the tests → PASS. `npm run check` GREEN. Commit `phase 87: compile writes full mold.json from captured skeleton (touched fallback)`.

## Task 87.3: runner reads mold.json at runtime for storedSkeleton
**Files:** `scripts/generate/generate-runner.mjs`; Test `tests/generate/runner.test.mjs`

- [ ] **Failing test** (add to `tests/generate/runner.test.mjs`): generate a runner and assert the source reads the mold at runtime — `assert.match(source, /pagePaths\(/)` and `assert.match(source, /moldPath/)` and that `storedSkeleton` is derived with a mold-first / step-fallback shape (e.g. source contains `readJson` of the moldPath guarded by existence + the existing step-locator fallback retained).
- [ ] Run → FAIL (runner currently derives storedSkeleton only from step locators).
- [ ] **Implement** in the runner template's drift-hold branch (currently ~line 549, the `const storedSkeleton = heldSteps.filter(...)`):
  - Add `pagePaths` to the runner's config import line: `import { getRunPaths, pagePaths } from "${rel(...config...)}"` — note the runner already imports from config; extend it. Also ensure `existsSync`/`readJson` are available in the runner (it imports from `node:fs` + `../lib/fs.mjs` for writeJson — add `readJson` import or use a small inline read).
  - Replace the storedSkeleton derivation with mold-first:
```js
const _stepSkeleton = heldSteps
  .filter((s) => s && s.locator && s.locator.structuralKey)
  .map((s) => ({ role: s.locator.role || "", name: s.locator.name || "", structuralKey: s.locator.structuralKey }));
let storedSkeleton = _stepSkeleton;
try {
  if (heldPageKey) {
    const _moldPath = pagePaths(heldPageKey).moldPath;
    if (existsSync(_moldPath)) {
      const _mold = readJson(_moldPath);
      if (_mold && Array.isArray(_mold.skeleton) && _mold.skeleton.length > 0) storedSkeleton = _mold.skeleton;
    }
  }
} catch (_e) { /* fall back to step skeleton */ }
```
  - **Escaping discipline:** these are runner-template lines — no NEW backtick/`${`; use the existing `\`` escaping convention only where the surrounding template already does. Plain `+`/quotes here (no template literals introduced). Keep all identifiers < 24 chars (security-scan rule — `pagePaths`/`storedSkeleton`/`_moldPath` are fine).
- [ ] Run → PASS. Then run the **Phase 86 heal-loop e2e** to confirm no regression: `node --test --import=./tests/_setup.mjs tests/e2e/verify-heal-loop.test.mjs` → still PASS (its synthetic workflow has no mold.json for the held pageKey, so it uses the step fallback — must still heal).
- [ ] `npm run check` GREEN. Commit `phase 87: runner reads mold.json at runtime for storedSkeleton (step fallback)`.

## Task 87.4: breadth-enrichment e2e (real Chrome) + scan-safe + doc
**Files:** Test `tests/e2e/verify-breadth-enrichment.test.mjs`; `tasks/phases/phase-87-breadth-search-enrichment.md`

- [ ] **e2e** (`{ timeout: 120000 }`, zombie-kill + Singleton cleanup at start). Use a fixture page with MORE affordances than the captured flow touches (e.g. `selfclean` has item-name/item-create/item-name-delete/item-delete — a flow that only fills item-name + clicks create touches 2, leaving 2 untouched):
  - Drive a capture (prepare → driveObservedWorkflow → done → analyze) of a flow that touches only some affordances on the page-node.
  - Assert `pagePaths(<pageKey>).moldPath` `skeleton` contains an affordance whose `structuralKey`/name corresponds to a NON-touched control (e.g. the delete button) — proves the daemon enumerated the full page, not just touched steps.
  - Then exercise heal: generate + a drift-hold (phantom locator) on that page-node → `bf heal` reads the full mold → assert the `heal-request.json` diff / stored side references the full skeleton (a non-touched affordance appears in `storedSkeleton`/diff), not just the held step.
  - Assert `securityOk === true` on the verify report (richer skeleton stays scan-safe). Model the capture/drive on `tests/e2e/full-loop.test.mjs` + the heal pieces on `tests/e2e/verify-heal-loop.test.mjs`.
- [ ] Run: `node --test --import=./tests/_setup.mjs tests/e2e/verify-breadth-enrichment.test.mjs` → PASS. (Singleton crash → `rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion`, retry.)
- [ ] **Governance**: constraint review last @86 (cadence 5 → next @91 > 87 → none); eval audit last @82 (cadence 10 → next @92 > 87 → none). `npm run validate-skill` PASS. No gate, no state bump.
- [ ] **Phase doc** `tasks/phases/phase-87-breadth-search-enrichment.md`: quote spec §1 + roadmap force #1 (paraphrase 금지); document read-only capture, full mold, heal runtime read (Phase 85 deferral resolved), agent-blind/scan-safe, deferrals (active/candidate-edges/staleness/visual).
- [ ] `npm run check` GREEN. Commit `phase 87: breadth-enrichment e2e + doc`.

---

## Self-Review
- **Spec coverage:** §3(a) daemon capture → 87.1 ✓; §3(b) compile mold → 87.2 ✓; §3(c) heal runtime read → 87.3 ✓; §3(d) scan-safe → 87.4 e2e (`securityOk`) ✓. §8 deferrals untouched.
- **Placeholder scan:** 87.2/87.3 reference an existing url→pageKey helper + the existing storedSkeleton block (concrete code given for the changed parts). The url→pageKey helper name is the one judgment lookup (flagged — implementer reads compile's snapshot-lift to reuse it).
- **Type consistency:** skeleton entry `{role,name,structuralKey}` identical across daemon (87.1) → manifest → compile mold (87.2) → runner storedSkeleton (87.3) → `diffSkeletons` (85.2). `mold.json` shape `{schemaVersion,pageKey,skeleton}` unchanged from Phase 85.
- **No-regression:** 87.3 keeps the step-locator fallback, so the Phase 86 heal-loop e2e (no mold for its synthetic pageKey) still heals — explicit re-run step.
- **Scan-safe:** mold.json lives in the pages tree (outside runRoot) so `scanArtifacts(runRoot)` never sees it; heal-request stays role/name/structuralKey only — 87.4 asserts `securityOk`.
- **Governance:** neither gate due at 87.

## Execution Handoff
Subagent-driven. 87.2 (compile, pure-ish) + 87.3 (runner template — escaping + <24-char identifiers) → fresh subagents. 87.1 (daemon real-Chrome wiring) standard. Controller runs 87.4 (real Chrome). After 87: read-only enrichment lands; follow-ups = active exploration (BFS, mutation-safe), candidate-edges, staleness, visual heal.
