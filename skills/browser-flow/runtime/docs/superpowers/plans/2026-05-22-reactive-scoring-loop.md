# Phase 93 — Reactive Scoring Loop (Auto Live-Confidence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `bf verify` drift-holds because an element is *ambiguous* (low-confidence), emit a `scoring-request.json` so the orchestrator can dispatch the scoring-agent, then `bf score --apply` writes the weightOverride and does one bounded re-run — the heal-loop, mirrored for scoring.

**Architecture:** Reactive. The runner already drift-holds + writes `heal-request.json`. Phase 93 branches on `driftReason`: `"ambiguous locator"` → `scoring-request.json` (agent-blind held-element shape + drift metrics); everything else → `heal-request.json` (unchanged). A new `bf score` command mirrors `bf heal`: `--apply` runs `applyScoringResult` (Phase 92) → regenerate → cleanup → one re-run, and appends any `generalizable` pattern to `patterns.json`. Runtime stays LLM-free.

**Tech Stack:** Node ESM (`.mjs`), `node --test`, zod, chrome-remote-interface (e2e), in-system Task/Agent sub-agents.

**Spec:** `docs/superpowers/specs/2026-05-22-reactive-scoring-loop-design.md` (approved).

**Conventions:**
- Single test: `node --test --import=./tests/_setup.mjs <file>`
- Full check: `npm run check`
- Before any real-Chrome run: `pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion`
- Commit after each task. No `--no-verify`.
- Generated-runner identifiers must be < 24 chars (the secret scanner's `HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9+=]{24,}\b/` flags longer camelCase tokens in the scanned `runner.mjs`).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `scripts/lib/schema-versions.mjs` | version registry | Modify — add `scoringResult: 1` |
| `scripts/lib/schemas.mjs` | artifact schemas | Modify — `ScoringResultV1` + `parseScoringResult` |
| `scripts/lib/config.mjs` | run paths | Modify — `scoringRequestPath` |
| `scripts/generate/generate-runner.mjs` | the replay runner (template) | Modify — capture held step index; on ambiguous drift-hold emit scoring-request.json |
| `scripts/commands/score.mjs` | `bf score` command | Create (mirror `heal.mjs`) |
| `scripts/cli.mjs` | CLI dispatch | Modify — register `score` |
| `.codex/skills/scoring-agent/SKILL.md` | sub-agent contract | Modify — input = `scoring-request.json` (reactive) |
| `scripts/demos/scoring-agent-demo.mjs` | real-dispatch demo | Modify — consume `scoring-request.json` (non-CI) |
| `tests/lib/config.test.mjs` | path unit | Modify/Create |
| `tests/lib/schemas.test.mjs` | schema unit | Modify |
| `tests/commands/score.test.mjs` | `bf score` unit | Create |
| `tests/e2e/verify-scoring-loop.test.mjs` | reactive loop e2e | Create (mirror `verify-heal-loop`) |
| `tasks/phases/phase-93-reactive-scoring-loop.md` | phase doc | Create |

---

### Task 1: scoringRequestPath in config + scoringResult schema version

**Files:**
- Modify: `scripts/lib/config.mjs` (~line 195, next to `healRequestPath`)
- Modify: `scripts/lib/schema-versions.mjs` (lines 20, 40)
- Test: `tests/lib/config.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/config.test.mjs` (if the file/import doesn't exist, create it mirroring an existing lib test: `import test from "node:test"; import assert from "node:assert/strict"; import { getRunPaths } from "../../scripts/lib/config.mjs";`):

```js
test("getRunPaths exposes scoringRequestPath under the run root", () => {
  const p = getRunPaths("phase93-cfg");
  assert.ok(p.scoringRequestPath.endsWith("/scoring-request.json"), `got ${p.scoringRequestPath}`);
  // sits beside heal-request.json
  assert.equal(p.scoringRequestPath.replace("scoring-request.json", "heal-request.json"), p.healRequestPath);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --import=./tests/_setup.mjs tests/lib/config.test.mjs`
Expected: FAIL — `scoringRequestPath` undefined.

- [ ] **Step 3: Implement**

In `scripts/lib/config.mjs`, change the `healRequestPath` line (currently the last entry, no trailing comma):
```js
    healRequestPath: resolve(runRoot, "heal-request.json")
```
to:
```js
    healRequestPath: resolve(runRoot, "heal-request.json"),
    scoringRequestPath: resolve(runRoot, "scoring-request.json")
```

In `scripts/lib/schema-versions.mjs`, add `scoringResult: 1` to BOTH frozen objects:
- In `SCHEMA_VERSIONS` (line 20 `healResult: 1` → add comma + `scoringResult: 1`).
- In `ACCEPTED_VERSIONS` (line 40 `healResult: Object.freeze([1])` → add comma + `scoringResult: Object.freeze([1])`).

- [ ] **Step 4: Run, expect PASS + typecheck**

```
node --test --import=./tests/_setup.mjs tests/lib/config.test.mjs
npm run typecheck
```
Expected: PASS, typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/config.mjs scripts/lib/schema-versions.mjs tests/lib/config.test.mjs
git commit -m "phase 93: scoringRequestPath in config + scoringResult schema version"
```

---

### Task 2: ScoringResultV1 schema + parseScoringResult

**Files:**
- Modify: `scripts/lib/schemas.mjs` (after the `HealResult` block, ~line 567-590)
- Test: `tests/lib/schemas.test.mjs`

The scoring-result shape matches the scoring-agent's documented output: `{ schemaVersion, runId, stepIndex, disambiguation:{weightOverrides, note?}, generalizable?:{id,match,signalWeights} }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/schemas.test.mjs` (reuse existing `test`/`assert` imports; add the named import):

```js
import { parseScoringResult } from "../../scripts/lib/schemas.mjs";

test("parseScoringResult accepts a weightOverride result with optional generalizable", () => {
  const r = parseScoringResult({
    schemaVersion: 1, runId: "r1", stepIndex: 2,
    disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5 }, note: "nav tab" },
    generalizable: { id: "nav-tab", match: { structuralKeyIncludes: "nav>", hasHref: true }, signalWeights: { href: 1.5, structuralKey: 0.5 } }
  }, "<test>");
  assert.equal(r.stepIndex, 2);
  assert.equal(r.disambiguation.weightOverrides.href, 1.5);
  assert.equal(r.generalizable.id, "nav-tab");
});

