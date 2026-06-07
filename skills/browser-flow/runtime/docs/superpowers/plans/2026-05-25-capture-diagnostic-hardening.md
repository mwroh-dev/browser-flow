# Capture Diagnostic Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual capture open a visible browser by default, infer when the user wants dynamic page data, make registry-promotion and replay-drift language truthful, and preserve the user's real click intent even when capture sees volatile or overlapping DOM nodes.

**Architecture:** Keep the runtime pipeline serial and deterministic. Fix operator behavior in the public skill prompt and internal capture-driver contract, add an intent-classification front door so "top N/current/latest/list" requests become extraction workflows, keep registry refusal at the persistence boundary, and add gesture provenance so analyzer can merge duplicate events from the same physical click using evidence instead of `header`/`ad` string heuristics. Verification reports remain fail-closed and store structured outcome fields; user-facing wording is rendered from those fields as "not verified / drift-held" instead of "the workflow failed" when dynamic external content differs.

**Tech Stack:** Node ESM, `node:test`, existing `bf` CLI, Zod artifact schemas, browser-flow skill bundle publishing.

---

## File Map

- Modify `scripts/cli.mjs`: improve runtime dependency install failure messages so permission failures give a concrete remediation command.
- Modify `scripts/lib/args.mjs`: add a helper for explicit boolean flags if needed by tests; keep existing CLI compatibility.
- Modify `.codex/skills/browser-flow/prompt.md`: capture phase must omit `--headless` unless the user explicitly asks for automation-only capture; verification can still use `--headless`.
- Modify `.codex/skills/browser-flow/scripts/validate-skill.mjs`: enforce the headed manual-capture instruction so the prompt does not regress.
- Modify `.codex/skills/capture-driver/SKILL.md`: internal capture-driver must prepare real-site/manual captures headed by default and must not verify unmasked real-site captures unless explicitly requested.
- Modify `agents/capture/AGENT.md`: capture role contract should state visible capture is the default for human demo.
- Modify `.codex/skills/browser-flow/prompt.md`: add a required intent-classification step that distinguishes action replay, dynamic data extraction, and ordinal list-item actions.
- Modify `agents/orchestrator/AGENT.md`: orchestrator owns goal interpretation and must route "top N/current/latest/list" requests to extract mode after navigation.
- Modify `.codex/skills/browser-flow/scripts/validate-skill.mjs`: enforce that prompt keeps the data-intent rule.
- Modify `tests/skill/browser-flow-capture.test.mjs`: assert the prompt recognizes dynamic data requests and instructs stopping on the listing/data page instead of clicking one dynamic item.
- Modify `scripts/registry/workflow-registry.mjs`: replace "skipping upsert" wording with "not promoted to registry" and return a structured reason helper usable by tests.
- Modify `scripts/verify/verify-run.mjs`: add structured `verificationOutcome`, `reasonCategory`, `blockingGate`, and `userFault` metadata to `verification.json` without changing the fail-closed `success` boolean.
- Modify `scripts/lib/schemas.mjs`: allow the additive verification metadata fields.
- Modify `scripts/observe/recorder-script.mjs`: include click provenance (`gestureId`, pointer coordinates, trusted flag, target selector, actionable selector, and composed path summary) on click events.
- Modify `scripts/lib/config.mjs`: expose `ignoredEventsPath` under `analysis/ignored-events.json` for analyzer audit output.
- Create `scripts/lib/gesture-coalescer.mjs`: pure analyzer helper for grouping click events by gesture provenance and choosing the most specific actionable target.
- Modify `scripts/analyze/compile.mjs`: run gesture coalescing before building steps and write ignored/coalesced events to `ignoredEventsPath`; do not frame filtered events as user mistakes.
- Create `scripts/lib/ordinal-list-intent.mjs`: pure analyzer helper that recognizes dynamic list-item clicks and preserves the user's positional intent.
- Modify `scripts/analyze/compile.mjs`: mark dynamic list-item clicks with ordinal locator metadata instead of binding them only to the captured title text.
- Modify `scripts/generate/generate-runner.mjs`: classify guarded replay mismatches into structured reason categories while preserving `driftReason`.
- Add `tests/observe/recorder-provenance.test.mjs`: unit/string test proving the recorder emits gesture provenance fields.
- Add `tests/lib/gesture-coalescer.test.mjs`: unit tests proving same-gesture container/link duplicates are coalesced by provenance, not by `header`/`ad` strings.
- Add `tests/lib/ordinal-list-intent.test.mjs`: unit tests proving first/current headline clicks are represented as list ordinal intent, not frozen title intent.
- Add or modify `tests/analyze/compile.test.mjs`: compile fixtures for duplicate container coalescing and first-headline ordinal capture.
- Modify `tests/registry/verified-gate.test.mjs`: assert unmasked registry refusal uses "not promoted" semantics.
- Modify `tests/skill/browser-flow-capture.test.mjs`: assert capture prompt uses visible browser by default.
- Modify `tests/reports/schema-versions.test.mjs`: assert verification metadata parses.
- Run `node scripts/publish/build-bundle.mjs`: update `.codex/skills/browser-flow/bundle/runtime/**` and bundled skill/agent files from source.

## Task 1: Dependency Permission Guidance

**Files:**
- Modify: `scripts/cli.mjs`
- Test: `tests/bootstrap.test.mjs` or new `tests/cli/runtime-dependencies.test.mjs`

- [ ] **Step 1: Extract dependency error formatting into a pure function**

Add this near the top of `scripts/cli.mjs`:

```js
export function formatDependencyInstallError(runtimeRoot, detail) {
  const permissionHint = /EACCES|EPERM|permission denied|operation not permitted/i.test(detail)
    ? "\nPermission hint: run `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` inside the browser-flow runtime directory, or approve Codex to run that install command for this project-local bundle."
    : "";
  return `Unable to prepare browser-flow runtime dependencies inside ${runtimeRoot}.\n${detail}${permissionHint}`;
}
```

