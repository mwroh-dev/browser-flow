# Phase 84 — Journal-driven dangling-data cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. **Real-Chrome e2e (84.4) MUST use a hard `{timeout}` + zombie-kill + `rm -f profiles/*/Singleton* profiles/*/RunningChromeVersion`.**

**Goal:** When an automation aborts/holds mid-flow (Phase 82 drift-hold), recover the orphaned intermediate data it created — by reading the **journal** (`created[]`), deciding the scope (Phase 83 cascade), and deleting each via the **teardown recipe** (Phase 78/79). Closes the dangling-data loop: "각 단계 state 기록 → 나중에 dangling data를 찾아서 없애야."

**Architecture:** `collectDangling(journal)` (pure) extracts the artifact names a held/aborted run created. `bf cleanup --run-id <run>` reads the journal + the workflow's teardown recipe, then runs a **cleanup-only** browser pass that — reusing the Phase 79 orphan-sweep per-name teardown loop, but seeded with the JOURNAL names (not live AX) — deletes each dangling artifact and records the result. No LLM.

**Tech Stack:** Node ESM `.mjs`, Zod, `node --test`, TS strict checkJs. No new deps. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-mold-self-healing-automation-design.md` §7.

---

## Decisions locked
1. Dangling = the journal's `created[]` from ALL run segments (a held/aborted run never ran its own teardown, so everything it created is dangling). Optional scope by `affectedByHold` is informational; cleanup removes ALL journal creations of the run.
2. Removal reuses the **teardown recipe** (workflow.teardown delete steps) per name — same machinery as Phase 79 orphan sweep, but **seeded by the journal**, so it works even when the artifact isn't live-AX-visible.
3. Cleanup is its own pass (`bf cleanup`), not auto-run — operator/agent invokes it for a held run. Idempotent (deleting an already-gone item is a no-op).
4. agent-blind preserved (journal has names only; cleanup needs the site session via the existing Phase 75 keychain path if the site requires auth — out of scope for the fixture e2e).

---

## File Structure
- Create `scripts/lib/dangling.mjs` — `collectDangling(journal)`.
- Modify `scripts/generate/generate-runner.mjs` — cleanup-only path: when `BROWSER_FLOW_CLEANUP_NAMES` env present, skip forward + run the teardown delete recipe per seeded name (reuse the orphan-sweep loop), report `cleanup{requested,removed,errors}`.
- Create `scripts/commands/cleanup.mjs` + register in `scripts/cli.mjs` — `bf cleanup --run-id <run>`: read journal → collectDangling → spawn the runner in cleanup mode seeded with the names → return result.
- Modify `scripts/lib/schemas.mjs` — `VerificationV1` optional `cleanup`.
- Tests: `tests/lib/dangling.test.mjs`, `tests/generate/runner.test.mjs` add, `tests/e2e/verify-dangling-cleanup.test.mjs`.

---

## Task 84.1: collectDangling pure lib
**Files:** Create `scripts/lib/dangling.mjs`; Test `tests/lib/dangling.test.mjs`
- [ ] **Failing test:** `collectDangling([{segmentIndex:0,status:"done",created:["__bf_test__a"]},{segmentIndex:1,status:"incomplete",created:["__bf_test__b"]},{segmentIndex:2,status:"done"}])` → `["__bf_test__a","__bf_test__b"]` (deduped, in order). Empty/malformed → `[]`.
- [ ] **Implement:** flatten `created` arrays across journal entries, dedupe (preserve order), filter to non-empty strings. Tolerate missing `created`.
- [ ] Test pass; `npm run check` GREEN. Commit `phase 84: collectDangling lib (journal created[] → dangling names)`.

## Task 84.2: runner cleanup-only path
**Files:** `scripts/generate/generate-runner.mjs`; Test `tests/generate/runner.test.mjs`
- [ ] **Failing test:** generated source contains a cleanup path (`assert.match(source, /BROWSER_FLOW_CLEANUP_NAMES/); assert.match(source, /cleanup/);`).
- [ ] **Implement:** near the top of `runWorkflow` (after session setup, BEFORE the forward segment loop), add:
```js
const _cleanupRaw = process.env.BROWSER_FLOW_CLEANUP_NAMES;
if (_cleanupRaw) {
  let names = [];
  try { names = JSON.parse(_cleanupRaw); } catch (_) {}
  const cleanup = { requested: names, removed: [], errors: [] };
  const _tdSteps = workflow.teardown && Array.isArray(workflow.teardown.steps) ? workflow.teardown.steps : [];
  const _fill = _tdSteps.find((s) => s.action === "fill");
  const _act = _tdSteps.find((s) => s.action === "click" || s.action === "submit");
  const _startUrl = baseUrl ? resolveWorkflowUrl(baseUrl, resolveFixtureStartPath()) : workflow.startUrl;
  if (_fill && _act) {
    for (const nm of names) {
      try {
        await lifecycle.navigateAndWait(targetId, _startUrl, { waitUntil: "domcontentloaded", timeoutMs: 5000 }).catch(() => {});
        await action.typeIntoSelector(targetId, _fill.selector, nm);
        if (_act.action === "click") { const r = await resolveLocator(bs, targetId, _act); await action.clickByBackendNodeId(targetId, r.backendNodeId); }
        else { const fbn = await resolveLocator(bs, targetId, _act).then((r) => r.backendNodeId); await evaluateOnNode(bs, targetId, fbn, \`function() { this.requestSubmit(); }\`); }
        if (_act.expectUrl) { await waitForExpectedUrl(bs, targetId, _act.expectUrl, workflow.verification.transitionTimeoutMs); }
        cleanup.removed.push(nm);
      } catch (e) { cleanup.errors.push({ name: nm, error: e instanceof Error ? e.message : String(e) }); }
    }
  }
  return writeReport({ success: cleanup.errors.length === 0, pathComplete: true, executedSteps: [], stepCount: 0, excludedSteps: [], transitionChecks: [], resultEvidence: { passed: true, selector: "", actualText: "", expectedText: "" }, teardownSteps: [], orphanSweep: { available: false, found: [], removed: [], errors: [] }, cleanup });
}
```
(Mirror the orphan-sweep escaping; reuse `resolveLocator`, `action`, `lifecycle`, `evaluateOnNode`, `waitForExpectedUrl`, `resolveWorkflowUrl`, `resolveFixtureStartPath` — confirm in scope.) Add `cleanup` to the normal report objects too (default `null`/absent).
- [ ] `npm run check` GREEN. Commit `phase 84: runner cleanup-only path (teardown recipe per journal-seeded name)`.

## Task 84.3: bf cleanup command + schema
**Files:** Create `scripts/commands/cleanup.mjs`; Modify `scripts/cli.mjs`, `scripts/lib/schemas.mjs`, `scripts/verify/verify-run.mjs` (or spawn runner directly); Test `tests/commands/cleanup.test.mjs`
- [ ] schema: `VerificationV1` optional `cleanup: z.object({ requested: z.array(z.string()), removed: z.array(z.string()), errors: z.array(z.object({ name: z.string(), error: z.string() }).passthrough()) }).passthrough().optional()`.
- [ ] `cleanup.mjs`: `runCleanupCommand({ runId })` — `readJournal(getRunPaths(runId).journalPath)` → `collectDangling` → if empty, return `{ runId, dangling: [], removed: [] }`. Else spawn the (already-generated) runner with `BROWSER_FLOW_CLEANUP_NAMES=JSON.stringify(names)` (reuse verify-run's `spawnRunner` or a minimal spawn), read the resulting report's `cleanup`. Return `{ runId, dangling, removed, errors }`. CLI entry `cleanupCommand(options)` reads `--run-id`.
- [ ] Register `bf cleanup` in cli.mjs (import + help + dispatch).
- [ ] **Test:** unit — `runCleanupCommand` with a journal containing dangling names + a stubbed runner spawn (or assert it collects + would-seed the right names). (Real deletion covered by 84.4 e2e.)
- [ ] `npm run check` GREEN. Commit `phase 84: bf cleanup command + cleanup report schema`.

## Task 84.4: dangling-cleanup e2e (real Chrome)
**Files:** Test `tests/e2e/verify-dangling-cleanup.test.mjs`
- [ ] Use the selfclean fixture (record-strategy teardown = fill name + click delete). Scenario: (1) directly seed the store with a dangling item (POST create `__bf_test__dangling`) AND write a journal for a runId with `created:["__bf_test__dangling"]` + the workflow (with teardown recipe). (2) `bf cleanup --run-id` (or `runCleanupCommand`) → spawns the cleanup runner seeded with the journal name → deletes it. (3) Assert `/api/selfclean/list` is empty + the cleanup report `removed` includes `__bf_test__dangling`.
- [ ] Run with the wall-clock guard + zombie kill. `npm run check` GREEN. Commit `phase 84: dangling-cleanup e2e (journal-seeded teardown removes orphaned data)`.

## Task 84.5: Phase 84 doc + governance
**Files:** `tasks/phases/phase-84-dangling-cleanup.md`
- [ ] Governance: constraint last @81 (next @86 > 84 → none), eval last @82 (next @92 → none). validate-skill. No gate.
- [ ] Write the doc (quote spec + user "dangling data를 찾아서 없애야"; document journal-seeded teardown reuse, idempotent, agent-blind, closes the dangling loop).
- [ ] Commit.

---

## Self-Review
- **Spec §7 coverage:** collectDangling (84.1) ✓, journal-seeded teardown removal (84.2) ✓, command (84.3) ✓, real-Chrome proof (84.4) ✓. URL/element-identity deps + mold-diff + LLM heal = later.
- **Reuse:** teardown recipe (77/78) + orphan-sweep loop shape (79) + journal (82) + collectDangling (84). No new deletion mechanism.
- **Placeholder scan:** 84.2 cleanup-path code given; 84.3 spawn reuse + 84.4 journal-seeding flagged as implementer-judgment (reuse verify-run spawnRunner).
- **Type consistency:** `collectDangling(journal) -> string[]` (84.1) → env-seed (84.2) → cleanup report `{requested,removed,errors}` (84.2/schema 84.3).
- **Real-Chrome:** only 84.4 — hard timeout + Singleton cleanup mandated. Note the verify-orphan-recovery full-suite timeout flake (raise timeout / run standalone if it recurs).
- **Governance:** neither gate due at 84.

## Execution Handoff
Subagent-driven. 84.1 (pure) → fresh subagent. 84.2 (runner cleanup path) delicate — careful review. 84.3 (command+schema) standard. Controller runs 84.4 (real Chrome). After 84: the deterministic dangling-data loop is closed; next north-star = structural mold diff + LLM heal (the model-intervention half).