test("parseScoringResult rejects a result missing disambiguation", () => {
  assert.throws(() => parseScoringResult({ schemaVersion: 1, runId: "r1", stepIndex: 0 }, "<test>"));
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --import=./tests/_setup.mjs tests/lib/schemas.test.mjs`
Expected: FAIL — `parseScoringResult` not exported.

- [ ] **Step 3: Implement**

In `scripts/lib/schemas.mjs`, after the `HealResultArtifact` export + its parse helper (the `parseHealResult` function), add:

```js
// Phase 93: scoring-agent output. weightOverrides tune which signals the resolver
// trusts for an ambiguous element; generalizable optionally seeds patterns.json.
const ScoringResultV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.scoringResult),
    runId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    disambiguation: z.object({
      weightOverrides: z.record(z.string(), z.number()),
      note: z.string().optional()
    }),
    generalizable: z.object({
      id: z.string().min(1),
      match: z.record(z.string(), z.unknown()),
      signalWeights: z.record(z.string(), z.number())
    }).optional()
  })
  .passthrough();

export const ScoringResultArtifact = z.discriminatedUnion("schemaVersion", [ScoringResultV1]);

/**
 * Parse + validate a scoring-result.json document. Throws a path-prefixed
 * Error on shape mismatch; returns the validated object on success.
 * @param {unknown} input @param {string} [artifactPath] @returns {z.infer<typeof ScoringResultArtifact>}
 */
export function parseScoringResult(input, artifactPath = "<inline>") {
  const result = ScoringResultArtifact.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid scoring-result (${artifactPath}): ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}
```

(If `z.record(z.string(), z.number())` errors under the installed zod, use `z.record(z.number())` — match whatever `LocatorShape.disambiguation` used in Phase 92; check `scripts/lib/schemas.mjs` for the existing form and mirror it.)

- [ ] **Step 4: Run, expect PASS + typecheck**

```
node --test --import=./tests/_setup.mjs tests/lib/schemas.test.mjs
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/schemas.mjs tests/lib/schemas.test.mjs
git commit -m "phase 93: ScoringResultV1 schema + parseScoringResult"
```

---

### Task 3: Runner emits scoring-request on ambiguous drift-hold

**Files:**
- Modify: `scripts/generate/generate-runner.mjs` (held-step-index capture in the segment loop ~line 481-609; drift-hold emission block ~line 613-643)

The runner currently writes `heal-request.json` on every drift-hold. Add: capture the failing step index; if `driftReason` includes `"ambiguous locator"`, write `scoring-request.json` instead (agent-blind), and skip the heal-request for that case.

- [ ] **Step 1: Capture the held step index**

In the generated runner, near `let heldAtSegment = null; let driftReason = "";` (line 481-482) add:
```js
    let heldStepIndex = null;