Then replace the thrown error in `ensureRuntimeDependencies()`:

```js
throw new Error(formatDependencyInstallError(runtimeRoot, detail));
```

- [ ] **Step 2: Add the failing test**

Create `tests/cli/runtime-dependencies.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { formatDependencyInstallError } from "../../scripts/cli.mjs";

test("dependency install errors include a permission remediation hint", () => {
  const message = formatDependencyInstallError(
    "/repo/.agents/skills/browser-flow/bundle/runtime",
    "npm ERR! code EACCES\npermission denied, mkdir node_modules"
  );
  assert.match(message, /Unable to prepare browser-flow runtime dependencies/);
  assert.match(message, /Permission hint:/);
  assert.match(message, /npm ci --omit=dev --ignore-scripts --no-audit --no-fund/);
});
```

- [ ] **Step 3: Run the focused test**

Run:

```bash
node --test --import=./tests/_setup.mjs tests/cli/runtime-dependencies.test.mjs
```

Expected: fail first if the helper is absent, pass after Step 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/cli.mjs tests/cli/runtime-dependencies.test.mjs
git commit -m "fix: clarify browser-flow dependency install failures"
```

## Task 2: Headed Manual Capture Default

**Files:**
- Modify: `.codex/skills/browser-flow/prompt.md`
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs`
- Modify: `.codex/skills/capture-driver/SKILL.md`
- Modify: `agents/capture/AGENT.md`
- Test: `tests/skill/browser-flow-capture.test.mjs`

- [ ] **Step 1: Add a failing prompt-contract test**

Open `tests/skill/browser-flow-capture.test.mjs` and add:

```js
test("capture instructions default to a visible Chrome for human demo", () => {
  const prompt = readFileSync(".codex/skills/browser-flow/prompt.md", "utf8");
  assert.match(prompt, /manual capture opens a visible Chrome/i);
  assert.match(prompt, /prepare --run-id <id> --fixture <fixture> \[--start-url <url>\] \[--unmasked\] \[--snapshot-dom\]/);
  assert.doesNotMatch(prompt, /prepare --run-id <id> --fixture <fixture> --headless/);
  assert.match(prompt, /Pass `--headless` for verify/i);
});
```

- [ ] **Step 2: Change the public skill prompt**

In `.codex/skills/browser-flow/prompt.md`, replace:

```md
The phases run strictly in serial: each phase consumes the previous
phase's artifact. Pass `--headless` unless the user asks for a visible
browser.
```

with:

```md
The phases run strictly in serial: each phase consumes the previous
phase's artifact. Manual capture opens a visible Chrome by default so
the user can perform the demo. Pass `--headless` only for automation-
driven capture where no human browser interaction is expected. Pass
`--headless` for verify unless the user asks to watch replay.
```

Replace the capture callable block:

```md
node .agents/skills/browser-flow/bundle/runtime/scripts/cli.mjs prepare --run-id <id> --fixture <fixture> --headless [--start-url <url>] [--unmasked] [--snapshot-dom]
```

with:

```md
node .agents/skills/browser-flow/bundle/runtime/scripts/cli.mjs prepare --run-id <id> --fixture <fixture> [--start-url <url>] [--unmasked] [--snapshot-dom]
```

- [ ] **Step 3: Enforce the prompt contract in validator**

In `.codex/skills/browser-flow/scripts/validate-skill.mjs`, add:

```js
if (promptText.includes("prepare --run-id <id> --fixture <fixture> --headless")) {
  throw new Error("prompt.md must not make capture headless by default; human demo capture must be visible.");
}
if (!/Manual capture opens a visible Chrome by default/i.test(promptText)) {
  throw new Error("prompt.md must document visible Chrome as the default for manual capture.");
}
if (!/Pass `--headless` for verify/i.test(promptText)) {
  throw new Error("prompt.md must keep verify headless guidance explicit.");
}
```

- [ ] **Step 4: Update internal capture-driver and capture agent contract**

In `.codex/skills/capture-driver/SKILL.md`, change the prepare example from:

```md
node scripts/cli.mjs prepare --run-id <id> --fixture manual --start-url <url> [--profile-name <name>] [--unmasked] [--snapshot-dom]
```

to:

```md
node scripts/cli.mjs prepare --run-id <id> --fixture manual --start-url <url> [--profile-name <name>] [--unmasked] [--snapshot-dom]
```

and add immediately below it:

```md
Do not add `--headless` for human/manual capture. The operator must see the isolated Chrome window. Use `--headless` only when the driver itself will automate the demo through CDP.
```

In `agents/capture/AGENT.md`, replace the command line:

```md
node scripts/cli.mjs prepare --run-id <id> --fixture <fixture> [--headless]
```

with:

```md
node scripts/cli.mjs prepare --run-id <id> --fixture <fixture> [--headless]
```

and add:

```md
For human demo capture, omit `--headless`; the isolated Chrome must be visible. `--headless` is reserved for test fixtures or fully automated capture drivers.
```

- [ ] **Step 5: Run prompt validation**

Run:

```bash
node --test --import=./tests/_setup.mjs tests/skill/browser-flow-capture.test.mjs
npm run validate-skill
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add .codex/skills/browser-flow/prompt.md .codex/skills/browser-flow/scripts/validate-skill.mjs .codex/skills/capture-driver/SKILL.md agents/capture/AGENT.md tests/skill/browser-flow-capture.test.mjs
git commit -m "fix: default manual capture to visible chrome"
```

## Task 3: Registry Promotion Wording

**Files:**
- Modify: `scripts/registry/workflow-registry.mjs`
- Test: `tests/registry/verified-gate.test.mjs`

