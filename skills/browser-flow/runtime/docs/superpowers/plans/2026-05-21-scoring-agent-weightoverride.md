# Phase 92 — Scoring-Agent + Pattern-Set + Per-Element WeightOverride Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an element's *type* drive its locator weighting — so the decisive signal (e.g. a nav-tab's href) reaches both the score AND the confidence (mass) gate — via a deterministic agent-blind pattern-set applied at analyze time, with an internal scoring-agent that grows the pattern-set for novel ambiguous elements.

**Architecture:** 빵틀 80/20 on resolution. (1) `decideConfidence` mass membership is redefined from a hardcoded STABLE set to *effective weight ≥ STABLE_TIER(1.5)*, so a `weightOverride` is the single knob driving score + confidence. (2) A pure `pattern-match` module maps a captured `step.locator` (by role / structuralKey substring / hasHref / type — no real values) to `disambiguation.weightOverrides`, wired into `compile`. (3) Seed `patterns.json` + a `scoring-agent` SKILL (internal sub-agent, no external LLM) that emits a per-step disambiguation and an optional generalizable pattern. Runtime stays LLM-free; `resolveLocator` already merges `loc.disambiguation.weightOverrides`.

**Tech Stack:** Node ESM (`.mjs`), `node --test`, zod schemas, chrome-remote-interface (e2e), in-system Task/Agent sub-agents.

**Spec:** `docs/superpowers/specs/2026-05-21-scoring-agent-weightoverride-design.md` (approved).

**Conventions:**
- Single test file: `node --test --import=./tests/_setup.mjs <file>`
- Full check: `npm run check` (lint + typecheck + validate-skill + test)
- Before any real-Chrome run: `pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion`
- Commit after each task. Never `--no-verify`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `scripts/lib/resolver-score.mjs` | scorer + confidence gate | Modify — mass membership by effective weight |
| `scripts/lib/pattern-match.mjs` | pure element-type → weightOverride matcher | Create |
| `.codex/skills/scoring-agent/patterns.json` | agent-blind seed pattern-set | Create |
| `.codex/skills/scoring-agent/SKILL.md` | internal sub-agent disambiguation contract | Create |
| `scripts/analyze/compile.mjs` | apply patterns to each step.locator | Modify (after `segments`, ~line 280) |
| `scripts/lib/schemas.mjs` | `disambiguation` field on LocatorShape | Modify (LocatorShape, ~line 74) |
| `scripts/fixtures/site-server.mjs` | `navtab` fixture (href-decisive, brittle structuralKey) | Modify |
| `tests/lib/pattern-match.test.mjs` | matcher unit | Create |
| `tests/lib/resolver-score.test.mjs` | mass-unification unit | Modify (augment) |
| `tests/e2e/verify-navtab-weightoverride.test.mjs` | drift-hold without pattern → HIGH with pattern | Create |
| `tests/analyze/compile-patterns.test.mjs` | compile wires patterns to step.locator | Create |
| `scripts/demos/scoring-agent-demo.mjs` | real internal sub-agent dispatch demo (non-CI) | Create |
| `.governance/state.json` | `last_eval_audit_phase` 82→92 | Modify |
| `tasks/phases/phase-92-scoring-agent.md` | phase doc + eval audit record | Create |

---

### Task 1: Mass-gate unification (effective weight ≥ STABLE_TIER)

**Files:**
- Modify: `scripts/lib/resolver-score.mjs` (line 10 STABLE def; line ~90 mass loop in `decideConfidence`)
- Test: `tests/lib/resolver-score.test.mjs`

Background: today `decideConfidence` computes `highWeightMass` only over a hardcoded `STABLE` Set, using `weights[k]` merely as the multiplier. So a `weightOverride` that bumps `href` to 1.5 raises the *score* but never enters *mass* — the P4 wiki blocker. Redefine mass membership as "the signal's effective (possibly-overridden) weight is at the stable tier".

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/resolver-score.test.mjs`:

```js
import { scoreCandidates, decideConfidence, DEFAULT_WEIGHTS, STABLE_TIER } from "../../scripts/lib/resolver-score.mjs";

test("STABLE_TIER exported = 1.5", () => { assert.equal(STABLE_TIER, 1.5); });

test("mass: default weights keep the 4 stable signals as the mass set (regression)", () => {
  // target present in name+structuralKey; one perfect candidate.
  const target = { name: "Talk", structuralKey: "k1" };
  const scored = scoreCandidates(target, [{ name: "Talk", structuralKey: "k1" }], DEFAULT_WEIGHTS);
  const d = decideConfidence(scored);
  assert.equal(d.highWeightMass, 1, `name+structuralKey both 1.0 -> mass 1.0, got ${d.highWeightMass}`);
});