```
At the top of the inner step loop (right after `const step = workflow.steps[stepIndex];`, ~line 494), the loop variable `stepIndex` is the current step. In the segment `catch` block (where `heldAtSegment = si; driftReason = m;` is set, ~line 607-608), we need the failing index. Add an outer-scoped tracker: declare `let curStepIndex = -1;` next to `heldStepIndex`, set `curStepIndex = stepIndex;` as the FIRST line inside the inner loop body (after line 494's `const step = ...`), and in the segment catch set:
```js
        heldStepIndex = curStepIndex;
```
(right after `driftReason = m;`).

- [ ] **Step 2: Add the scoring-request path + a drift-metric parser near the runner helpers**

Near `const healRequestPath = ...` (~line 371) add:
```js
  const scoringRequestPath = options.scoringRequestPath ?? ${JSON.stringify(runPaths.scoringRequestPath)};
```
(This requires `runPaths.scoringRequestPath` from Task 1; `generateRunner` already interpolates `runPaths.healRequestPath` the same way — find that interpolation and add the scoring one beside it.)

Add a top-level helper in the runner (next to `classifyFailure`, keeping the name < 24 chars):
```js
function parseDriftMetrics(reason) {
  const m = /winner=([0-9.]+) margin=([0-9.]+) mass=([0-9.]+)/.exec(String(reason || ""));
  return m ? { winner: Number(m[1]), margin: Number(m[2]), mass: Number(m[3]) } : { winner: 0, margin: 0, mass: 0 };
}
```

- [ ] **Step 3: Branch the drift-hold emission**

Replace the emission block. Currently (~line 613-643):
```js
    if (heldAtSegment !== null) {
      let healRequest = false;
      try {
        const liveSkeleton = await captureLiveSkeleton(bs, targetId);
        ... (heal-request construction) ...
        writeFileSync(healRequestPath, JSON.stringify({ heldSegment: heldAtSegment, intent: ..., heldStepLocator, diff, liveSkeleton }, null, 2) + "\\n", "utf8");
        healRequest = true;
      } catch (_e) { /* best-effort */ }
      return writeReport({ ... healRequest, ... });
    }
```

Add the scoring-request branch INSIDE the `if (heldAtSegment !== null)` block, BEFORE the heal-request try (so ambiguous drift emits scoring-request and skips heal-request). Insert at the top of the block:
```js
    if (heldAtSegment !== null) {
      let healRequest = false;
      let scoringRequest = false;
      if (String(driftReason).includes("ambiguous locator")) {
        try {
          const _heldStep = heldStepIndex !== null ? workflow.steps[heldStepIndex] : null;
          const _loc = _heldStep && _heldStep.locator ? _heldStep.locator : {};
          const _heldSegName = (segs[heldAtSegment] || {}).name || ("segment " + heldAtSegment);
          const scoringReq = {
            stepIndex: heldStepIndex,
            intent: _heldSegName,
            heldElement: {
              role: _loc.role || "",
              structuralKey: _loc.structuralKey || "",
              hasHref: typeof _loc.href === "string" && _loc.href !== "",
              type: _loc.type || "",
              neighborCount: Array.isArray(_loc.neighborTexts) ? _loc.neighborTexts.length : 0
            },
            drift: parseDriftMetrics(driftReason)
          };
          writeFileSync(scoringRequestPath, JSON.stringify(scoringReq, null, 2) + "\\n", "utf8");
          scoringRequest = true;
        } catch (_e) { /* best-effort; never block the held report */ }
      }
      if (!scoringRequest) {
        try {
          const liveSkeleton = await captureLiveSkeleton(bs, targetId);
          ... (EXISTING heal-request construction unchanged) ...
          healRequest = true;
        } catch (_e) { /* best-effort */ }
      }
      return writeReport({
        ... existing fields ...,
        healRequest,
        scoringRequest,
        journal: readJournal(journalPath)
      });
    }