- [ ] **Step 1: Add a pure helper and update stderr wording**

In `scripts/registry/workflow-registry.mjs`, add:

```js
export function registryPromotionRefusal(entry) {
  const security = /** @type {{ localOnly?: boolean } | undefined} */ (entry.security);
  if (security && security.localOnly === false) {
    return {
      code: "not-promoted-unmasked-real-site",
      message: `registry: not promoted "${entry.id}" — unmasked real-site capture is diagnostic; durable registry entries remain local-only unless a future explicit promotion path is added.`
    };
  }
  return null;
}
```

Then replace the existing `security.localOnly === false` block:

```js
const refusal = registryPromotionRefusal(entry);
if (refusal) {
  process.stderr.write(`${refusal.message}\n`);
  return readRegistry();
}
```

- [ ] **Step 2: Add the failing registry wording test**

Append to `tests/registry/verified-gate.test.mjs`:

```js
test("unmasked real-site entries are not promoted, not described as verification failure", () => {
  const id = `vgate-unmasked-not-promoted-${Date.now()}`;
  const refusal = registryPromotionRefusal({
    id,
    fixture: "manual",
    runId: id,
    status: "generated",
    security: { localOnly: false }
  });
  assert.equal(refusal?.code, "not-promoted-unmasked-real-site");
  assert.match(refusal?.message ?? "", /not promoted/);
  assert.doesNotMatch(refusal?.message ?? "", /skipping upsert|failed/i);
});
```

Also update the import:

```js
import { upsertRegistryEntry, readRegistry, registryPromotionRefusal } from "../../scripts/registry/workflow-registry.mjs";
```

- [ ] **Step 3: Run the focused registry test**

Run:

```bash
node --test --import=./tests/_setup.mjs tests/registry/verified-gate.test.mjs
```

Expected: pass after helper is exported and wording is updated.

- [ ] **Step 4: Commit**

```bash
git add scripts/registry/workflow-registry.mjs tests/registry/verified-gate.test.mjs
git commit -m "fix: clarify real-site registry promotion refusal"
```

## Task 4: Click Noise Coalescing and Ordinal List Intent

**Files:**
- Modify: `scripts/observe/recorder-script.mjs`
- Modify: `scripts/lib/config.mjs`
- Create: `scripts/lib/gesture-coalescer.mjs`
- Create: `scripts/lib/ordinal-list-intent.mjs`
- Modify: `scripts/analyze/compile.mjs`
- Test: `tests/observe/recorder-provenance.test.mjs`
- Test: `tests/lib/gesture-coalescer.test.mjs`
- Test: `tests/lib/ordinal-list-intent.test.mjs`
- Test: `tests/analyze/compile.test.mjs`

- [ ] **Step 1: Add recorder provenance fields for click events**

In `scripts/observe/recorder-script.mjs`, inside `recorderInitScript`, add pointer provenance helpers before the click listener:

```js
  let __bfGestureSeq = 0;
  let __bfLastPointer = null;

  function summarizeEventPath(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return path
      .filter((node) => node instanceof Element)
      .slice(0, 8)
      .map((node) => ({
        selector: selectorFor(node),
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute("role") || implicitRoleOf(node),
        text: cleanText(node.innerText || node.getAttribute("aria-label") || "")
      }));
  }

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    __bfGestureSeq += 1;
    __bfLastPointer = {
      gestureId: "g" + __bfGestureSeq,
      pointerId: typeof event.pointerId === "number" ? event.pointerId : 0,
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now(),
      targetSelector: target ? selectorFor(target) : "",
      eventPath: summarizeEventPath(event)
    };
  }, true);

  function provenanceForClick(event, target) {
    const now = Date.now();
    const pointer = __bfLastPointer && now - __bfLastPointer.timestamp < 1500
      ? __bfLastPointer
      : null;
    return {
      gestureId: pointer ? pointer.gestureId : "click-" + now,
      pointerId: pointer ? pointer.pointerId : 0,
      isTrusted: event.isTrusted === true,
      clickX: typeof event.clientX === "number" ? event.clientX : (pointer ? pointer.x : 0),
      clickY: typeof event.clientY === "number" ? event.clientY : (pointer ? pointer.y : 0),
      targetSelector: event.target instanceof Element ? selectorFor(event.target) : "",
      actionableSelector: target ? selectorFor(target) : "",
      eventPath: summarizeEventPath(event)
    };
  }
```

Then in the existing click listener, add the provenance fields to the emitted payload:

```js
    const provenance = provenanceForClick(event, target);
    emit({
      type: "click",
      ...provenance,
      selector: clickSelector,
      text: cleanText(target.innerText || target.getAttribute("aria-label") || target.getAttribute("value")),
      href: target instanceof HTMLAnchorElement ? target.getAttribute("href") || "" : "",
      role: target.getAttribute("role") || implicitRoleOf(target),
      ancestors: collectAncestors(target),
      siblings: countSiblings(target, clickSelector),
      locator: clickLocator,
      coords: { x: clickLocator.box.cx, y: clickLocator.box.cy }
    });
```

- [ ] **Step 2: Add recorder provenance string test**

Create `tests/observe/recorder-provenance.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { recorderInitScript } from "../../scripts/observe/recorder-script.mjs";

test("recorder emits click provenance for gesture coalescing", () => {
  assert.match(recorderInitScript, /gestureId/);
  assert.match(recorderInitScript, /pointerdown/);
  assert.match(recorderInitScript, /composedPath/);
  assert.match(recorderInitScript, /targetSelector/);
  assert.match(recorderInitScript, /actionableSelector/);
  assert.match(recorderInitScript, /isTrusted/);
});
```

- [ ] **Step 3: Add ignored-events artifact path**

