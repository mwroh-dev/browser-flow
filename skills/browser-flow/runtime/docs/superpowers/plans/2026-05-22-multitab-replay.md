# Multi-Tab Replay (Phase 94 + 95) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay flows where a click opens a new tab — capture tags each event with a creation-order tab ordinal, and the runner switches its active target to follow new tabs (and back), aligning capture's Nth tab to replay's Nth tab.

**Architecture:** Tab identity = creation-order **ordinal** (targetId is per-run, not stable). Phase 94 (capture): the recorder already attaches to every target and supplies `targetId` per event — the daemon assigns ordinals and tags events; compile propagates `step.tabOrdinal`. Phase 95 (replay): the runner keeps an `ordinalToTargetId` map and, before each step, switches the active `targetId` to the step's ordinal (waiting for a newly-created target the first time). Fail-safe: a new tab that never appears → drift-hold.

**Tech Stack:** Node ESM (`.mjs`), `node --test`, zod, chrome-remote-interface + devtools-protocol (CDP `Target.setAutoAttach`/`attachedToTarget`, already enabled), real-Chrome e2e.

**Spec:** `docs/superpowers/specs/2026-05-22-multitab-replay-design.md` (approved, web-validated).

**Conventions:**
- Single test: `node --test --import=./tests/_setup.mjs <file>`; full: `npm run check`
- Before any real-Chrome run: `pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion`
- Commit after each task. No `--no-verify`.
- Generated-runner identifiers < 24 chars (secret scanner `HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9+=]{24,}\b/`).
- agent-blind: tab identity is an integer ordinal; never persist a targetId.

---

## File Structure

| File | Responsibility | Phase | Action |
|------|----------------|-------|--------|
| `scripts/cdp/session-manager.mjs` | target tracking | 94 | Modify — preserve `openerId` in TargetInfo |
| `scripts/observe/observer-daemon.mjs` | capture event collection | 94 | Modify — ordinal map + tag `tabOrdinal`/`openerOrdinal` |
| `scripts/sanitize/event-sanitizer.mjs` | event sanitization | 94 | Modify — preserve `tabOrdinal` in `base` |
| `scripts/lib/schemas.mjs` | artifact schemas | 94 | Modify — `Step.tabOrdinal`, workflow `tabCount` |
| `scripts/analyze/compile.mjs` | workflow build | 94 | Modify — propagate `tabOrdinal` + `tabCount` |
| `scripts/fixtures/site-server.mjs` | test fixtures | 95 | Modify — `multitab` fixture (new-tab) |
| `scripts/generate/generate-runner.mjs` | replay runner | 95 | Modify — ordinal target map + per-step switch |
| `tests/cdp/session-manager.test.mjs` | unit | 94 | Modify/Create |
| `tests/analyze/compile-tabordinal.test.mjs` | unit | 94 | Create |
| `tests/e2e/verify-multitab.test.mjs` | e2e | 95 | Create |
| `tasks/phases/phase-94-multitab-capture.md`, `phase-95-multitab-replay.md` | docs | both | Create |

---

## PHASE 94 — Capture Tagging

### Task 1: Preserve openerId in session-manager TargetInfo

**Files:**
- Modify: `scripts/cdp/session-manager.mjs` (TargetInfo typedef ~line 2-7; `Target.attachedToTarget` info object ~line 36-41)
- Test: `tests/cdp/session-manager.test.mjs`

- [ ] **Step 1: Write the failing test**

Read `tests/cdp/session-manager.test.mjs` if it exists (mirror its harness — these tests use a fake CDP client emitting events). If absent, create it modeling the existing test's fake-client pattern. Add:

```js
test("listPageTargets exposes openerId from attachedToTarget", () => {
  const { client, emit } = makeFakeClient(); // existing helper in this test file
  // (createSessionManager is async)
  return createSessionManager(client).then((mgr) => {
    emit("Target.attachedToTarget", { sessionId: "s1", targetInfo: { targetId: "t0", type: "page", url: "about:blank", title: "" } });
    emit("Target.attachedToTarget", { sessionId: "s2", targetInfo: { targetId: "t1", type: "page", url: "http://x/popup", title: "", openerId: "t0" } });
    const tabs = mgr.listPageTargets();
    const popup = tabs.find((t) => t.targetId === "t1");
    assert.equal(popup.openerId, "t0", "popup TargetInfo must carry openerId");
    const root = tabs.find((t) => t.targetId === "t0");
    assert.equal(root.openerId, undefined, "root tab has no opener");
  });
});
```