```
Wrap the EXISTING heal-request `try { ... } catch` in the `if (!scoringRequest) { ... }` guard (so an ambiguous hold emits only the scoring-request). Add `scoringRequest` to the `writeReport({...})` call.

NOTE: `heldElement` carries NO real text/URL values (only role/structuralKey shape/hasHref bool/type/neighborCount int) — agent-blind. `patterns` is intentionally NOT embedded; the scoring-agent reads `.codex/skills/scoring-agent/patterns.json` directly (its SKILL.md points there).

- [ ] **Step 4: Verify the generated runner is valid + no regression to heal**

```
pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion
npm run typecheck
node --test --import=./tests/_setup.mjs tests/e2e/verify-heal-loop.test.mjs tests/e2e/verify-heal-request.test.mjs tests/e2e/verify-drift-hold.test.mjs
```
Expected: typecheck 0; heal/drift tests still PASS (their drifts are no-match, not "ambiguous", so they still emit heal-request). If a generated runner has a syntax error, `node --check` the runner of one of those runs to locate it.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate/generate-runner.mjs
git commit -m "phase 93: runner emits agent-blind scoring-request.json on ambiguous drift-hold (heldElement shape + drift metrics); heal-request unchanged for no-match"
```

---

### Task 4: `bf score` command (mirror `bf heal`)

**Files:**
- Create: `scripts/commands/score.mjs`
- Modify: `scripts/cli.mjs` (register `score`, ~line 124 where `heal` is)
- Test: `tests/commands/score.test.mjs`

Mirror `scripts/commands/heal.mjs`. `--apply` reads a scoring-result, calls `applyScoringResult` (Phase 92, in `compile.mjs`), persists the workflow, regenerates, cleans up, does ONE re-run, and appends any `generalizable` pattern to `patterns.json`.

- [ ] **Step 1: Write the failing test (deps-injected, no real Chrome)**

Create `tests/commands/score.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { runScoreCommand } from "../../scripts/commands/score.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

test("runScoreCommand --apply writes weightOverride to the step, regenerates, re-runs (bounded)", async () => {
  const runId = `score-cmd-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  // a held run: scoring-request present + a workflow with an un-tuned ambiguous click
  writeJson(runPaths.scoringRequestPath, { stepIndex: 1, intent: "open-talk", heldElement: { role: "link", structuralKey: "nav>x|a|||Section", hasHref: true, type: "", neighborCount: 0 }, drift: { winner: 0.44, margin: 0.01, mass: 0.13 } });
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual", startUrl: "http://x/", finalUrl: "http://x/t",
    steps: [{ action: "goto", url: "http://x/" }, { action: "click", selector: "nav a", locator: { role: "link", structuralKey: "nav>x|a|||Section", href: "/t" } }],
    verification: { expectedFinalUrl: "http://x/t" }, security: { localOnly: true }
  });
  const scoringResult = { schemaVersion: SCHEMA_VERSIONS.scoringResult, runId, stepIndex: 1, disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5 } }, generalizable: { id: "nav-tab", match: { structuralKeyIncludes: "nav>", hasHref: true }, signalWeights: { href: 1.5, structuralKey: 0.5 } } };
  const applyPath = `${runPaths.tasksDir}/scoring-result.json`;
  writeJson(applyPath, scoringResult);

  const calls = { regenerate: 0, cleanup: 0, rerun: 0 };
  const res = /** @type {any} */ (await runScoreCommand({ runId, applyPath, headless: true }, {
    regenerate: async () => { calls.regenerate++; },
    cleanup: async () => { calls.cleanup++; return { ok: true }; },
    rerun: async () => { calls.rerun++; return { report: { pathComplete: true } }; }
  }));

  assert.equal(res.status, "scored");
  assert.equal(calls.regenerate, 1, "regenerate once");
  assert.equal(calls.rerun, 1, "exactly one bounded re-run");
  const wf = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
  assert.deepEqual(wf.steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 }, "weightOverride persisted to step.locator");
});