In `scripts/lib/config.mjs`, add `ignoredEventsPath` to `getRunPaths()` beside the other analysis artifacts:

```js
    ignoredEventsPath: resolve(runRoot, "analysis", "ignored-events.json"),
```

- [ ] **Step 4: Add the pure gesture coalescer**

Create `scripts/lib/gesture-coalescer.mjs`:

```js
function distance(a, b) {
  const ax = Number(a.clickX ?? a.coords?.x ?? 0);
  const ay = Number(a.clickY ?? a.coords?.y ?? 0);
  const bx = Number(b.clickX ?? b.coords?.x ?? 0);
  const by = Number(b.clickY ?? b.coords?.y ?? 0);
  return Math.hypot(ax - bx, ay - by);
}

function actionabilityScore(event) {
  let score = 0;
  if (event.href) score += 4;
  if (event.role === "link" || event.locator?.role === "link") score += 3;
  if (event.role === "button" || event.locator?.role === "button") score += 3;
  if (event.text || event.locator?.name) score += 2;
  if (event.actionableSelector && event.selector && event.actionableSelector === event.selector) score += 1;
  const pathLen = Array.isArray(event.eventPath) ? event.eventPath.length : 0;
  return score + Math.min(pathLen, 8) / 100;
}

function sameGesture(a, b) {
  if (a.gestureId && b.gestureId && a.gestureId === b.gestureId) return true;
  const delta = Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0);
  return Number.isFinite(delta) && delta >= 0 && delta <= 250 && distance(a, b) <= 4;
}

export function coalesceGestureClicks(events) {
  const output = [];
  const ignored = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || event.type !== "click") {
      output.push(event);
      continue;
    }

    const group = [event];
    let cursor = index + 1;
    while (cursor < events.length && events[cursor]?.type === "click" && sameGesture(event, events[cursor])) {
      group.push(events[cursor]);
      cursor += 1;
    }

    if (group.length === 1) {
      output.push(event);
      continue;
    }

    const ranked = group
      .map((item, groupIndex) => ({ item, groupIndex, score: actionabilityScore(item) }))
      .sort((a, b) => b.score - a.score || b.groupIndex - a.groupIndex);
    const winner = ranked[0].item;
    output.push({ ...winner, coalescedGesture: true, coalescedCount: group.length });
    for (const entry of ranked.slice(1)) {
      ignored.push({
        type: "coalesced-click",
        reason: "same-gesture-less-actionable-target",
        keptSelector: winner.selector ?? "",
        ignoredSelector: entry.item.selector ?? "",
        gestureId: winner.gestureId ?? entry.item.gestureId ?? "",
        ignoredText: entry.item.text ?? ""
      });
    }
    index = cursor - 1;
  }
  return { events: output, ignored };
}
```

- [ ] **Step 5: Add gesture coalescer tests**

Create `tests/lib/gesture-coalescer.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { coalesceGestureClicks } from "../../scripts/lib/gesture-coalescer.mjs";

test("same-gesture container/link duplicate keeps the actionable link", () => {
  const out = coalesceGestureClicks([
    { type: "navigate", url: "https://www.naver.com/" },
    {
      type: "click",
      gestureId: "g1",
      selector: "#header",
      text: "",
      timestamp: 1000,
      clickX: 10,
      clickY: 10,
      eventPath: [{ selector: "#header", tag: "header" }]
    },
    {
      type: "click",
      gestureId: "g1",
      selector: "a[href='https://finance.naver.com/']",
      text: "증권",
      href: "https://finance.naver.com/",
      role: "link",
      timestamp: 1020,
      clickX: 10,
      clickY: 10,
      eventPath: [{ selector: "a[href='https://finance.naver.com/']", tag: "a" }, { selector: "#header", tag: "header" }]
    }
  ]);
  const clicks = out.events.filter((event) => event.type === "click");
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].text, "증권");
  assert.equal(out.ignored.length, 1);
  assert.equal(out.ignored[0].reason, "same-gesture-less-actionable-target");
});

test("separate gestures are not coalesced even when one is a header", () => {
  const out = coalesceGestureClicks([
    { type: "click", gestureId: "g1", selector: "#header", timestamp: 1000, clickX: 1, clickY: 1 },
    {
      type: "click",
      gestureId: "g2",
      selector: "a[href='/news']",
      text: "뉴스",
      href: "https://www.naver.com/news",
      role: "link",
      timestamp: 1300,
      clickX: 50,
      clickY: 50
    }
  ]);
  assert.equal(out.events.filter((event) => event.type === "click").length, 2);
  assert.equal(out.ignored.length, 0);
});

test("fallback groups by near-identical coordinates and short time window", () => {
  const out = coalesceGestureClicks([
    { type: "click", selector: "#wrap", timestamp: 1000, clickX: 20, clickY: 20 },
    {
      type: "click",
      selector: "a[href='/news']",
      text: "뉴스",
      href: "https://www.naver.com/news",
      role: "link",
      timestamp: 1030,
      clickX: 21,
      clickY: 21
    }
  ]);
  assert.equal(out.events.filter((event) => event.type === "click").length, 1);
  assert.equal(out.events.find((event) => event.type === "click").text, "뉴스");
});

test("does not rely on header or ad strings to drop events", () => {
  const out = coalesceGestureClicks([{
    type: "click",
    selector: "#header",
    text: "메뉴",
    timestamp: 1000,
    clickX: 20,
    clickY: 20
  }]);
  assert.equal(out.events.length, 1);
  assert.equal(out.ignored.length, 0);
});
```

- [ ] **Step 6: Add ordinal list intent helper**

Create `scripts/lib/ordinal-list-intent.mjs`:

```js
const LIST_WORDS = /(headline|headlines|news|article|기사|뉴스|헤드라인|목록|list|item)/i;

function hasDynamicListContext(event) {
  const blob = JSON.stringify({
    selector: event.selector,
    href: event.href,
    text: event.text,
    locator: event.locator,
    ancestors: event.ancestors
  });
  return LIST_WORDS.test(blob);
}

export function inferOrdinalListIntent(event) {
  if (!event || event.type !== "click") return null;
  if (!hasDynamicListContext(event)) return null;
  const ordinal = typeof event.locator?.ordinal === "number" ? event.locator.ordinal : 0;
  if (ordinal < 0 || ordinal > 20) return null;
  return {
    kind: "dynamic-list-item",
    ordinal,
    description: `current list item #${ordinal + 1}`,
    titleAtCapture: typeof event.text === "string" ? event.text : ""
  };
}
```

Create `tests/lib/ordinal-list-intent.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { inferOrdinalListIntent } from "../../scripts/lib/ordinal-list-intent.mjs";

test("first headline click preserves ordinal intent instead of fixed title intent", () => {
  const intent = inferOrdinalListIntent({
    type: "click",
    selector: "a.news_tit",
    text: "임광현 국세청장 ...",
    href: "https://n.news.naver.com/article/001",
    locator: { role: "link", name: "임광현 국세청장 ...", ordinal: 0 },
    ancestors: [{ tag: "section", ariaLabel: "경제 헤드라인 뉴스" }]
  });
  assert.equal(intent?.kind, "dynamic-list-item");
  assert.equal(intent?.ordinal, 0);
  assert.equal(intent?.titleAtCapture, "임광현 국세청장 ...");
});

test("ordinary fixed navigation link has no ordinal list intent", () => {
  const intent = inferOrdinalListIntent({
    type: "click",
    selector: "a[href='https://finance.naver.com/']",
    text: "증권",
    href: "https://finance.naver.com/",
    locator: { role: "link", name: "증권" }
  });
  assert.equal(intent, null);
});
```

- [ ] **Step 7: Apply coalescing, audit output, and ordinal metadata in compile**

In `scripts/analyze/compile.mjs`, add the import:

```js
import { coalesceGestureClicks } from "../lib/gesture-coalescer.mjs";
import { inferOrdinalListIntent } from "../lib/ordinal-list-intent.mjs";
```

Replace the raw event assignment:

```js
  const rawEvents = /** @type {Array<{
   *   type: string,
   *   timestamp?: number,
   *   url?: string,
   *   selector?: string,
   *   text?: string,
   *   href?: string,
   *   gestureId?: string,
   *   clickX?: number,
   *   clickY?: number,
   *   targetSelector?: string,
   *   actionableSelector?: string,
   *   eventPath?: Array<Record<string, unknown>>,
   *   submitterSelector?: string,
   *   submitterText?: string,
   *   submitterHref?: string,
   *   formIdentitySelector?: string,
   *   formId?: string,
   *   formName?: string,
   *   formAction?: string,
   *   formMethod?: string,
   *   fieldName?: string,
   *   value?: string,
   *   secret?: boolean,
   *   contentEditable?: boolean,
   *   locator?: Record<string, unknown>,
   *   ancestors?: Array<{ tag?: string, id?: string, role?: string, ariaLabel?: string, dataBf?: string, dataTestid?: string }>,
   *   siblings?: { totalMatchingSelector?: number, totalMatchingRole?: number },
   *   tabOrdinal?: number
   * }>} */ (readJson(runPaths.sanitizedEventsPath));
  const coalesced = coalesceGestureClicks(rawEvents);
  const events = coalesced.events;
  writeJson(runPaths.ignoredEventsPath, {
    schemaVersion: 1,
    runId,
    ignored: coalesced.ignored
  });