If the test file has no `makeFakeClient`/`emit` helper, READ the file and use whatever pattern it already uses to drive `client.on(...)` handlers (e.g. a tiny EventEmitter-backed stub). Do not invent a new harness if one exists.

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --import=./tests/_setup.mjs tests/cdp/session-manager.test.mjs`
Expected: FAIL — `popup.openerId` undefined.

- [ ] **Step 3: Implement**

In `scripts/cdp/session-manager.mjs`:
- Extend the TargetInfo typedef (after `@property {string} title`):
```js
 * @property {string} [openerId]
```
- In the `Target.attachedToTarget` handler, add `openerId` to the `info` object:
```js
    const info = {
      targetId: p.targetInfo.targetId,
      type: p.targetInfo.type,
      url: p.targetInfo.url,
      title: p.targetInfo.title,
      openerId: p.targetInfo.openerId
    };
```
(`openerId` is `undefined` for the root tab; `p.targetInfo.openerId` is a valid CDP field — confirmed in `node_modules/devtools-protocol/types/protocol.d.ts`.)

- [ ] **Step 4: Run, expect PASS + typecheck**

```
node --test --import=./tests/_setup.mjs tests/cdp/session-manager.test.mjs
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add scripts/cdp/session-manager.mjs tests/cdp/session-manager.test.mjs
git commit -m "phase 94: session-manager preserves TargetInfo.openerId (popup->opener link)"
```

---

### Task 2: Daemon tags events with tabOrdinal + sanitizer preserves it

**Files:**
- Modify: `scripts/observe/observer-daemon.mjs` (`installRecorderWatchdog` onEvent ~line 117-126)
- Modify: `scripts/sanitize/event-sanitizer.mjs` (`base` object ~line 47-51)
- Test: covered by Task 3's compile test + the e2e (the daemon path is real-Chrome; unit-test the pure ordinal helper)

The recorder already calls `onEvent(payload, { sessionId, targetId })` (see `scripts/cdp/watchdogs/recorder.mjs`). The daemon currently ignores the 2nd arg. Assign ordinals by first-seen targetId order.

- [ ] **Step 1: Add a pure ordinal-assigner helper + unit test**

Create `tests/observe/tab-ordinal.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeTabOrdinal } from "../../scripts/observe/tab-ordinal.mjs";