test("runScoreCommand without --apply returns the scoring-request", async () => {
  const runId = `score-req-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.scoringRequestPath, { stepIndex: 1, intent: "x", heldElement: {}, drift: {} });
  const res = /** @type {any} */ (await runScoreCommand({ runId }, {}));
  assert.equal(res.scoringRequest.stepIndex, 1);
});

test("runScoreCommand errors when there is no scoring-request", async () => {
  const runId = `score-none-${Date.now()}`;
  ensureRunDirs(runId);
  await assert.rejects(() => runScoreCommand({ runId }, {}), /no scoring-request/);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --import=./tests/_setup.mjs tests/commands/score.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/commands/score.mjs`**

```js
import { existsSync } from "node:fs";
import { getStringOption } from "../lib/args.mjs";
import { getRunPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { parseScoringResult } from "../lib/schemas.mjs";
import { applyScoringResult } from "../analyze/compile.mjs";
import { loadPatterns } from "../lib/pattern-match.mjs";
import { generateRunner } from "../generate/generate-runner.mjs";
import { runCleanupCommand } from "./cleanup.mjs";
import { verifyRun } from "../verify/verify-run.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PATTERNS_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../.codex/skills/scoring-agent/patterns.json");

/**
 * Phase 93: bf score — deterministic half of the reactive scoring loop.
 * Reads a held run's scoring-request.json; on --apply applies the scoring-agent's
 * weightOverride to the workflow (self-tune cache), appends any generalizable
 * pattern to patterns.json, regenerates, cleans up, and does exactly ONE re-run.
 * BOUNDED — one re-run, no retry loop. Mirror of bf heal.
 * @param {{ runId: string, applyPath?: string, headless?: boolean }} input
 * @param {{ regenerate?: Function, cleanup?: Function, rerun?: Function }} [deps]
 */
export async function runScoreCommand(input, deps = {}) {
  const regenerate = deps.regenerate ?? generateRunner;
  const cleanup = deps.cleanup ?? runCleanupCommand;
  const rerun = deps.rerun ?? verifyRun;
  const runPaths = getRunPaths(input.runId);
  if (!existsSync(runPaths.scoringRequestPath)) {
    throw new Error("no scoring-request for run " + input.runId + " — it did not ambiguous-drift-hold");
  }
  const scoringRequest = /** @type {Record<string, any>} */ (readJson(runPaths.scoringRequestPath));
  if (!input.applyPath) {
    return { runId: input.runId, scoringRequest };
  }
  const scoringResult = parseScoringResult(readJson(input.applyPath), input.applyPath);
  const workflow = /** @type {{ steps: Record<string, any>[] } & Record<string, any>} */ (readJson(runPaths.workflowJsonPath));
  applyScoringResult(workflow.steps, scoringResult);
  if (scoringResult.generalizable) {
    appendPattern(scoringResult.generalizable);
  }
  writeJson(runPaths.workflowJsonPath, workflow);
  await regenerate(input.runId);
  const cleanupResult = await cleanup({ runId: input.runId, headless: input.headless !== false });
  const rerunResult = await rerun(input.runId, { headless: input.headless !== false });
  return { runId: input.runId, status: "scored", stepIndex: scoringResult.stepIndex, cleanup: cleanupResult, rerun: rerunResult };
}

/** Append a generalizable pattern to patterns.json if not a duplicate id. */
function appendPattern(pattern) {
  const existing = loadPatterns(PATTERNS_PATH);
  if (existing.some((p) => p.id === pattern.id)) return;
  writeJson(PATTERNS_PATH, [...existing, pattern]);
}

/** @param {Record<string, string | boolean>} options */
export function scoreCommand(options) {
  const runId = getStringOption(options, "run-id", undefined);
  if (!runId) throw new Error("bf score requires --run-id");
  const applyPath = getStringOption(options, "apply", undefined);
  return runScoreCommand({ runId, applyPath, headless: options.headless !== false });
}
```

NOTE: confirm `writeJson` is exported from `scripts/lib/fs.mjs` (heal.mjs imports it — it is) and `applyScoringResult` is exported from `compile.mjs` (Phase 92 — it is). `loadPatterns(path)` accepts a path arg (Phase 92). `appendPattern` writes the seed file — guard against duplicate ids so re-runs don't grow it.

- [ ] **Step 4: Register the command in `scripts/cli.mjs`**

Find the `heal` block (~line 124):
```js
  if (command === "heal") {
    ...
  }
```
Add after it, mirroring its structure (import `scoreCommand` at the top of cli.mjs next to the heal import, then):
```js
  if (command === "score") {
    return scoreCommand(options);
  }
```
(Match the exact dispatch style cli.mjs uses for `heal` — e.g. if it `await`s or prints the result, do the same.)

- [ ] **Step 5: Run, expect PASS + typecheck**

```
node --test --import=./tests/_setup.mjs tests/commands/score.test.mjs
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add scripts/commands/score.mjs scripts/cli.mjs tests/commands/score.test.mjs
git commit -m "phase 93: bf score --apply (mirror bf heal) — applyScoringResult + generalizable->patterns.json + bounded re-run"
```

---

### Task 5: scoring-agent SKILL.md — reactive input

**Files:**
- Modify: `.codex/skills/scoring-agent/SKILL.md`

- [ ] **Step 1: Update the Input section**

Change the Input section to point at `scoring-request.json` (reactive, emitted on ambiguous drift-hold) and describe the `drift` metrics. Replace the input path + shape block with:

```markdown
## Input — `scoring-request.json`

Path: `artifacts/runs/<runId>/scoring-request.json`. Emitted by the runner when
`bf verify` drift-holds with reason "ambiguous locator: low-confidence". Agent-blind —
signal *types/shape/presence* only, no real text or URL values:

​```json
{
  "stepIndex": <number>,
  "intent": "<what this step is FOR>",
  "heldElement": { "role": "...", "structuralKey": "<shape>", "hasHref": <bool>, "type": "...", "neighborCount": <int> },
  "drift": { "winner": <number>, "margin": <number>, "mass": <number> }
}
​```

`drift` tells you WHICH gate failed: low `mass` means the high-weight (stable) signals
did not corroborate even though the element is present — promote the decisive signal
(often `href` for nav/links) to the stable tier (>= 1.5) via `weightOverrides`. Read the
current `patterns.json` (this skill's directory) to avoid duplicating an existing rule.
```

Keep the Output (`scoring-result.json`) + Constraints sections; ensure the output `runId`/`stepIndex` are required (they are, per Task 2 schema) and update any stale reference to the old input shape.

- [ ] **Step 2: Validate skill registry**

Run: `npm run validate-skill`
Expected: `browser-flow skill validated`.

- [ ] **Step 3: Commit**

```bash
git add .codex/skills/scoring-agent/SKILL.md
git commit -m "phase 93: scoring-agent input = scoring-request.json (reactive, drift-metric driven)"
```

---

### Task 6: e2e reactive scoring loop (mirror verify-heal-loop)

**Files:**
- Test: `tests/e2e/verify-scoring-loop.test.mjs`

Reuse the Phase 92 `navtab` fixture: a workflow with the stale-structuralKey nav locator and NO disambiguation drift-holds with "ambiguous locator". Assert the scoring-request is emitted, then a synthetic scoring-result (model stand-in, like heal-loop's synthetic heal-result) heals it via `bf score --apply`, and the re-run completes.

- [ ] **Step 1: Write the test**

Create `tests/e2e/verify-scoring-loop.test.mjs` (model on `tests/e2e/verify-heal-loop.test.mjs` — read it first for exact helper imports / `verifyRun` shape / `runScoreCommand` usage):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { runScoreCommand } from "../../scripts/commands/score.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

test("verify-scoring-loop: ambiguous drift-hold -> scoring-request -> bf score --apply -> re-run completes", { timeout: 120000 }, async () => {
  const runId = `scoring-loop-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const server = await startFixtureServer();
  try {
    const baseUrl = server.baseUrl;
    // navtab fixture: 3 same-named "Section" tabs; stale structuralKey -> default mass<0.55 -> ambiguous hold.
    writeJson(runPaths.workflowJsonPath, {
      schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual",
      startUrl: `${baseUrl}/navtab`, finalUrl: `${baseUrl}/navtab/talk`,
      steps: [
        { action: "goto" },
        { action: "click", selector: "nav a", text: "Section", href: "/navtab/talk", expectUrl: `${baseUrl}/navtab/talk`,
          locator: { role: "link", name: "Section", structuralKey: "nav>STALE-WRAPPER|a|||Section", href: "/navtab/talk", relXPath: "//nav/a[2]" } }
      ],
      segments: [{ range: [0, 1], startPageKey: "navtab", endPageKey: "navtab/talk", name: "open-talk" }],
      verification: { expectedNetwork: null, expectedEvidence: null, expectedFinalUrl: "/navtab/talk", transitionTimeoutMs: 8000 },
      security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
    });
    generateRunner(runId);

    // 1. First run ambiguous-drift-holds + emits scoring-request.json.
    const held = /** @type {any} */ ((await verifyRun(runId, { headless: true })).report);
    assert.equal(held.heldAtSegment, 0, `must hold at segment 0 — ${JSON.stringify(held)}`);
    assert.ok(String(held.driftReason).includes("ambiguous locator"), `drift must be ambiguous — ${held.driftReason}`);
    assert.ok(existsSync(runPaths.scoringRequestPath), "scoring-request.json must exist after ambiguous hold");
    const req = /** @type {any} */ (readJson(runPaths.scoringRequestPath));
    assert.equal(req.heldElement.hasHref, true, "scoring-request heldElement carries hasHref");
    assert.ok(req.drift.mass < 0.55, `drift mass should be sub-threshold — ${JSON.stringify(req.drift)}`);

    // 2. Synthetic scoring-result (model stand-in): nav-tab weightOverride.
    const applyPath = `${runPaths.tasksDir}/scoring-result.json`;
    writeJson(applyPath, {
      schemaVersion: SCHEMA_VERSIONS.scoringResult, runId, stepIndex: req.stepIndex,
      disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5 }, note: "nav tab: href decisive" }
    });

    // 3. bf score --apply: apply -> regenerate -> cleanup -> ONE re-run.
    const res = /** @type {any} */ (await runScoreCommand({ runId, applyPath, headless: true }));
    assert.equal(res.status, "scored");
    const rerun = /** @type {any} */ (res.rerun.report);
    assert.equal(rerun.pathComplete, true, `re-run must complete — ${JSON.stringify(rerun)}`);
    assert.ok((rerun.executedSteps || []).includes("click"), "the nav-tab click executed on re-run");

    // self-tune cache persisted.
    const wf = /** @type {any} */ (readJson(runPaths.workflowJsonPath));
    assert.deepEqual(wf.steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 });
  } finally {
    await server.close();
  }
});
```

IMPORTANT: read `verify-heal-loop.test.mjs` and match `verifyRun`'s return shape (`{report}`), `req.stepIndex` (the runner sets `stepIndex` = held step index = 1 here), and the cleanup behavior. If `runScoreCommand`'s real `cleanup`/`rerun` need the fixture server alive, keep it open through the call (the `finally` does).

- [ ] **Step 2: Run (clean Chrome), expect PASS**

```
pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion
node --test --import=./tests/_setup.mjs tests/e2e/verify-scoring-loop.test.mjs
```
Expected: PASS. If the first run does NOT emit ambiguous drift (e.g. resolves), confirm the stale structuralKey + 3 same-named tabs still produce mass<0.55; the navtab fixture from Phase 92 is the proven trigger. Do NOT weaken assertions — the ambiguous-hold + recovery is the point. If `bf score` re-run still holds, print the rerun report to diagnose (do not mask).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/verify-scoring-loop.test.mjs
git commit -m "phase 93: e2e reactive scoring loop — ambiguous hold -> scoring-request -> bf score --apply -> re-run completes (navtab fixture, heal-loop mirror)"
```

---

### Task 7: scoring-agent demo — reactive consumption (non-CI)

**Files:**
- Modify: `scripts/demos/scoring-agent-demo.mjs`

- [ ] **Step 1: Repoint the demo at scoring-request.json**

The Phase 92 demo builds a request from the workflow. Update it to the reactive flow: read the held run's `scoring-request.json` (emitted by verify), print it for the orchestrator to feed the scoring-agent, and document the follow-up (`bf score --apply <scoring-result>`). Keep it a non-CI orchestrator demo (mirror the gap1 heal demo). Replace the body with:

```js
// @ts-check
// NON-CI demo: real internal scoring-agent sub-agent path (reactive; mirrors gap1 heal demo).
// Precondition: a run that ambiguous-drift-held (bf verify wrote scoring-request.json).
// Usage (orchestrator): node scripts/demos/scoring-agent-demo.mjs --run-id <id>
//   1) reads artifacts/runs/<id>/scoring-request.json (agent-blind held-element + drift metrics),
//   2) the ORCHESTRATOR dispatches `.codex/skills/scoring-agent` (Task tool) -> scoring-result.json,
//   3) bf score --run-id <id> --apply artifacts/runs/<id>/tasks/scoring-result.json -> re-run completes.
import { getRunPaths } from "../lib/config.mjs";
import { readJson } from "../lib/fs.mjs";
import { existsSync } from "node:fs";

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

function main() {
  const runId = arg("--run-id");
  if (!runId) { console.error("usage: node scripts/demos/scoring-agent-demo.mjs --run-id <id>"); process.exit(1); }
  const p = getRunPaths(runId);
  if (!existsSync(p.scoringRequestPath)) { console.error("no scoring-request.json — run did not ambiguous-drift-hold"); process.exit(2); }
  const req = readJson(p.scoringRequestPath);
  console.error("scoring-request:", JSON.stringify(req, null, 2));
  console.error("Next (orchestrator): dispatch .codex/skills/scoring-agent with the above,");
  console.error("then: bf score --run-id " + runId + " --apply <scoring-result.json>");
}

main();
```

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/demos/scoring-agent-demo.mjs`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/demos/scoring-agent-demo.mjs
git commit -m "phase 93: scoring-agent demo consumes scoring-request.json (reactive, non-CI)"
```

---

### Task 8: Phase doc + full check (no governance gate)

**Files:**
- Create: `tasks/phases/phase-93-reactive-scoring-loop.md`
- Append: `tasks/lessons.md`

- [ ] **Step 1: Write `tasks/phases/phase-93-reactive-scoring-loop.md`**

Follow `phase-92-scoring-agent.md` structure. Include: user-quotes (frequency-first; "라이브 증거가 순서상 먼저"; reactive>proactive rationale = mid-flow state problem), the heal-loop-mirror architecture, the heal-vs-scoring routing table (driftReason), the file table, the e2e proof, and the governance note: **Phase 93 fires no gate** (last_constraint_review_phase=91 → next 96; last_eval_audit_phase=92 → next 102). `.governance/state.json` UNCHANGED.

- [ ] **Step 2: Append a lesson to `tasks/lessons.md`**

Execution-learning: the reactive trigger reuses the heal-loop wholesale by branching on driftReason — a new "agent loop" (scoring) costs little when an existing one (heal) already owns drift-hold→agent→apply→bounded-re-run; the only genuinely new pieces are the request shape + the apply command.

- [ ] **Step 3: Full check GREEN**

```
pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion
npm run check
```
Expected: lint + typecheck + validate-skill + tests PASS, 0 fail / 0 skipped. (A one-off real-Chrome stall on an unrelated e2e is load flake — re-run to confirm, as in Phase 92.)

- [ ] **Step 4: Commit**

```bash
git add tasks/phases/phase-93-reactive-scoring-loop.md tasks/lessons.md
git commit -m "phase 93: phase doc + lesson — reactive scoring loop complete (no governance gate)"
```

---

## Self-Review

**1. Spec coverage:**
- scoring-request emission on ambiguous drift-hold → Task 3 ✓
- `bf score --apply` (heal mirror) → Task 4 ✓
- applyScoringResult reuse → Task 4 ✓ (Phase 92 asset)
- ScoringRequest/Result schema → Task 2 ✓ (request is runner-written/agent-read, not zod-parsed — only result is parsed; request shape is documented in SKILL.md + asserted in e2e Task 6)
- config paths → Task 1 ✓
- scoring-agent SKILL.md reactive input → Task 5 ✓
- demo reactive → Task 7 ✓
- generalizable → patterns.json append → Task 4 ✓
- e2e verify-scoring-loop → Task 6 ✓
- routing (driftReason) → Task 3 (emission) + SKILL/phase doc (orchestrator routing documented) ✓
- governance no-gate → Task 8 ✓
- agent-blind / bounded / runtime-LLM-free → Tasks 3,4 ✓

**Gap found + resolved:** The spec lists a `ScoringRequestV1` schema, but the request is written by the runner and read by the agent/`bf score` (never zod-validated in code) — so a formal zod schema for the *request* is unnecessary (YAGNI). Only `ScoringResultV1` (parsed by `bf score`) needs a schema. Task 2 covers the result; the request shape is asserted by the e2e (Task 6) and documented in SKILL.md (Task 5). This deviates from the spec's file table (which named ScoringRequestV1) — intentionally dropped to avoid an unused schema.

**2. Placeholder scan:** Task 3 references "EXISTING heal-request construction unchanged" with `...` — this is intentional (preserve the existing block verbatim, only wrap it in `if (!scoringRequest)`); the implementer must keep the current lines, not invent. Flagged inline. No other placeholders.

**3. Type consistency:** `runScoreCommand`/`scoreCommand` (score.mjs), `parseScoringResult`/`ScoringResultArtifact` (schemas.mjs), `scoringRequestPath` (config), `applyScoringResult(steps, result)` (compile.mjs, Phase 92 — takes `steps` array, result with `stepIndex`+`disambiguation`), `loadPatterns(path)` (pattern-match.mjs). `scoringResult.generalizable` shape matches `appendPattern` + pattern-match `evalMatch` predicate keys. `status: "scored"` consistent across score.mjs + tests.

**Notes for the implementer:**
- Read `verify-heal-loop.test.mjs` + `heal.mjs` first — this whole phase mirrors them.
- Keep every new runner identifier < 24 chars (entropy scanner).
- Preserve the existing heal-request block verbatim inside the new `if (!scoringRequest)` guard.
- Confirm `applyScoringResult` signature is `(steps, result)` and mutates in place (Phase 92).
- The scoring-request is agent-blind: never put real text/URL values in `heldElement`.