```

Delete the old direct `const events = ... readJson(...)` declaration.

After `lastAction` is created and `event.locator` is copied, add:

```js
const ordinalIntent = inferOrdinalListIntent(event);
if (ordinalIntent) {
  lastAction.ordinalIntent = ordinalIntent;
  lastAction.textAtCapture = lastAction.text;
  lastAction.text = "";
  if (lastAction.locator && typeof lastAction.locator === "object") {
    lastAction.locator.disambiguation = {
      ...(lastAction.locator.disambiguation || {}),
      resolutionMethod: "B",
      ordinalHint: ordinalIntent.ordinal
    };
  }
}
```

- [ ] **Step 8: Add compile regressions**

Append to `tests/analyze/compile.test.mjs`:

```js
test("compiler coalesces same-gesture container event into intended stocks click", () => {
  const runId = `compile-gesture-coalesce-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    startUrl: "https://www.naver.com/"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://www.naver.com/", timestamp: 10, tabOrdinal: 0 },
    {
      type: "click",
      gestureId: "g1",
      selector: "#header",
      text: "",
      clickX: 10,
      clickY: 10,
      eventPath: [{ selector: "#header", tag: "header" }],
      ancestors: [{ tag: "header", role: "banner", id: "header" }],
      timestamp: 20,
      tabOrdinal: 0
    },
    {
      type: "click",
      gestureId: "g1",
      selector: "a[href='https://finance.naver.com/']",
      text: "증권",
      href: "https://finance.naver.com/",
      role: "link",
      locator: { role: "link", name: "증권" },
      clickX: 10,
      clickY: 10,
      eventPath: [{ selector: "a[href='https://finance.naver.com/']", tag: "a" }, { selector: "#header", tag: "header" }],
      timestamp: 40,
      tabOrdinal: 0
    },
    { type: "navigate", url: "https://finance.naver.com/", timestamp: 60, tabOrdinal: 0 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://finance.naver.com/", method: "GET", status: 200, timestamp: 50 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "증권", url: "https://finance.naver.com/" }
  ]);

  const workflow = compileRun(runId);
  const clicks = workflow.steps.filter((step) => step.action === "click");
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].text, "증권");
  const ignored = readJson(runPaths.ignoredEventsPath);
  assert.equal(ignored.ignored.length, 1);
  assert.equal(ignored.ignored[0].reason, "same-gesture-less-actionable-target");
});

test("compiler marks first dynamic headline click as ordinal list intent", () => {
  const runId = `compile-headline-ordinal-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.manifestPath, {
    runId,
    fixture: "manual",
    unmasked: true,
    startUrl: "https://news.naver.com/section/101"
  });
  writeJson(runPaths.sanitizedEventsPath, [
    { type: "navigate", url: "https://news.naver.com/section/101", timestamp: 10, tabOrdinal: 0 },
    {
      type: "click",
      selector: "a.news_tit",
      text: "임광현 국세청장 ...",
      href: "https://n.news.naver.com/article/001",
      locator: { role: "link", name: "임광현 국세청장 ...", ordinal: 0 },
      ancestors: [{ tag: "section", ariaLabel: "경제 헤드라인 뉴스" }],
      timestamp: 20,
      tabOrdinal: 0
    },
    { type: "navigate", url: "https://n.news.naver.com/article/001", timestamp: 40, tabOrdinal: 0 }
  ]);
  writeJson(runPaths.networkSummaryPath, [
    { url: "https://n.news.naver.com/article/001", method: "GET", status: 200, timestamp: 30 }
  ]);
  writeJson(runPaths.pageEvidencePath, [
    { selector: "h1", text: "임광현 국세청장 ...", url: "https://n.news.naver.com/article/001" }
  ]);

  const workflow = compileRun(runId);
  const click = workflow.steps.find((step) => step.action === "click");
  assert.equal(click.ordinalIntent.kind, "dynamic-list-item");
  assert.equal(click.ordinalIntent.ordinal, 0);
  assert.equal(click.textAtCapture, "임광현 국세청장 ...");
  assert.equal(click.text, "");
  assert.equal(click.locator.disambiguation.ordinalHint, 0);
});
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
node --test --import=./tests/_setup.mjs tests/observe/recorder-provenance.test.mjs
node --test --import=./tests/_setup.mjs tests/lib/gesture-coalescer.test.mjs
node --test --import=./tests/_setup.mjs tests/lib/ordinal-list-intent.test.mjs
node --test --import=./tests/_setup.mjs tests/analyze/compile.test.mjs
```

Expected: pass after recorder provenance exists, same-gesture events are coalesced, ignored events are auditable, and dynamic list clicks carry ordinal intent.

- [ ] **Step 10: Commit**

```bash
git add scripts/observe/recorder-script.mjs scripts/lib/config.mjs scripts/lib/gesture-coalescer.mjs scripts/lib/ordinal-list-intent.mjs scripts/analyze/compile.mjs tests/observe/recorder-provenance.test.mjs tests/lib/gesture-coalescer.test.mjs tests/lib/ordinal-list-intent.test.mjs tests/analyze/compile.test.mjs
git commit -m "fix: preserve intended click semantics during analyze"
```

## Task 5: Truthful Verification Outcome Language

**Files:**
- Modify: `scripts/verify/verify-run.mjs`
- Modify: `scripts/lib/schemas.mjs`
- Modify: `scripts/generate/generate-runner.mjs`
- Modify: `.codex/skills/browser-flow/prompt.md`
- Test: `tests/reports/schema-versions.test.mjs`
- Test: `tests/verify/verify-run.test.mjs`
- Test: `tests/skill/browser-flow-capture.test.mjs`

- [ ] **Step 1: Add structured failure classification helper in verifier**

In `scripts/verify/verify-run.mjs`, add:

```js
function classifyVerificationOutcome(report, securityClean) {
  if (report.success === true && securityClean === true) {
    return {
      verificationOutcome: "verified",
      reasonCategory: "none",
      blockingGate: "none",
      userFault: false
    };
  }
  const reason = String(report.driftReason || report.failureReason || report.error || "");
  if (/Action-path mismatch|action-path-mismatch/i.test(reason)) {
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "dynamic_content_drift",
      blockingGate: "action_path",
      userFault: false
    };
  }
  if (/ambiguous locator|no candidates on page|method-B transition mismatch/i.test(reason)) {
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "locator_drift",
      blockingGate: "locator",
      userFault: false
    };
  }
  if (/Timeout|expected-url-timeout/i.test(reason)) {
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "transition_timeout",
      blockingGate: "transition",
      userFault: false
    };
  }
  return {
    verificationOutcome: "not_verified",
    reasonCategory: "replay_error",
    blockingGate: "runner",
    userFault: false
  };
}
```

After the final security scan, compute once and merge the structured fields:

```js
const outcome = classifyVerificationOutcome(finalReport, isSecurityClean(security));
finalReport = parseVerificationArtifact(
  {
    ...finalReport,
    securityOk: isSecurityClean(security),
    diagnosticMode: workflowUnmasked,
    ...outcome
  },
  runPaths.verificationPath
);
```

Do not store localized prose in `verification.json`. The artifact is machine-readable truth; Korean/English wording is produced by the orchestrator from `verificationOutcome`, `reasonCategory`, and `blockingGate`.

- [ ] **Step 2: Extend schema documentation**

In `scripts/lib/schemas.mjs`, add optional fields inside `VerificationV1`:

```js
verificationOutcome: z.enum(["verified", "not_verified"]).optional(),
reasonCategory: z.enum(["none", "dynamic_content_drift", "locator_drift", "transition_timeout", "security_not_clean", "replay_error"]).optional(),
blockingGate: z.enum(["none", "action_path", "locator", "transition", "evidence", "security", "runner"]).optional(),
userFault: z.boolean().optional(),
diagnosticMode: z.boolean().optional(),
```

- [ ] **Step 3: Add schema test**

In `tests/reports/schema-versions.test.mjs`, update the well-formed verification report test object to include:

```js
verificationOutcome: "not_verified",
reasonCategory: "dynamic_content_drift",
blockingGate: "action_path",
userFault: false,
diagnosticMode: true
```

Assert:

```js
assert.equal(parsed.verificationOutcome, "not_verified");
assert.equal(parsed.reasonCategory, "dynamic_content_drift");
assert.equal(parsed.blockingGate, "action_path");
assert.equal(parsed.userFault, false);
```

- [ ] **Step 4: Add verify-run behavior test**

In `tests/verify/verify-run.test.mjs`, add a fake-runner test using the existing runner fixture pattern in that file:

```js
assert.equal(verificationJson.success, false);
assert.equal(verificationJson.verificationOutcome, "not_verified");
assert.equal(verificationJson.reasonCategory, "dynamic_content_drift");
assert.equal(verificationJson.blockingGate, "action_path");
assert.equal(verificationJson.userFault, false);
assert.equal("operatorMessage" in verificationJson, false);
```

Use a runner report with:

```js
{
  success: false,
  pathComplete: false,
  executedSteps: [],
  stepCount: 1,
  transitionChecks: [],
  resultEvidence: { passed: false, selector: "", actualText: "", expectedText: "" },
  failureReason: "action-path-mismatch",
  error: "Action-path mismatch for #header .ad_area a: expected text \"센스맘\" but saw \"쿠쿠\""
}
```

- [ ] **Step 5: Update generated runner failure classification**

In `scripts/generate/generate-runner.mjs`, keep `classifyFailure()` for backward-compatible `failureReason`, but add a generated helper near it:

```js
function classifyReasonCategory(message) {
  if (message.includes("Action-path mismatch")) return "dynamic_content_drift";
  if (message.includes("ambiguous locator") || message.includes("no candidates on page") || message.includes("method-B transition mismatch")) return "locator_drift";
  if (message.includes("Timeout")) return "transition_timeout";
  return "replay_error";
}