test("makeTabOrdinal assigns 0,1,2 by first-seen targetId order", () => {
  const t = makeTabOrdinal();
  assert.equal(t.ordinalFor("a"), 0);
  assert.equal(t.ordinalFor("a"), 0); // stable
  assert.equal(t.ordinalFor("b"), 1);
  assert.equal(t.ordinalFor("c"), 2);
  assert.equal(t.ordinalFor("b"), 1);
  assert.equal(t.ordinalFor(""), 0, "empty/unknown targetId -> 0 (initial)");
});
```

Create `scripts/observe/tab-ordinal.mjs`:
```js
// @ts-check
// Pure first-seen ordinal assigner for capture tab tagging. targetId is per-run;
// the ordinal (creation order) is the stable cross-run key. Empty/unknown -> 0.
export function makeTabOrdinal() {
  /** @type {Map<string, number>} */ const map = new Map();
  let next = 0;
  return {
    /** @param {string} targetId @returns {number} */
    ordinalFor(targetId) {
      if (!targetId) return 0;
      if (!map.has(targetId)) map.set(targetId, next++);
      return /** @type {number} */ (map.get(targetId));
    },
    /** @returns {number} count of distinct targets seen (>=1) */
    count() { return Math.max(1, next); }
  };
}
```

Run: `node --test --import=./tests/_setup.mjs tests/observe/tab-ordinal.test.mjs` → expect FAIL then PASS after creating the module.

- [ ] **Step 2: Wire the ordinal assigner into the daemon**

In `scripts/observe/observer-daemon.mjs`:
- Import at top: `import { makeTabOrdinal } from "./tab-ordinal.mjs";`
- Near `const rawEvents = [];` (line 85), add: `const tabOrdinal = makeTabOrdinal();`
- Change the recorder `onEvent` (line 120) from `onEvent(payload) {` to accept meta and tag:
```js
    onEvent(payload, meta) {
      const ord = tabOrdinal.ordinalFor(meta && meta.targetId ? meta.targetId : "");
      const tagged = { ...(/** @type {any} */ (payload)), tabOrdinal: ord };
      rawEvents.push(/** @type {any} */ (tagged));
      appendRawEvent(runPaths, /** @type {any} */ (tagged));
    },
```
(The initial tab's events get ordinal 0; a new tab's first event registers ordinal 1, etc. `openerOrdinal` is derivable later from session-manager `openerId` → its ordinal; for v1, ordinal-order alone drives alignment, so we tag only `tabOrdinal`. openerId capture exists at the session-manager layer (Task 1) for future disambiguation.)

- [ ] **Step 3: Preserve tabOrdinal through the sanitizer**

In `scripts/sanitize/event-sanitizer.mjs`, add to the shared `base` object (line 47-51) so every event type carries it:
```js
  const base = {
    type: event.type,
    timestamp: event.timestamp ?? Date.now(),
    url: event.url ? sanitizeUrl(event.url, sanitizeOpts) : undefined,
    tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : undefined
  };
```

- [ ] **Step 4: Run unit + typecheck**

```
node --test --import=./tests/_setup.mjs tests/observe/tab-ordinal.test.mjs
npm run typecheck
```
Expected: PASS, typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/observe/tab-ordinal.mjs scripts/observe/observer-daemon.mjs scripts/sanitize/event-sanitizer.mjs tests/observe/tab-ordinal.test.mjs
git commit -m "phase 94: daemon tags rawEvents with first-seen tabOrdinal; sanitizer preserves it (agent-blind integer)"
```

---

### Task 3: compile propagates tabOrdinal + schema

**Files:**
- Modify: `scripts/lib/schemas.mjs` (`Step` shape; `WorkflowV1`)
- Modify: `scripts/analyze/compile.mjs` (step build: fill ~line 130, click/submit ~line 165; workflow object)
- Test: `tests/analyze/compile-tabordinal.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/analyze/compile-tabordinal.test.mjs`. This is a unit test of the compile output for events carrying tabOrdinal. Model it on an existing compile test (read `tests/analyze/compile.test.mjs` for how it seeds `sanitizedEventsPath` + calls the compile entry). Assert:
```js
// after seeding sanitized events: goto(tab0), click(tab0 opens tab), click(tab1), then compiling
assert.equal(workflow.steps.find(s => s.action === "click" && s.tabOrdinal === 1) !== undefined, true, "a click step must carry tabOrdinal 1");
assert.equal(workflow.tabCount, 2, "tabCount reflects two tabs");
// legacy: events with no tabOrdinal -> steps default to 0 and tabCount 1
```
(Use the SAME seeding mechanism the existing compile test uses — read it first; do not invent a new harness.)

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --import=./tests/_setup.mjs tests/analyze/compile-tabordinal.test.mjs`

- [ ] **Step 3: Implement schema (schemas.mjs)**

In the `Step` zod object (`.passthrough()` — find it ~line 78-98), add before the closing:
```js
    // Phase 94: tab the step belongs to (creation-order ordinal; 0 = initial tab).
    // Absent on legacy single-tab workflows -> treated as 0 by the runner.
    tabOrdinal: z.number().int().nonnegative().optional(),
```
In `WorkflowV1` (additive-optional fields block ~line 160-169), add:
```js
    tabCount: z.number().int().positive().optional(),
```

- [ ] **Step 4: Implement compile (compile.mjs)**

- For the `input`→fill step (the `fillStep` object ~line 130-136): add `tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : 0,`.
- For the `click`/`submit` step (`lastAction` object ~line 165-179): add `tabOrdinal: typeof event.tabOrdinal === "number" ? event.tabOrdinal : 0,`.
- The `goto` step (line 96-102): set `tabOrdinal: 0`.
- After `steps` are built + before the workflow object, compute:
```js
  const tabCount = steps.reduce((m, s) => Math.max(m, (typeof s.tabOrdinal === "number" ? s.tabOrdinal : 0) + 1), 1);
```
- Add `tabCount` to the `workflow` object (near `segments`).

(Legacy events lack `tabOrdinal` → all steps get 0 → `tabCount` 1 → identical to current behavior.)

- [ ] **Step 5: Run + typecheck + a sanity existing-compile run**

```
node --test --import=./tests/_setup.mjs tests/analyze/compile-tabordinal.test.mjs tests/analyze/compile.test.mjs
npm run typecheck
```
Expected: new test PASS; existing compile.test.mjs still PASS (legacy steps get tabOrdinal 0 — if an existing test does a strict `deepEqual` on a step object, it will now see `tabOrdinal: 0`; update that assertion to include it or assert fields individually, exactly as Phase 92 did for the form-input disambiguation case).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/schemas.mjs scripts/analyze/compile.mjs tests/analyze/compile-tabordinal.test.mjs tests/analyze/compile.test.mjs
git commit -m "phase 94: compile propagates step.tabOrdinal + workflow.tabCount (legacy single-tab -> 0/1, unchanged)"
```

---

### Task 4: Phase 94 doc + check

**Files:**
- Create: `tasks/phases/phase-94-multitab-capture.md`
- Append: `tasks/lessons.md`

- [ ] **Step 1: Write `tasks/phases/phase-94-multitab-capture.md`**

Follow `phase-93-reactive-scoring-loop.md` structure. Cover: user quote ("멀티탭으로 해보자"), the finding (recorder already supplies targetId; daemon discarded it), ordinal model, openerId web-validation, the A1-A3 changes, agent-blind (integer ordinal), legacy no-op, governance no-gate (constraint review next 96, eval audit next 102; state unchanged).

- [ ] **Step 2: Append a lesson to `tasks/lessons.md`**

Execution-learning: the capture stack was already multi-target (setAutoAttach + recorder per-target + targetId in onEvent meta) — the only capture gap was the daemon dropping the meta. Lesson: before building "multi-X support", check how far the existing event source already carries X (here, targetId was already there, unused).

- [ ] **Step 3: Full check**

```
pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion
npm run check
```
Expected: GREEN (0 fail / 0 skipped; a one-off real-Chrome flake on an unrelated e2e — re-run to confirm, as in prior phases).

- [ ] **Step 4: Commit**

```bash
git add tasks/phases/phase-94-multitab-capture.md tasks/lessons.md
git commit -m "phase 94: capture tagging complete (tabOrdinal) + doc + lesson (no governance gate)"
```

---

## PHASE 95 — Replay Following

### Task 5: multitab fixture

**Files:**
- Modify: `scripts/fixtures/site-server.mjs` (add `multitab` page consts + routes, mirror the Phase 92 `navtab` additions)

- [ ] **Step 1: Add fixture pages + routes**

Add module-level page consts next to other fixtures (use the file's `respondHtml` helper + `style` var):
```js
// Phase 95: multitab fixture — a link that opens a new tab (target=_blank) to /multitab/popup,
// where the replay must continue (click the confirm) and reach evidence.
const multitabPage = `<!doctype html>
<html><head><meta charset="utf-8" /><title>multitab</title><style>${style}</style></head>
<body><main>
  <h1 data-bf-evidence="multitab">Multitab</h1>
  <a data-bf="open-popup" href="/multitab/popup" target="_blank">Open popup</a>
</main></body></html>`;

const multitabPopupPage = `<!doctype html>
<html><head><meta charset="utf-8" /><title>multitab popup</title><style>${style}</style></head>
<body><main>
  <h1 data-bf-evidence="popup">Popup</h1>
  <button data-bf="confirm" type="button" onclick="document.getElementById('done').textContent='Confirmed'">Confirm</button>
  <p id="done" data-bf-evidence="done"></p>
</main></body></html>`;
```
Add routes next to the navtab routes:
```js
    if (request.method === "GET" && url.pathname === "/multitab/popup") { respondHtml(response, multitabPopupPage); return; }
    if (request.method === "GET" && url.pathname === "/multitab") { respondHtml(response, multitabPage); return; }
```

- [ ] **Step 2: Sanity — server starts**

Run: `node --test --import=./tests/_setup.mjs tests/e2e/verify-navtab-weightoverride.test.mjs` (any test that calls `startFixtureServer`) to confirm the fixture file still loads without syntax error.
Expected: PASS (unchanged behavior).

- [ ] **Step 3: Commit**

```bash
git add scripts/fixtures/site-server.mjs
git commit -m "phase 95: multitab fixture (target=_blank link -> popup page with confirm + evidence)"
```

---

### Task 6: runner follows tabs (ordinal target switching)

**Files:**
- Modify: `scripts/generate/generate-runner.mjs` (firstTarget/targetId binding ~line 411-415; step loop ~line 493-545; add helpers near other top-level runner helpers)

- [ ] **Step 1: Add the runner helpers (top-level in the runner template; names < 24 chars)**

Add next to the other runner helpers (e.g. near `parseDriftMetrics`):
```js
async function waitForNewTarget(bs, known, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 30000);
  const seen = new Set(Object.values(known));
  while (Date.now() < deadline) {
    for (const t of bs.sessionManager.listPageTargets()) {
      if (!seen.has(t.targetId)) {
        const sid = bs.sessionManager.getSessionId(t.targetId);
        if (sid) {
          try {
            const r = await bs.client.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, sid);
            const rs = r && r.result ? r.result.value : "";
            if (rs === "interactive" || rs === "complete") return t.targetId;
          } catch (_e) { /* target not ready yet */ }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timeout waiting for new tab (tabOrdinal)");
}

async function resolveTabTarget(bs, ordMap, ordinal, timeoutMs) {
  if (ordMap[ordinal] !== undefined) return ordMap[ordinal];
  const tid = await waitForNewTarget(bs, ordMap, timeoutMs);
  ordMap[ordinal] = tid;
  return tid;
}
```

- [ ] **Step 2: Make targetId reassignable + add the ordinal map**

At line ~411-415, change:
```js
  const [firstTarget] = bs.sessionManager.listPageTargets();
  if (!firstTarget) { ... }
  const targetId = firstTarget.targetId;
```
to:
```js
  const [firstTarget] = bs.sessionManager.listPageTargets();
  if (!firstTarget) { ... }
  let targetId = firstTarget.targetId;
  const ordinalToTargetId = { 0: firstTarget.targetId };
```
(Keep the existing `if (!firstTarget)` throw block unchanged.)

- [ ] **Step 3: Switch active target at the top of each step**

In the inner step loop (`for (let stepIndex = segStart; ...)`, right after `const step = workflow.steps[stepIndex];` and after the `curStepIndex = stepIndex;` line added in Phase 93), add:
```js
          // Phase 95: follow the step's tab — switch active target (wait for a new tab the first time).
          targetId = await resolveTabTarget(bs, ordinalToTargetId, step.tabOrdinal ?? 0, workflow.verification.transitionTimeoutMs);
```
Because every step action in the loop already uses the `targetId` variable, reassigning it here makes resolve/click/fill/waitForExpectedUrl all run against the step's tab. No other edits in the loop body.

NOTE: a `Timeout waiting for new tab` throw propagates to the segment catch → drift-hold (fail-safe; the new tab never opened). This is a no-match-class drift (not "ambiguous locator") so Phase 93 routing leaves it on the heal path — correct.

- [ ] **Step 4: Verify runner regenerates + no single-tab regression**

```
pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion
npm run typecheck
node --test --import=./tests/_setup.mjs tests/e2e/full-loop.test.mjs tests/e2e/verify-navtab-weightoverride.test.mjs
```
Expected: typecheck 0; single-tab e2e still PASS (all steps tabOrdinal 0/undefined → ordinalToTargetId[0] = firstTarget → no new-tab wait → identical behavior). If a generated runner has a syntax error, `node --check` a generated runner.mjs.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate/generate-runner.mjs
git commit -m "phase 95: runner follows tabs — per-step active-target switch by tabOrdinal (waitForNewTarget; legacy single-tab unchanged)"
```

---

### Task 7: e2e verify-multitab (follow new tab + fail-safe)

**Files:**
- Test: `tests/e2e/verify-multitab.test.mjs`

- [ ] **Step 1: Write the e2e**

Model on `tests/e2e/verify-navtab-weightoverride.test.mjs` (read for helper imports + `verifyRun` shape). Hand-write a workflow whose 2nd click is on tab 1:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

function buildWorkflow(runId, baseUrl, popupExists) {
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual",
    startUrl: `${baseUrl}/multitab`, finalUrl: `${baseUrl}/multitab/popup`,
    tabCount: 2,
    steps: [
      { action: "goto", tabOrdinal: 0 },
      // opens the new tab (target=_blank). No expectUrl (original tab URL doesn't change).
      { action: "click", selector: "[data-bf=\"open-popup\"]", text: "Open popup", tabOrdinal: 0,
        locator: { role: "link", name: "Open popup", structuralKey: "main>a|||Open popup", href: "/multitab/popup" } },
      // continues IN the new tab (ordinal 1).
      { action: "click", selector: "[data-bf=\"confirm\"]", text: "Confirm", tabOrdinal: popupExists ? 1 : 9,
        locator: { role: "button", name: "Confirm", structuralKey: "main>button|type=button||Confirm" } }
    ],
    segments: [
      { range: [0, 1], startPageKey: "multitab", endPageKey: "multitab", name: "open-tab" },
      { range: [2, 2], startPageKey: "multitab/popup", endPageKey: "multitab/popup", name: "confirm-in-tab" }
    ],
    verification: { expectedNetwork: null, expectedEvidence: { selector: "[data-bf-evidence=\"done\"]", textIncludes: "Confirmed" }, expectedFinalUrl: null, transitionTimeoutMs: 8000 },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  };
}

test("verify-multitab: replay follows a new tab and continues there", { timeout: 120000 }, async () => {
  const server = await startFixtureServer();
  try {
    const runId = `multitab-${Date.now()}`;
    ensureRunDirs(runId);
    writeJson(getRunPaths(runId).workflowJsonPath, buildWorkflow(runId, server.baseUrl, true));
    generateRunner(runId);
    const r = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
    assert.equal(r.pathComplete, true, `must complete across tabs — ${JSON.stringify(r)}`);
    assert.ok((r.executedSteps || []).filter((s) => s === "click").length >= 2, "both clicks (open + confirm-in-new-tab) executed");
  } finally { await server.close(); }
});

test("verify-multitab: missing new tab drift-holds (fail-safe, no misfire)", { timeout: 120000 }, async () => {
  const server = await startFixtureServer();
  try {
    const runId = `multitab-fail-${Date.now()}`;
    ensureRunDirs(runId);
    // tabOrdinal 9 for the confirm step -> no such tab is ever created -> waitForNewTarget times out.
    writeJson(getRunPaths(runId).workflowJsonPath, buildWorkflow(runId, server.baseUrl, false));
    generateRunner(runId);
    const r = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
    assert.equal(r.pathComplete, true ? r.pathComplete : r.pathComplete, ""); // placeholder removed below
    assert.ok(typeof r.heldAtSegment === "number", `must drift-hold when the tab never appears — ${JSON.stringify(r)}`);
  } finally { await server.close(); }
});
```
Remove the placeholder assertion line in the second test; assert only `typeof r.heldAtSegment === "number"` (drift-held). Confirm `verifyRun` shape against verify-navtab. The first test relies on the runner switching to ordinal 1 (the popup tab) for the confirm click; the evidence gate `done = "Confirmed"` proves the click ran IN the new tab.

NOTE on expectedEvidence: confirm the runner evaluates `expectedEvidence` against the ACTIVE tab at the end (it should, since `targetId` is the popup tab after step 2). If the evidence check uses a different target, adjust to assert via the report's executedSteps + a transition instead. Read how `verify-run`/runner checks `expectedEvidence` and align.

- [ ] **Step 2: Run (clean Chrome)**

```
pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion
node --test --import=./tests/_setup.mjs tests/e2e/verify-multitab.test.mjs
```
Expected: both tests PASS (follow-tab completes; missing-tab drift-holds). If the follow case doesn't complete, print the report + check: did `waitForNewTarget` find the popup? is the confirm resolving on the popup target? Do NOT weaken assertions — the cross-tab completion is the whole point. If blocked after genuine effort, report BLOCKED with the report.

- [ ] **Step 3: typecheck + commit**

```
npm run typecheck
git add tests/e2e/verify-multitab.test.mjs
git commit -m "phase 95: e2e verify-multitab — replay follows new tab + continues (evidence in popup); missing-tab fail-safe drift-hold"
```

---

### Task 8: Phase 95 doc + full check

**Files:**
- Create: `tasks/phases/phase-95-multitab-replay.md`
- Append: `tasks/lessons.md`

- [ ] **Step 1: Write `tasks/phases/phase-95-multitab-replay.md`**

Cover: the runner ordinal-switch design (`let targetId` + `ordinalToTargetId` + per-step `resolveTabTarget`), why reassigning `targetId` is minimal-risk (every step action already uses it), `waitForNewTarget` + readyState settle, fail-safe (missing tab → drift-hold → heal route), switch-back free, new-tab resolve works via per-call locatorCaptureSource injection, e2e proof, governance no-gate.

- [ ] **Step 2: Append a lesson**

Execution-learning: making the runner multi-tab cost one declaration change (`const`→`let targetId`) + a per-step reassignment, because every action already took `targetId` as a parameter — a pre-existing seam paid off. Lesson: parameterized-target functions (vs a hardcoded global) make later multi-target support nearly free.

- [ ] **Step 3: Full check GREEN**

```
pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion
npm run check
```
Expected: GREEN. Re-run once if an unrelated e2e flakes (breadth-enrichment).

- [ ] **Step 4: Commit**

```bash
git add tasks/phases/phase-95-multitab-replay.md tasks/lessons.md
git commit -m "phase 95: multitab replay complete + doc + lesson (no governance gate)"
```

---

## Self-Review

**1. Spec coverage:**
- openerId preserved (A1) → Task 1 ✓
- daemon ordinal tagging (A1) → Task 2 ✓
- sanitizer preserves tabOrdinal → Task 2 ✓
- compile step.tabOrdinal + tabCount (A2) → Task 3 ✓
- schema additive (A3) → Task 3 ✓
- runner ordinal switch (B1) + waitForNewTarget (B2) → Task 6 ✓
- new-tab resolve no-change (B3) → Task 6 NOTE ✓ (per-call locatorCaptureSource injection)
- switch-back (B4) → Task 6 (ordinal map reuse) ✓
- multitab fixture → Task 5 ✓
- e2e follow + fail-safe → Task 7 ✓
- agent-blind / legacy no-op / fail-safe → Tasks 2,3,6 ✓
- governance no-gate → Tasks 4,8 ✓
- openerOrdinal capture: spec says "record on first entry"; **deferred** — Task 2 NOTE keeps openerId at the session-manager layer (Task 1) but v1 tags only `tabOrdinal` (ordinal-order alignment needs no openerOrdinal). This is a deliberate YAGNI trim vs the spec's A1 bullet; openerId is available for the future multi-tab disambiguation the spec scopes out. Flagged.

**2. Placeholder scan:** Task 7's second test has a noted placeholder assertion line to remove (flagged inline). Phase docs (Tasks 4, 8) describe content to write rather than pasting full doc text — acceptable for doc tasks (the structure + required points are enumerated). No code-step placeholders.

**3. Type consistency:** `makeTabOrdinal().ordinalFor/count` (tab-ordinal.mjs); `tabOrdinal` (event field, step field, schema) consistent; `tabCount` (compile + schema) consistent; `ordinalToTargetId`/`resolveTabTarget`/`waitForNewTarget` (runner) consistent; `let targetId` reassignment compatible with all existing step-action call sites that take `targetId`.

**Notes for the implementer:**
- Read the mirror references first: `verify-navtab-weightoverride.test.mjs`, the existing `compile.test.mjs` + `session-manager.test.mjs` harnesses.
- Keep new runner identifiers < 24 chars.
- The single biggest risk is Task 6's `let targetId` reassignment interacting with teardown (post-loop `targetId` = last active tab) — teardown-on-multitab is out of scope; confirm single-tab teardown tests still pass (full-loop covers it).
- Phase 94 and 95 are independently committable; 95 depends on 94's `tabOrdinal`.