test("mass: weightOverride promotes href into the mass set; brittle structuralKey demoted out", () => {
  // Reproduces the wiki nav-tab class: stale structuralKey (sim 0), decisive href (sim 1).
  const target = { name: "Talk", structuralKey: "stale", href: "/navtab/talk" };
  const cand = { name: "Talk", structuralKey: "live-differs", href: "/navtab/talk" };
  const sib = { name: "Talk", structuralKey: "live-differs", href: "/navtab/home" };

  // DEFAULT: mass = (name 1.5*1 + structuralKey 1.5*0)/3 = 0.5 -> below 0.55 -> LOW.
  const dDefault = decideConfidence(scoreCandidates(target, [cand, sib], DEFAULT_WEIGHTS));
  assert.ok(dDefault.highWeightMass < 0.55, `default mass must be sub-threshold, got ${dDefault.highWeightMass}`);
  assert.equal(dDefault.confidence, "low");

  // OVERRIDE nav-tab: href->1.5 (joins mass), structuralKey->0.5 (leaves mass).
  const w = { ...DEFAULT_WEIGHTS, href: 1.5, structuralKey: 0.5 };
  const dOver = decideConfidence(scoreCandidates(target, [cand, sib], w), { weights: w });
  // mass set now = {name(1.5,1.0), href(1.5,1.0)} -> 1.0
  assert.ok(dOver.highWeightMass >= 0.55, `override mass must clear threshold, got ${dOver.highWeightMass}`);
  assert.equal(dOver.confidence, "high");
  assert.equal(dOver.pick, 0, "the /navtab/talk candidate must win");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --import=./tests/_setup.mjs tests/lib/resolver-score.test.mjs`
Expected: FAIL — `STABLE_TIER` is not exported; mass tests fail (override does nothing today).

- [ ] **Step 3: Implement**

In `scripts/lib/resolver-score.mjs`:

Replace line 10:
```js
const STABLE = new Set(["name", "structuralKey", "neighborTexts", "cleanId"]);
```
with:
```js
// A signal contributes to confidence "mass" iff its EFFECTIVE (possibly-overridden)
// weight is at the stable tier. With DEFAULT_WEIGHTS the tier-1.5 signals are exactly
// {name, structuralKey, neighborTexts, cleanId} — so default behavior is unchanged —
// but a per-element weightOverride (Phase 92) that lifts e.g. href to 1.5 makes it
// count toward mass too, and one that drops a brittle structuralKey to 0.5 removes it.
export const STABLE_TIER = 1.5;
```

In `decideConfidence`, replace the mass loop (currently):
```js
  for (const k of Object.keys(top.s.perSignal)) if (STABLE.has(k)) { mNum += weights[k] * top.s.perSignal[k]; mDen += weights[k]; }
```
with:
```js
  for (const k of Object.keys(top.s.perSignal)) if ((weights[k] ?? 0) >= STABLE_TIER) { mNum += weights[k] * top.s.perSignal[k]; mDen += weights[k]; }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test --import=./tests/_setup.mjs tests/lib/resolver-score.test.mjs`
Expected: PASS (all, including the prior P2 tests — default behavior preserved).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/resolver-score.mjs tests/lib/resolver-score.test.mjs
git commit -m "phase 92: mass-gate membership by effective weight>=STABLE_TIER (weightOverride drives score+confidence; default behavior unchanged)"
```

---

### Task 2: Pure pattern matcher

**Files:**
- Create: `scripts/lib/pattern-match.mjs`
- Test: `tests/lib/pattern-match.test.mjs`

`matchPattern` evaluates an agent-blind predicate over a locator's OWN fields only. No real text/URL values are read — only role, structuralKey substring, href presence, type.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pattern-match.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { matchPattern, evalMatch } from "../../scripts/lib/pattern-match.mjs";

const PATTERNS = [
  { id: "nav-tab", match: { structuralKeyIncludes: "nav>", hasHref: true }, signalWeights: { href: 1.5, structuralKey: 0.5 } },
  { id: "form-input", match: { roleIn: ["textbox", "combobox"] }, signalWeights: { name: 1.5, neighborTexts: 1.5 } }
];

test("evalMatch: roleIn / structuralKeyIncludes / hasHref / typeIn", () => {
  assert.equal(evalMatch({ role: "textbox" }, { roleIn: ["textbox", "combobox"] }), true);
  assert.equal(evalMatch({ role: "link" }, { roleIn: ["textbox"] }), false);
  assert.equal(evalMatch({ structuralKey: "nav>ul>li|a|||X" }, { structuralKeyIncludes: "nav>" }), true);
  assert.equal(evalMatch({ structuralKey: "main>p|a|||X" }, { structuralKeyIncludes: "nav>" }), false);
  assert.equal(evalMatch({ href: "/x" }, { hasHref: true }), true);
  assert.equal(evalMatch({ href: "" }, { hasHref: true }), false);
  assert.equal(evalMatch({ type: "submit" }, { typeIn: ["submit"] }), true);
  // empty match object matches nothing (avoid catch-all)
  assert.equal(evalMatch({ role: "link" }, {}), false);
  // all conditions must hold (AND)
  assert.equal(evalMatch({ structuralKey: "nav>x", href: "" }, { structuralKeyIncludes: "nav>", hasHref: true }), false);
});

test("matchPattern: first matching pattern wins, else null", () => {
  const navTab = { role: "link", structuralKey: "nav>ul>li|a|||Talk", href: "/navtab/talk" };
  assert.equal(matchPattern(navTab, PATTERNS)?.id, "nav-tab");
  assert.deepEqual(matchPattern(navTab, PATTERNS)?.weightOverrides, { href: 1.5, structuralKey: 0.5 });
  assert.equal(matchPattern({ role: "textbox" }, PATTERNS)?.id, "form-input");
  assert.equal(matchPattern({ role: "button" }, PATTERNS), null);
  assert.equal(matchPattern({ role: "link", structuralKey: "main>a|||X", href: "/x" }, PATTERNS), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --import=./tests/_setup.mjs tests/lib/pattern-match.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `scripts/lib/pattern-match.mjs`:

```js
// @ts-check
// Pure, agent-blind element-type matcher. Maps a captured step.locator to a set of
// weightOverrides by element TYPE — using only the locator's own structural signals
// (role, structuralKey substring, href presence, type). No real text/URL VALUES are
// inspected, so this respects the agent-blind boundary.

const KNOWN_SIGNALS = new Set(["name", "structuralKey", "neighborTexts", "cleanId", "role", "type", "alt", "href", "relXPath", "box"]);

/** @param {Record<string,unknown>} loc @param {Record<string,unknown>} match @returns {boolean} */
export function evalMatch(loc, match) {
  const keys = Object.keys(match || {});
  if (keys.length === 0) return false; // empty predicate is never a catch-all
  for (const k of keys) {
    const cond = match[k];
    if (k === "roleIn") { if (!Array.isArray(cond) || !cond.includes(loc.role)) return false; }
    else if (k === "typeIn") { if (!Array.isArray(cond) || !cond.includes(loc.type)) return false; }
    else if (k === "structuralKeyIncludes") { if (typeof loc.structuralKey !== "string" || !loc.structuralKey.includes(String(cond))) return false; }
    else if (k === "hasHref") { const has = typeof loc.href === "string" && loc.href !== ""; if (Boolean(cond) !== has) return false; }
    else return false; // unknown predicate key -> conservative no-match
  }
  return true;
}

/**
 * First matching pattern's signalWeights (whitelisted + clamped) as weightOverrides.
 * @param {Record<string,unknown>} loc
 * @param {Array<{id:string, match:Record<string,unknown>, signalWeights:Record<string,number>}>} patterns
 * @returns {{id:string, weightOverrides:Record<string,number>} | null}
 */
export function matchPattern(loc, patterns) {
  for (const p of patterns || []) {
    if (p && p.match && evalMatch(loc, p.match)) {
      return { id: p.id, weightOverrides: sanitizeWeights(p.signalWeights) };
    }
  }
  return null;
}

/** @param {Record<string,number>} w @returns {Record<string,number>} */
function sanitizeWeights(w) {
  /** @type {Record<string,number>} */ const out = {};
  for (const [k, v] of Object.entries(w || {})) {
    if (!KNOWN_SIGNALS.has(k)) continue;            // ignore unknown signal names
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = n < 0 ? 0 : n > 3 ? 3 : n;             // clamp [0,3]
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test --import=./tests/_setup.mjs tests/lib/pattern-match.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pattern-match.mjs tests/lib/pattern-match.test.mjs
git commit -m "phase 92: pure agent-blind pattern matcher (roleIn/structuralKeyIncludes/hasHref/typeIn -> weightOverrides, whitelisted+clamped)"
```

---

### Task 3: Pattern-set loader + applyPatterns

**Files:**
- Modify: `scripts/lib/pattern-match.mjs` (add `loadPatterns`, `applyPatterns`)
- Test: `tests/lib/pattern-match.test.mjs` (augment)

`loadPatterns` reads the seed `patterns.json` defensively (missing/parse error → `[]`, never throws). `applyPatterns` writes `disambiguation.weightOverrides` onto a locator **without overwriting an existing disambiguation** (model > pattern precedence).

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/pattern-match.test.mjs`:

```js
import { loadPatterns, applyPatterns } from "../../scripts/lib/pattern-match.mjs";

test("loadPatterns: returns an array (seed file) and never throws", () => {
  const ps = loadPatterns();
  assert.ok(Array.isArray(ps) && ps.length >= 1, "seed patterns.json must load as a non-empty array");
  for (const p of ps) { assert.ok(p.id && p.match && p.signalWeights, `each pattern needs id/match/signalWeights: ${JSON.stringify(p)}`); }
  assert.deepEqual(loadPatterns("/no/such/file.json"), []); // missing -> []
});

test("applyPatterns: sets disambiguation.weightOverrides on a match, leaves existing untouched", () => {
  const navTab = { role: "link", structuralKey: "nav>ul>li|a|||Talk", href: "/navtab/talk" };
  const out = applyPatterns(navTab, loadPatterns());
  assert.deepEqual(out.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 });
  assert.equal(out.disambiguation.patternId, "nav-tab");

  const noMatch = applyPatterns({ role: "button" }, loadPatterns());
  assert.equal(noMatch.disambiguation, undefined, "no match -> no disambiguation added");

  const preset = { role: "link", structuralKey: "nav>x", href: "/x", disambiguation: { weightOverrides: { name: 2 } } };
  const kept = applyPatterns(preset, loadPatterns());
  assert.deepEqual(kept.disambiguation.weightOverrides, { name: 2 }, "existing disambiguation (model output) is not overwritten");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --import=./tests/_setup.mjs tests/lib/pattern-match.test.mjs`
Expected: FAIL — `loadPatterns`/`applyPatterns` not exported (and patterns.json absent until Task 4; this test passing fully depends on Task 4's file — see Step 4).

- [ ] **Step 3: Implement**

Append to `scripts/lib/pattern-match.mjs`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../.codex/skills/scoring-agent/patterns.json");

/** Load the seed pattern-set. Missing/invalid -> [] (never throws). @param {string} [path] @returns {Array<any>} */
export function loadPatterns(path = SEED_PATH) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.id && p.match && p.signalWeights) : [];
  } catch { return []; }
}

/**
 * Return a copy of the locator with disambiguation.weightOverrides set when a pattern
 * matches AND no disambiguation already exists (model output wins over pattern seed).
 * @param {Record<string,unknown>} loc @param {Array<any>} patterns @returns {Record<string,unknown>}
 */
export function applyPatterns(loc, patterns) {
  if (loc && loc.disambiguation) return loc;          // already decided (model) — leave it
  const m = matchPattern(loc, patterns);
  if (!m) return loc;
  return { ...loc, disambiguation: { weightOverrides: m.weightOverrides, patternId: m.id } };
}
```

- [ ] **Step 4: Run to verify pass (after Task 4 creates patterns.json)**

This test depends on the seed file from Task 4. Implement Task 4 next, then:
Run: `node --test --import=./tests/_setup.mjs tests/lib/pattern-match.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit (with Task 4)**

Commit together with Task 4 (loader needs the seed file to pass).

---

### Task 4: Seed patterns.json + scoring-agent SKILL.md

**Files:**
- Create: `.codex/skills/scoring-agent/patterns.json`
- Create: `.codex/skills/scoring-agent/SKILL.md`

- [ ] **Step 1: Create `.codex/skills/scoring-agent/patterns.json`**

```json
[
  {
    "id": "nav-tab",
    "match": { "structuralKeyIncludes": "nav>", "hasHref": true },
    "signalWeights": { "href": 1.5, "structuralKey": 0.5 },
    "note": "Tab/nav links: the URL path is the decisive, stable signal; the DOM-path structuralKey is brittle across skins/renders."
  },
  {
    "id": "form-input",
    "match": { "roleIn": ["textbox", "combobox", "spinbutton"] },
    "signalWeights": { "name": 1.5, "neighborTexts": 1.5, "cleanId": 1.5 },
    "note": "Form fields: label/accessible-name and neighbor (label) text dominate identity."
  },
  {
    "id": "content-link",
    "match": { "roleIn": ["link"], "hasHref": true },
    "signalWeights": { "href": 1.5, "neighborTexts": 1.5 },
    "note": "Body links: URL plus surrounding text disambiguate same-named links."
  }
]
```

- [ ] **Step 2: Create `.codex/skills/scoring-agent/SKILL.md`**

```markdown
---
name: scoring-agent
description: Reason over an agent-blind ambiguous-element fingerprint to produce a per-element disambiguation (signal weightOverrides) and an optional generalizable pattern. Internal sub-agent — no external LLM. Sets resolver weighting criteria at setup time; the runtime applies them deterministically.
---

# Scoring Agent Skill

## Role

You are the **scoring sub-agent**, invoked by the browser-flow orchestrator at
*setup* time (after capture/analyze) for a captured element whose locator the
deterministic scorer cannot confidently resolve on its own page (low coverage:
the stable signals do not corroborate, even though some non-stable signal — often
href or relXPath — clearly identifies it). Your job: decide **which signals are
decisive and stable for THIS element's type**, and express that as a set of
`weightOverrides`.

**You ARE the model step.** There is no runtime LLM and no external API. The
deterministic runtime never calls a model — your judgment is captured once, as
weights, and the runner applies them mechanically. Do **not** shell out to
`claude -p`, `codex`, or any external LLM/API (forbidden; no key). You are
dispatched in-system via the Task/Agent tool — same pattern as `heal-agent` /
`variable-agent`.

## Input (agent-blind)

Path: `artifacts/runs/<runId>/scoring-request.json`. No real text or URL VALUES —
only signal *types*, presence, and structural shape:

```json
{
  "stepIndex": <number>,
  "intent": "<what this step is FOR>",
  "element": { "role": "...", "structuralKey": "<shape>", "relXPath": "...",
               "hasHref": true, "type": "...", "neighborCount": <n> },
  "siblings": [ { "role": "...", "structuralKey": "<shape>", "hasHref": true } ],
  "patterns": [ /* current patterns.json */ ]
}
```

## Reasoning contract

1. Infer the element's TYPE from role + structuralKey shape + hasHref (e.g. a
   `link` whose structuralKey contains `nav>` is a nav tab; a `textbox` is a form
   field).
2. Decide which signals are decisive AND stable for that type, and which are
   brittle. Express as `weightOverrides` over the known signals
   (name, structuralKey, neighborTexts, cleanId, role, type, alt, href, relXPath, box).
   Stable/decisive → 1.5; brittle → 0.5; leave others unset.
   - The mass (confidence) gate counts signals at weight ≥ 1.5, so promoting the
     decisive signal to 1.5 is what lets the resolver act confidently.
3. If this judgment generalizes to an element TYPE (not a one-off), also emit a
   `generalizable` pattern so the deterministic matcher handles siblings next time
   without a model.

## Output — `scoring-result.json`

Path: `artifacts/runs/<runId>/scoring-result.json`.

```json
{
  "stepIndex": <number>,
  "disambiguation": { "weightOverrides": { "href": 1.5, "structuralKey": 0.5 }, "note": "<why>" },
  "generalizable": { "id": "<type>", "match": { "structuralKeyIncludes": "nav>", "hasHref": true },
                     "signalWeights": { "href": 1.5, "structuralKey": 0.5 } }
}
```

- `disambiguation` is required and is written onto the step's locator by the
  deterministic apply step. `generalizable` is OPTIONAL — include it only when the
  rule applies to a type, and only with a `match` predicate over structural fields
  (no real values). It is appended to `patterns.json` if not a duplicate.

## Constraints (bounded — no loops)

- One dispatch → one `scoring-result.json`. No retry loop.
- `weightOverrides` keys MUST be known signal names; values are clamped to [0,3] by
  the deterministic apply step. Unknown keys are dropped.
- Agent-blind: never request, infer from, or emit real text/URL values — only
  signal types, presence, and structural shapes.
- Conservative: if no signal is clearly decisive, return weightOverrides that keep
  the element sub-threshold (the resolver then fail-safes / drift-holds — a missed
  resolve is correctable; a wrong confident click is not).

## Distinction from heal-agent / variable-agent

| Aspect | variable-agent | heal-agent | scoring-agent |
|--------|----------------|------------|---------------|
| Trigger | after analyze (new path) | after verify drift-hold (drift) | after analyze (ambiguous element) |
| Decides | input identity | re-map a drifted locator | which signals are decisive for a type |
| Output | drives `bf vars` | `heal-result.json` | `scoring-result.json` (weightOverrides) |
| Persists | — | self-heal cache | patterns.json (generalizable) |
```

- [ ] **Step 3: Run Task 3's test (now the seed exists)**

Run: `node --test --import=./tests/_setup.mjs tests/lib/pattern-match.test.mjs`
Expected: PASS (loadPatterns finds the seed; applyPatterns yields nav-tab overrides).

- [ ] **Step 4: Validate skill registry still passes**

Run: `npm run validate-skill`
Expected: `browser-flow skill validated` (the new scoring-agent skill must not break validation; if validate-skill enumerates `.codex/skills/*`, confirm the SKILL.md frontmatter `name`/`description` is present — it is).

- [ ] **Step 5: Commit (Tasks 3 + 4 together)**

```bash
git add scripts/lib/pattern-match.mjs tests/lib/pattern-match.test.mjs .codex/skills/scoring-agent/patterns.json .codex/skills/scoring-agent/SKILL.md
git commit -m "phase 92: scoring-agent seed patterns.json + SKILL.md (internal sub-agent contract) + loadPatterns/applyPatterns (model>pattern precedence)"
```

---

### Task 5: Schema — disambiguation field on LocatorShape

**Files:**
- Modify: `scripts/lib/schemas.mjs` (LocatorShape, ~line 74)
- Test: `tests/lib/schemas.test.mjs` (create if absent, else augment)

LocatorShape is `.passthrough()` so unknown keys already survive, but make `disambiguation` explicit + typed so it is a documented contract and validated.

- [ ] **Step 1: Write the failing test**

Create/append `tests/lib/schemas.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowSchema } from "../../scripts/lib/schemas.mjs";

test("LocatorShape accepts disambiguation.weightOverrides + note", () => {
  const wf = {
    schemaVersion: 6, id: "x", fixture: "manual", startUrl: "http://x/", finalUrl: "http://x/y",
    steps: [{ action: "click", locator: { role: "link", href: "/y",
      disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5 }, note: "nav tab", patternId: "nav-tab" } } }],
    verification: {}
  };
  const r = WorkflowSchema.safeParse(wf);
  assert.ok(r.success, `must parse: ${r.success ? "" : JSON.stringify(r.error.issues)}`);
});
```

(Use the actual exported workflow schema name and the current `schemaVersion` constant — check `scripts/lib/schema-versions.mjs` and the export in `schemas.mjs`; adjust the import/version if the export is named differently.)

- [ ] **Step 2: Run to verify it fails (or passes via passthrough)**

Run: `node --test --import=./tests/_setup.mjs tests/lib/schemas.test.mjs`
Expected: likely PASS already (passthrough). If PASS, still add the explicit field in Step 3 for documentation/validation; if FAIL, Step 3 fixes it.

- [ ] **Step 3: Implement**

In `scripts/lib/schemas.mjs`, inside `LocatorShape` (after line 74 `alt: ...`), add:
```js
    // Phase 92: per-element weight tuning. Deterministic pattern (pattern-match.mjs)
    // or the scoring-agent writes this; resolveLocator merges weightOverrides over
    // DEFAULT_WEIGHTS. Agent-blind: signal names + numeric weights only, no values.
    disambiguation: z.object({
      weightOverrides: z.record(z.string(), z.number()).optional(),
      patternId: z.string().optional(),
      decisiveSignals: z.array(z.string()).optional(),
      note: z.string().optional()
    }).passthrough().optional()
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test --import=./tests/_setup.mjs tests/lib/schemas.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/schemas.mjs tests/lib/schemas.test.mjs
git commit -m "phase 92: LocatorShape.disambiguation explicit (weightOverrides/patternId/note, additive-optional)"
```

---

### Task 6: Wire applyPatterns into compile

**Files:**
- Modify: `scripts/analyze/compile.mjs` (import + a pass after `segments`, ~line 280)
- Test: `tests/analyze/compile-patterns.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/analyze/compile-patterns.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { applyPatternsToSteps } from "../../scripts/analyze/compile.mjs";
import { loadPatterns } from "../../scripts/lib/pattern-match.mjs";

test("applyPatternsToSteps: nav-tab step.locator gets weightOverrides; non-matching untouched", () => {
  const steps = [
    { action: "goto" },
    { action: "click", locator: { role: "link", structuralKey: "nav>ul>li|a|||Talk", href: "/navtab/talk" } },
    { action: "click", locator: { role: "button" } },
    { action: "click" } // no locator
  ];
  applyPatternsToSteps(steps, loadPatterns());
  assert.deepEqual(steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 });
  assert.equal(steps[2].locator.disambiguation, undefined);
  assert.equal(steps[3].locator, undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --import=./tests/_setup.mjs tests/analyze/compile-patterns.test.mjs`
Expected: FAIL — `applyPatternsToSteps` not exported.

- [ ] **Step 3: Implement**

In `scripts/analyze/compile.mjs`:

Add import near the other lib imports (top of file, by `import { segmentByPageNode }`):
```js
import { loadPatterns, applyPatterns } from "../lib/pattern-match.mjs";
```

Add an exported helper (place near the bottom with other helpers, or above the main export):
```js
/**
 * Phase 92: deterministically tag each step.locator with element-type weightOverrides
 * (disambiguation) so replay weights the decisive signal. Mutates steps in place.
 * Skips steps without a locator and locators that already carry a disambiguation
 * (model output / prior pass wins). Pure w.r.t. the page — no live browser.
 * @param {Array<Record<string,unknown>>} steps
 * @param {Array<any>} patterns
 */
export function applyPatternsToSteps(steps, patterns) {
  for (const s of steps || []) {
    if (s && s.locator && typeof s.locator === "object") {
      const tagged = applyPatterns(/** @type {Record<string,unknown>} */ (s.locator), patterns);
      if (tagged.disambiguation) s.locator = tagged;
    }
  }
}
```

Call it after `const segments = segmentByPageNode({ steps });` (line 280):
```js
  // Phase 92: tag each step.locator with element-type weightOverrides (deterministic,
  // agent-blind). Runtime stays LLM-free; resolveLocator merges these at replay.
  applyPatternsToSteps(steps, loadPatterns());
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test --import=./tests/_setup.mjs tests/analyze/compile-patterns.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/analyze/compile.mjs tests/analyze/compile-patterns.test.mjs
git commit -m "phase 92: compile tags step.locator with deterministic pattern weightOverrides (analyze-time, runtime LLM-free)"
```

---

### Task 7: e2e — navtab fixture: drift-hold without pattern → HIGH with pattern

**Files:**
- Modify: `scripts/fixtures/site-server.mjs` (add `navtab` routes)
- Test: `tests/e2e/verify-navtab-weightoverride.test.mjs`

Reproduces the wiki nav-tab class deterministically: identical name + a stale structuralKey (sim 0 at replay) + a decisive href. Default weights → mass 0.5 → drift-hold (no misclick). nav-tab weightOverride → mass 1.0 → HIGH → completes.

- [ ] **Step 1: Add the fixture routes**

In `scripts/fixtures/site-server.mjs`, follow the existing route pattern (as `samename` does). Add a `navtab` index page and three target pages:

```js
// Phase 92: nav-tab fixture — three same-named tab links distinguished only by href.
// The captured locator (in the test) carries a STALE structuralKey, reproducing real
// nav tabs whose DOM-path key drifts while the href stays decisive.
if (pathname === "/navtab") {
  return html(res, `<!doctype html><meta charset=utf8><title>navtab</title>
    <nav><a href="/navtab/home">Section</a> <a href="/navtab/talk">Section</a> <a href="/navtab/history">Section</a></nav>
    <main>navtab index</main>`);
}
if (pathname === "/navtab/talk") {
  return html(res, `<!doctype html><meta charset=utf8><title>navtab talk</title><main data-bf="navtab-talk">talk page</main>`);
}
if (pathname === "/navtab/home")    { return html(res, `<!doctype html><meta charset=utf8><title>navtab home</title><main>home</main>`); }
if (pathname === "/navtab/history") { return html(res, `<!doctype html><meta charset=utf8><title>navtab history</title><main>history</main>`); }
```

(Match the file's actual response helper — it may be `sendHtml(res, ...)` or similar; use whatever the neighboring `samename` routes use.)

- [ ] **Step 2: Write the failing test**

Create `tests/e2e/verify-navtab-weightoverride.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs, getRunPaths } from "../../scripts/lib/config.mjs";
import { writeJson } from "../../scripts/lib/fs.mjs";
import { generateRunner } from "../../scripts/generate/generate-runner.mjs";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";
import { verifyRun } from "../../scripts/verify/verify-run.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

function wf(runId, baseUrl, withOverride) {
  // STALE structuralKey contains "nav>" (so the nav-tab pattern matches) but won't
  // equal the live element's computed key (so structuralKey sim = 0).
  const locator = {
    role: "link", name: "Section", structuralKey: "nav>STALE-WRAPPER|a|||Section",
    href: "/navtab/talk", relXPath: "//nav/a[2]"
  };
  if (withOverride) locator.disambiguation = { weightOverrides: { href: 1.5, structuralKey: 0.5 }, patternId: "nav-tab" };
  return {
    schemaVersion: SCHEMA_VERSIONS.workflow, id: runId, fixture: "manual",
    startUrl: `${baseUrl}/navtab`, finalUrl: `${baseUrl}/navtab/talk`,
    steps: [
      { action: "goto" },
      { action: "click", selector: "nav a", text: "Section", href: "/navtab/talk", expectUrl: `${baseUrl}/navtab/talk`, locator }
    ],
    segments: [{ range: [0, 1], startPageKey: "navtab", endPageKey: "navtab/talk", name: "open-talk" }],
    verification: { expectedNetwork: null, expectedEvidence: null, expectedFinalUrl: "/navtab/talk", transitionTimeoutMs: 8000 },
    security: { localOnly: true, sanitizedArtifactsOnly: true, screenshotsPersisted: false }
  };
}

test("verify-navtab: default weights drift-hold (mass<0.55), nav-tab weightOverride completes", { timeout: 120000 }, async () => {
  const server = await startFixtureServer();
  try {
    // (a) WITHOUT override -> drift-hold (no wrong click).
    const idA = `navtab-default-${Date.now()}`;
    const pA = ensureRunDirs(idA);
    writeJson(pA.workflowJsonPath, wf(idA, server.baseUrl, false));
    generateRunner(idA);
    const held = /** @type {any} */ ((await verifyRun(idA, { headless: true })).report);
    assert.equal(held.pathComplete, true ? held.pathComplete : held.pathComplete, ""); // placeholder removed below
    assert.ok(held.heldAtSegment === 0, `default must drift-hold at segment 0 — report: ${JSON.stringify(held)}`);

    // (b) WITH nav-tab override -> HIGH -> completes to /navtab/talk.
    const idB = `navtab-override-${Date.now()}`;
    const pB = ensureRunDirs(idB);
    writeJson(pB.workflowJsonPath, wf(idB, server.baseUrl, true));
    generateRunner(idB);
    const ok = /** @type {any} */ ((await verifyRun(idB, { headless: true })).report);
    assert.equal(ok.pathComplete, true, `override must complete the path — report: ${JSON.stringify(ok)}`);
    assert.ok((ok.executedSteps || []).includes("click"), `the nav-tab click must execute — ${JSON.stringify(ok.executedSteps)}`);
  } finally {
    await server.close();
  }
});
```

(Remove the placeholder assertion line; assert only `heldAtSegment === 0` for case (a). Confirm the `verifyRun` return shape — match `verify-heal-loop.test.mjs`, which uses `(await verifyRun(...)).report`.)

- [ ] **Step 3: Run to verify it fails**

Run: `pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion; node --test --import=./tests/_setup.mjs tests/e2e/verify-navtab-weightoverride.test.mjs`
Expected: FAIL initially if the fixture route isn't reachable or assertions mismatch. Iterate on the fixture/route helper until case (a) drift-holds and case (b) completes.

- [ ] **Step 4: Run to verify pass**

Run: same command.
Expected: PASS — proves the weightOverride mechanism end-to-end on the real resolver: default mass sub-threshold → safe drift-hold; nav-tab override → confident completion.

- [ ] **Step 5: Commit**

```bash
git add scripts/fixtures/site-server.mjs tests/e2e/verify-navtab-weightoverride.test.mjs
git commit -m "phase 92: e2e navtab — default weights fail-safe (drift-hold, no misclick), nav-tab weightOverride completes (mass unification proven on real resolver)"
```

---

### Task 8: Synthetic scoring-agent application test + real-dispatch demo

**Files:**
- Create: `scripts/demos/scoring-agent-demo.mjs`
- Test: `tests/analyze/scoring-result-apply.test.mjs`

Mirror the heal-loop pattern: a hand-written `scoring-result.json` (standing in for the model, like heal-loop's synthetic heal-result) is applied deterministically and proven to complete; the REAL internal sub-agent dispatch is a separate orchestrator demo (non-CI), like the gap1 heal demo.

- [ ] **Step 1: Write the failing test (synthetic scoring-result apply)**

Create `tests/analyze/scoring-result-apply.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { applyScoringResult } from "../../scripts/analyze/compile.mjs";

test("applyScoringResult: writes disambiguation onto the target step.locator; clamps unknown/oob", () => {
  const steps = [
    { action: "goto" },
    { action: "click", locator: { role: "link", structuralKey: "x>y|a|||Z", href: "/z" } }
  ];
  const result = {
    stepIndex: 1,
    disambiguation: { weightOverrides: { href: 1.5, structuralKey: 0.5, bogusSignal: 9, name: 99 }, note: "synthetic" }
  };
  applyScoringResult(steps, result);
  assert.deepEqual(steps[1].locator.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5, name: 3 },
    "unknown key dropped, name clamped to 3");
  assert.equal(steps[1].locator.disambiguation.note, "synthetic");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --import=./tests/_setup.mjs tests/analyze/scoring-result-apply.test.mjs`
Expected: FAIL — `applyScoringResult` not exported.

- [ ] **Step 3: Implement**

In `scripts/analyze/compile.mjs`, add (reuse the matcher's clamp by importing it; add `sanitizeWeights` to pattern-match.mjs exports if not already, OR inline a small clamp here). Simplest — export `sanitizeWeights` from `pattern-match.mjs`:

In `scripts/lib/pattern-match.mjs`, change `function sanitizeWeights` to `export function sanitizeWeights`.

Then in `scripts/analyze/compile.mjs` add import `sanitizeWeights` and:
```js
/**
 * Phase 92: apply a scoring-agent (or synthetic) result onto the target step.locator.
 * weightOverrides are whitelisted + clamped. The model decides criteria; this stays
 * deterministic. @param {Array<Record<string,any>>} steps @param {Record<string,any>} result
 */
export function applyScoringResult(steps, result) {
  const i = result && result.stepIndex;
  const step = Array.isArray(steps) ? steps[i] : undefined;
  if (!step || !step.locator || !result.disambiguation) return;
  step.locator.disambiguation = {
    weightOverrides: sanitizeWeights(result.disambiguation.weightOverrides || {}),
    ...(result.disambiguation.note ? { note: result.disambiguation.note } : {})
  };
}
```

Update the import line in compile.mjs:
```js
import { loadPatterns, applyPatterns, sanitizeWeights } from "../lib/pattern-match.mjs";
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test --import=./tests/_setup.mjs tests/analyze/scoring-result-apply.test.mjs`
Expected: PASS.

- [ ] **Step 5: Create the real-dispatch demo (non-CI)**

Create `scripts/demos/scoring-agent-demo.mjs` — a documented script that (a) builds a `scoring-request.json` (agent-blind) for a novel ambiguous element, (b) is dispatched to the real `scoring-agent` sub-agent by the orchestrator (Task tool), (c) applies the resulting `scoring-result.json` via `applyScoringResult`, (d) re-runs verify to show completion. The script prints the request path + expected flow; the actual sub-agent dispatch is performed by the orchestrator (like the gap1 heal demo). Include a top comment: "NON-CI demo — proves the real internal sub-agent path end-to-end."

```js
// @ts-check
// NON-CI demo: real internal scoring-agent sub-agent path.
// Usage (orchestrator): node scripts/demos/scoring-agent-demo.mjs --run-id <id>
// 1) writes artifacts/runs/<id>/scoring-request.json (agent-blind element fingerprint)
// 2) orchestrator dispatches `.codex/skills/scoring-agent` (Task tool) -> scoring-result.json
// 3) applyScoringResult(steps, result) -> regenerate -> verify completes
// This stands to scoring-agent as gap1-healagent-demo stands to heal-agent.
import { getRunPaths } from "../lib/config.mjs";
import { writeJson } from "../lib/fs.mjs";
// ... build + write scoring-request.json from a captured ambiguous step; print next steps.
```

(Flesh out the request-building from a captured workflow's ambiguous step. Keep it agent-blind: role/structuralKey shape/hasHref/neighborCount only.)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pattern-match.mjs scripts/analyze/compile.mjs scripts/demos/scoring-agent-demo.mjs tests/analyze/scoring-result-apply.test.mjs
git commit -m "phase 92: synthetic scoring-result apply (whitelist+clamp) + real scoring-agent dispatch demo (non-CI, gap1 style)"
```

---

### Task 9: Governance — eval audit + phase doc + state bump + full check

**Files:**
- Modify: `.governance/state.json` (`last_eval_audit_phase` 82→92)
- Create: `tasks/phases/phase-92-scoring-agent.md`
- Append: `tasks/lessons.md`

Phase 92 hits the eval-audit hard gate (last_eval_audit_phase=82, delta 10).

- [ ] **Step 1: Run the eval audit (harness hill-climbing self-check)**

Answer in the phase doc: does Phase 92 raise real *capability* (resolver completes element classes it could not, e.g. nav tabs) or just add infra/skills? Evidence: the navtab e2e (case (a) drift-hold → case (b) completes) + the wiki-tab calc (mass 0.31 default → ≥0.55 with nav-tab pattern). Note any infra-only weight (e.g. patterns.json maintenance cost) and the guardrail (agent-blind, clamp, fail-safe preserved).

- [ ] **Step 2: Write `tasks/phases/phase-92-scoring-agent.md`**

Include: user-quotes (no paraphrase), the P4-derived motivation (mass-gate did not receive weightOverride), the 80/20 mechanism, the mass-unification decision (effective weight ≥ STABLE_TIER, default-preserving), seed patterns + scoring-agent contract, the navtab proof, the eval-audit answer, file table, and the governance bump. Follow the `phase-91-deterministic-scorer.md` structure.

- [ ] **Step 3: Bump governance state**

In `.governance/state.json` set `"last_eval_audit_phase": 92`. (`last_constraint_review_phase` stays 91; next constraint review @96.)

- [ ] **Step 4: Append a lesson**

Append to `tasks/lessons.md` (execution-learning): the mass gate must follow the same knob as scoring — a per-element weightOverride that doesn't reach the confidence gate is inert; unify mass membership with effective weight so the model's per-type judgment drives BOTH score and confidence.

- [ ] **Step 5: Full check GREEN**

Run: `pkill -9 -f "Google Chrome.*remote-debugging"; rm -f profiles/notebooklm/Singleton* profiles/notebooklm/RunningChromeVersion; npm run check`
Expected: lint + typecheck + validate-skill + tests all PASS, 0 fail / 0 skipped.

- [ ] **Step 6: Commit**

```bash
git add .governance/state.json tasks/phases/phase-92-scoring-agent.md tasks/lessons.md
git commit -m "phase 92: eval-audit gate (state 82->92) + phase doc + lesson — scoring-agent/pattern-set per-element weightOverride (P3 complete)"
```

---

## Self-Review

**1. Spec coverage:**
- mass unification → Task 1 ✓
- pure matcher (roleIn/structuralKeyIncludes/hasHref/typeIn, agent-blind) → Task 2 ✓
- loader + applyPatterns (model > pattern) → Task 3 ✓
- seed patterns.json + scoring-agent SKILL.md → Task 4 ✓
- schema disambiguation → Task 5 ✓
- compile wiring → Task 6 ✓
- e2e fixture (HIGH with pattern / fail-safe without) → Task 7 ✓
- synthetic apply + real demo → Task 8 ✓
- eval-audit governance (82→92) + phase doc → Task 9 ✓
- agent-blind / clamp / fail-safe-preserved → Tasks 2,5,8 ✓
- real-site wiki completion = manual P4-resume (out of scope) → noted, not a task ✓

**2. Placeholder scan:** Task 7 Step 2 contains a noted placeholder assertion to remove — flagged inline. Task 8 Step 5 demo script is intentionally a skeleton (non-CI, fleshed out by implementer) — flagged. No "TBD/handle edge cases" elsewhere.

**3. Type consistency:** `loadPatterns`/`applyPatterns`/`matchPattern`/`evalMatch`/`sanitizeWeights` (pattern-match.mjs); `applyPatternsToSteps`/`applyScoringResult` (compile.mjs); `STABLE_TIER` (resolver-score.mjs); `disambiguation.weightOverrides`/`patternId`/`note` consistent across schema, matcher, compile, resolver, tests. `weightOverrides` is `Record<string,number>` everywhere. Resolver already reads `loc.disambiguation.weightOverrides` (locator-resolver.mjs:144) — name matches.

**Notes for the implementer:**
- Confirm `verifyRun` return shape against `verify-heal-loop.test.mjs` (`.report`, `heldAtSegment`, `pathComplete`, `executedSteps`).
- Confirm the fixture response helper name in `site-server.mjs` (match the `samename` routes).
- Confirm the workflow schema export name + current `schemaVersion` in Task 5.
- Keep every new text/structural signal agent-blind; never read/emit real values in patterns or scoring I/O.