function classifyBlockingGate(message) {
  if (message.includes("Action-path mismatch")) return "action_path";
  if (message.includes("ambiguous locator") || message.includes("no candidates on page") || message.includes("method-B transition mismatch")) return "locator";
  if (message.includes("Timeout")) return "transition";
  return "runner";
}
```

In the drift-held report object, add:

```js
verificationOutcome: "not_verified",
reasonCategory: classifyReasonCategory(driftReason),
blockingGate: classifyBlockingGate(driftReason),
userFault: false,
```

- [ ] **Step 6: Add skill prompt rule for rendering messages**

In `.codex/skills/browser-flow/prompt.md`, add under the verifier phase guidance:

```md
When `verification.json` has `verificationOutcome: "not_verified"`,
do not tell the user "the workflow failed" unless the artifact also
shows an actual runner/system error. Render the structured fields:
`dynamic_content_drift` + `action_path` means the replay could not be
promoted as verified because live dynamic content differed at a guarded
step; it is not a claim that the user's action was wrong or that the
requested data is wrong.
```

Add a validator assertion in `.codex/skills/browser-flow/scripts/validate-skill.mjs`:

```js
if (!/dynamic_content_drift.*action_path/s.test(promptText)) {
  throw new Error("prompt.md must render dynamic_content_drift/action_path as not-verified, not user failure.");
}
```

Add to `tests/skill/browser-flow-capture.test.mjs`:

```js
test("prompt renders dynamic drift as not verified, not user failure", () => {
  const prompt = readFileSync(".codex/skills/browser-flow/prompt.md", "utf8");
  assert.match(prompt, /dynamic_content_drift/);
  assert.match(prompt, /action_path/);
  assert.match(prompt, /not a claim that the user's action was wrong/);
});
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test --import=./tests/_setup.mjs tests/reports/schema-versions.test.mjs
node --test --import=./tests/_setup.mjs tests/verify/verify-run.test.mjs
node --test --import=./tests/_setup.mjs tests/skill/browser-flow-capture.test.mjs
```

Expected: pass after structured outcome metadata is written and prompt rendering guidance is enforced.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify/verify-run.mjs scripts/lib/schemas.mjs scripts/generate/generate-runner.mjs .codex/skills/browser-flow/prompt.md .codex/skills/browser-flow/scripts/validate-skill.mjs tests/reports/schema-versions.test.mjs tests/verify/verify-run.test.mjs tests/skill/browser-flow-capture.test.mjs
git commit -m "fix: report drift holds without calling workflow failed"
```

## Task 6: User Intent and Dynamic Data Mode

**Files:**
- Modify: `.codex/skills/browser-flow/prompt.md`
- Modify: `.codex/skills/browser-flow/scripts/validate-skill.mjs`
- Modify: `agents/orchestrator/AGENT.md`
- Test: `tests/skill/browser-flow-capture.test.mjs`

- [ ] **Step 1: Add a failing prompt-contract test for extraction intent**

Open `tests/skill/browser-flow-capture.test.mjs` and add:

```js
test("prompt classifies top-N/current/list requests as data extraction", () => {
  const prompt = readFileSync(".codex/skills/browser-flow/prompt.md", "utf8");
  assert.match(prompt, /Intent classification/i);
  assert.match(prompt, /top N|current|latest|list/i);
  assert.match(prompt, /route.*Extract/i);
  assert.match(prompt, /stop on the listing or data page/i);
  assert.match(prompt, /ordinal list action/i);
  assert.match(prompt, /do not encode the first dynamic item as only a fixed-title click/i);
});
```

- [ ] **Step 2: Add the intent-classification rule to the public prompt**

In `.codex/skills/browser-flow/prompt.md`, replace the current first checklist item:

```md
1. Understand the user's goal (capture new workflow, reverify existing,
```

with:

```md
1. Intent classification: understand whether the user's real goal is
   action replay, page DATA extraction, or both. If the request asks for
   "top N", "current", "latest", "headlines", "prices", "rows",
   "list", "collect", "read", or "check/confirm values", route the
   workflow to Extract after navigation. In that mode, the reproducible
   route should stop on the listing or data page when the user only
   wants the data. If the user clicks a dynamic item, preserve that as
   an ordinal list action ("the current first headline"), not only as a
   fixed-title click. Example: "I'll click the first one, you get the
   other 4" means the durable target is the current top 5 items and the
   clicked article is the current #1 item, not the exact titles seen
   during capture.
```

Then in `### Phase 5 — Extract`, replace:

```md
Skip this phase unless the user's goal is to pull structured DATA off a page
(e.g. "scrape the search results"). It runs AFTER verify. The orchestrator drives
```

with:

```md
Run this phase when intent classification says the user wants page DATA
(e.g. top headlines, current prices, search results, table rows, or
"check these values"). It runs AFTER verify when verification is available;
for unmasked real-site diagnostic runs, it may still read the capture
snapshot, but report it as extracted from the captured/current page rather
than a registry-promoted reusable workflow. The orchestrator drives
```

- [ ] **Step 3: Enforce the rule in the skill validator**

In `.codex/skills/browser-flow/scripts/validate-skill.mjs`, add:

```js
if (!/Intent classification/i.test(promptText)) {
  throw new Error("prompt.md must include an Intent classification step.");
}
if (!/top N.*current.*latest.*headlines/s.test(promptText)) {
  throw new Error("prompt.md must classify dynamic top/current/latest/headline requests as data extraction intent.");
}
if (!/stop on the listing or data page/i.test(promptText)) {
  throw new Error("prompt.md must tell capture to stop on the listing/data page for extraction workflows.");
}
if (!/ordinal list action/i.test(promptText)) {
  throw new Error("prompt.md must preserve dynamic item clicks as ordinal list actions.");
}
if (!/do not encode the first dynamic item as only a fixed-title click/i.test(promptText)) {
  throw new Error("prompt.md must prohibit only-fixed-title encoding of dynamic list items.");
}
```

- [ ] **Step 4: Update orchestrator role responsibility**

In `agents/orchestrator/AGENT.md`, under role/domain authority, add:

```md
- Interprets the user's requested outcome before phase entry. If the
  request is about current/top/latest/list data, the orchestrator must
  plan a navigation route plus Extract phase instead of treating dynamic
  item text as a replay-stable click target.
```

Under constraints, add:

```md
- Dynamic data items are not stable route anchors. For "top 5/current
  headlines/prices/list" requests, stop capture on the page containing
  the list and use extraction for the items. Only click a list item when
  the user wants the ordinal item opened as part of the action route;
  represent that as "current #1/#N item", not as the captured title
  alone.
```

- [ ] **Step 5: Run focused skill tests and validation**

Run:

```bash
node --test --import=./tests/_setup.mjs tests/skill/browser-flow-capture.test.mjs
npm run validate-skill
```

Expected: pass after prompt, validator, and orchestrator docs are updated.

- [ ] **Step 6: Commit**

```bash
git add .codex/skills/browser-flow/prompt.md .codex/skills/browser-flow/scripts/validate-skill.mjs agents/orchestrator/AGENT.md tests/skill/browser-flow-capture.test.mjs
git commit -m "fix: infer dynamic data extraction intent"
```

## Task 7: Bundle Sync and Full Verification

**Files:**
- Modify generated bundle under `.codex/skills/browser-flow/bundle/**`

- [ ] **Step 1: Rebuild the project-local skill bundle**

Run:

```bash
node scripts/publish/build-bundle.mjs
```

Expected: source changes are copied into `.codex/skills/browser-flow/bundle/runtime/**`, bundled agent files, and bundled sub-skill files without provenance or allowlist failures.

- [ ] **Step 2: Run full deterministic check**

Run:

```bash
npm run check
```

Expected: lint, typecheck, skill validation, PII scan, provenance scan, and unit tests pass.

- [ ] **Step 3: Run the relevant e2e smoke tests**

Run:

```bash
npm run test:e2e -- --grep=full-loop
```

If the custom runner does not support `--grep`, run:

```bash
npm run test:e2e
```

Expected: e2e suite passes or only known quarantined flakes appear with documented retries.

- [ ] **Step 4: Commit bundle sync**

```bash
git add .codex/skills/browser-flow/bundle
git commit -m "chore: sync browser-flow skill bundle"
```

## Self-Review

- Spec coverage: permission guidance is Task 1; headed capture default is Task 2; registry permanent-registration wording is Task 3; recorder gesture provenance, same-gesture click coalescing, ignored-event audit output, and ordinal list-item intent are Task 4; structured not-verified/drift classification is Task 5; dynamic data-intent routing is Task 6; bundle/runtime sync is Task 7.
- Placeholder scan: no task uses TBD/TODO/fill-later language; each code-changing step includes concrete code or exact replacement text.
- Type consistency: `verificationOutcome` values are `verified` and `not_verified` consistently across verifier helper, schema, generated runner, and tests. `reasonCategory`, `blockingGate`, and `userFault` are structured artifact fields; localized prose is rendered by the skill/orchestrator instead of stored in `verification.json`. `registryPromotionRefusal()` returns `{ code, message }` and is imported by registry tests. `coalesceGestureClicks(events)` and `inferOrdinalListIntent(event)` are pure helpers consumed by analyze compile.

Plan complete and saved to `docs/superpowers/plans/2026-05-25-capture-diagnostic-hardening.md`.
