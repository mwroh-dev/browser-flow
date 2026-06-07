# Phase 91 (Scored Resolver P2) — Deterministic Coverage-Aware Scorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Single test files: `node --test --import=./tests/_setup.mjs <file>`. Real-Chrome e2e: hard timeout + `pkill -9 -f "Google Chrome.*remote-debugging"` + `rm -f profiles/*/Singleton* profiles/*/RunningChromeVersion`. In-page strings in `locator-capture.mjs`: NO backtick/`${`. Test helper/arrow params need JSDoc types (strict checkJs).

**Goal:** Replace `resolveLocator`'s ordered first-match rungs ("find-first") with a **Similo-style coverage-aware weighted-similarity scorer** ("score-best"): score live candidates over the captured signals (P1), pick the best ONLY when confident (high-weight mass + margin + absolute floor), else **throw → drift-hold (fail-safe)** instead of clicking the wrong element.

**Architecture:** Pure `signal-similarity.mjs` (per-signal similarity fns) + pure `resolver-score.mjs` (`scoreCandidates` + `decideConfidence`). In-page `__bfElementSignals`/`__bfCollectCandidates` compute the full signal set per live candidate (reusing P1 helpers). `resolveLocator` becomes: collect candidates → score vs `step.locator` → decideConfidence → HIGH: resolve winner→backendNodeId; LOW: throw `ambiguous`. Contract `{backendNodeId, layerUsed, confidence}` preserved (consumers: runner resolveNodeId + cleanup path, explorer, tests). Default weights = Similo-seeded; per-element overrides come in P3.

**Tech Stack:** Node ESM `.mjs`, `node --test`, TS strict checkJs. No new deps, no LLM. Keep `npm run check` GREEN.

**Spec:** `docs/superpowers/specs/2026-05-21-scored-resolver-design.md` §3(b), §2.3.

---

## Decisions locked (from spec + P1)
1. **Weights (Similo-seeded default; per-element override = P3):** name 1.5, structuralKey 1.5, neighborTexts 1.5, cleanId 1.5 (only when non-empty), role 1.0, type 1.0, alt 1.0, href 1.0, relXPath 0.5, box 0.5. (STABLE tier = name/structuralKey/neighborTexts/cleanId; rest = weaker.)
2. **Per-signal similarity:** equality(1/0): structuralKey, cleanId, type, role. normLevenshtein(1−dist/maxLen): name, href(decoded), alt, relXPath. wordSetJaccard: neighborTexts. numericSim(viewport-normalized): box.
3. **Score** = Σ(weight×sim for signals PRESENT in target) / Σ(weight for present). ∈[0,1]. (Missing target signals don't penalize.)
4. **Confidence (coverage-aware, the user top-p point):** winner=argmax; margin=winner−runnerUp; highWeightMass = Σ(weight×sim for STABLE signals present)/Σ(weight stable present). HIGH iff `winner ≥ absFloor AND margin ≥ marginMin AND highWeightMass ≥ massMin`; else LOW → throw `ambiguous`. (absFloor/marginMin/massMin calibrated in 91.5; start 0.6/0.12/0.55.)
5. **Remove the blind selector first-match fallback** (it grabbed wrong elements). LOW confidence → drift-hold, never guess.
6. **Preserve resolveLocator contract** `{backendNodeId, layerUsed, confidence}` + throw-on-fail (→ existing runner drift-hold flow). All existing real-Chrome e2e must stay GREEN (scorer must resolve unambiguous fixtures confidently).

## File Structure
- `scripts/lib/signal-similarity.mjs` (new) — pure similarity fns.
- `scripts/lib/resolver-score.mjs` (new) — `scoreCandidates`, `decideConfidence`.
- `scripts/observe/locator-capture.mjs` — in-page `__bfElementSignals`, `__bfCollectCandidates`.
- `scripts/cdp/locator-resolver.mjs` — `resolveLocator` rewritten on the scorer.
- Tests: `tests/lib/signal-similarity.test.mjs`, `tests/lib/resolver-score.test.mjs`, `tests/cdp/resolve-locator.test.mjs` (update), `tests/e2e/verify-scored-resolve.test.mjs` (new same-name fixture), `tasks/phases/phase-91-deterministic-scorer.md`.
- `scripts/fixtures/site-server.mjs` — `samename` fixture (two same-name elements differing by neighbor/href).
- `.governance/state.json` — bump constraint review → 91.

---

## Task 91.1: signal-similarity (pure)
**Files:** `scripts/lib/signal-similarity.mjs`; Test `tests/lib/signal-similarity.test.mjs`
- [ ] **Failing test:**
```js
import { equalitySim, normLevenshtein, wordSetJaccard, numericSim } from "../../scripts/lib/signal-similarity.mjs";
test("equalitySim", () => { assert.equal(equalitySim("a","a"),1); assert.equal(equalitySim("a","b"),0); assert.equal(equalitySim("",""),1); });
test("normLevenshtein", () => { assert.equal(normLevenshtein("kitten","kitten"),1); assert.ok(normLevenshtein("kitten","sitting")>0.5 && normLevenshtein("kitten","sitting")<1); assert.equal(normLevenshtein("",""),1); assert.equal(normLevenshtein("abc",""),0); });
test("wordSetJaccard", () => { assert.equal(wordSetJaccard(["a b","c"],["a","c"]),  2/3 ); assert.equal(wordSetJaccard([],[]),1); assert.equal(wordSetJaccard(["x"],["y"]),0); });
test("numericSim viewport-normalized", () => { assert.equal(numericSim({cx:10,cy:10},{cx:10,cy:10},{w:100,h:100}),1); assert.ok(numericSim({cx:0,cy:0},{cx:100,cy:100},{w:100,h:100})<0.1); });
```
- [ ] **Implement** (pure, no deps): `equalitySim(a,b)` (1 if `String(a)===String(b)` else 0); `normLevenshtein(a,b)` (1 − editDistance/max(len), both empty→1); `wordSetJaccard(arrA,arrB)` (split each array's strings into a word Set, |∩|/|∪|, both empty→1); `numericSim(p,q,viewport)` (1 − euclidean((cx,cy) diff)/diag(viewport), clamp [0,1]). Small internal Levenshtein.
- [ ] Run → pass. `npm run check` GREEN. Commit `phase 91: signal-similarity pure fns`.

## Task 91.2: resolver-score (pure, coverage-aware)
**Files:** `scripts/lib/resolver-score.mjs`; Test `tests/lib/resolver-score.test.mjs`
- [ ] **Failing test** — same-name disambig + tie→low-confidence:
```js
import { scoreCandidates, decideConfidence, DEFAULT_WEIGHTS } from "../../scripts/lib/resolver-score.mjs";
const target = { role:"link", name:"지리", structuralKey:"k-anchor", href:"/#지리", neighborTexts:["대한민국 개요"], cleanId:"", type:"", alt:"", relXPath:"//a[1]", box:{cx:10,cy:10}, viewport:{w:1000,h:800} };
const candAnchor = { ...target };                       // the real one
const candArticle = { role:"link", name:"지리", structuralKey:"k-article", href:"/wiki/지리", neighborTexts:["지리학 문서"], cleanId:"", type:"", alt:"", relXPath:"//a[9]", box:{cx:400,cy:600} };
test("score-best picks the right same-name candidate via href+neighbor", () => {
  const scored = scoreCandidates(target, [candArticle, candAnchor], DEFAULT_WEIGHTS, target.viewport);
  const d = decideConfidence(scored);
  assert.equal(d.confidence, "high");
  assert.equal(scored[d.pick].cand.structuralKey, "k-anchor");
});
test("tie → low confidence (fail-safe), no pick", () => {
  const a = { role:"link", name:"X", structuralKey:"" , neighborTexts:[], href:"" };
  const scored = scoreCandidates({ role:"link", name:"X" }, [a, {...a}], DEFAULT_WEIGHTS, {w:1000,h:800});
  const d = decideConfidence(scored);
  assert.equal(d.confidence, "low");
});
```
- [ ] **Implement:**
  - `DEFAULT_WEIGHTS` (the §1 map) + a STABLE-signal set.
  - `scoreCandidates(target, candidates, weights, viewport)` → `[{cand, score, perSignal:{...}}]`: for each candidate, for each signal PRESENT in target (non-empty), compute sim (per §2 mapping) × weight; score = Σ/Σweight. Return with per-signal contributions.
  - `decideConfidence(scored, opts?)` → `{pick: idx, confidence: "high"|"low", reason, winner, margin, highWeightMass}`: sort desc; winner/runnerUp; margin; highWeightMass = Σ(weight×sim of STABLE present)/Σ(stable weight present) for the winner; HIGH iff winner.score≥absFloor && margin≥marginMin && highWeightMass≥massMin (defaults 0.6/0.12/0.55, overridable via opts). Pure.
- [ ] Run → pass. `npm run check` GREEN. Commit `phase 91: resolver-score (scoreCandidates + coverage-aware decideConfidence)`.

## Task 91.3: in-page candidate signal collection
**Files:** `scripts/observe/locator-capture.mjs`
- [ ] Add to `locatorCaptureSource` (NO backtick/`${`): `__bfElementSignals(el)` returning the SAME shape as a captured locator — `{role(getAttribute role||__bfImplicitRole), name(__bfComputedName), structuralKey(__bfBuildStructuralKey(__bfDescriptorFromElement)), relXPath(__bfBuildRelXPath(__bfChainFromElement)), href(getAttribute href||""), neighborTexts(__bfNeighborTexts), cleanId(id&&!__bfIsDynamicId?id:""), type(getAttribute type||""), alt(getAttribute alt||""), box{cx,cy,w,h}(getBoundingClientRect)}` — reuse the existing helpers. And `__bfCollectCandidates()` → `document.querySelectorAll("a,button,[role],[tabindex],input,textarea,select,summary,[contenteditable]")`, map each to `{i, signals: __bfElementSignals(el)}`, cap ~200, return array. (Order = querySelectorAll order, STABLE for a re-query.)
- [ ] Verify: `node -e "import('./scripts/observe/locator-capture.mjs').then(m=>{ const f=new Function(m.locatorCaptureSource+'; return __bfCollectCandidates;')(); console.log('SYNTAX OK', typeof f); })"` → SYNTAX OK. Existing locator-equivalence tests still pass. Commit `phase 91: in-page __bfElementSignals + __bfCollectCandidates`.

## Task 91.4: resolveLocator on the scorer
**Files:** `scripts/cdp/locator-resolver.mjs`; Test `tests/cdp/resolve-locator.test.mjs` (update)
- [ ] Rewrite `resolveLocator(session, targetId, step)`:
  1. If `!step.locator` → keep a minimal selector path? NO — for steps without a locator (legacy), fall back to the OLD `resolveAtomicFpLocator` (keep that function for back-compat). For steps WITH a locator → scorer path.
  2. Scorer path: `Runtime.evaluate(locatorCaptureSource + "; (function(){ return __bfCollectCandidates(); })()", returnByValue:true)` → candidates `[{i, signals}]`.
  3. `scored = scoreCandidates(step.locator, candidates.map(c=>c.signals), DEFAULT_WEIGHTS, step.locator.viewport)` (apply `step.locator.disambiguation.weightOverrides` if present — P3 will populate; read defensively). `d = decideConfidence(scored)`.
  4. HIGH → re-resolve the winner: `Runtime.evaluate("document.querySelectorAll(<same selector>)[" + winnerIndex + "]", returnByValue:false)` → objectId → `DOM.describeNode` → backendNodeId. Return `{backendNodeId, layerUsed:"score", confidence:"high"}`.
  5. LOW → `throw new Error("ambiguous locator: low-confidence resolution (" + d.reason + ")")` → runner drift-hold.
  - Keep `resolveAtomicFpLocator` exported (legacy/no-locator path + back-compat). Identifiers fine (Node module, not embedded).
- [ ] Update `tests/cdp/resolve-locator.test.mjs`: the existing real-Chrome resolve tests must pass on the scorer (unambiguous fixture elements → high confidence + correct node). Add: an ambiguous case → throws (low confidence). (If the existing test asserts a specific `layerUsed` like "role+name", update to "score".)
- [ ] Run resolve-locator.test → pass. `npm run check` GREEN. Commit `phase 91: resolveLocator rewritten on coverage-aware scorer (find-first → score-best, fail-safe)`.

## Task 91.5: same-name fixture e2e + regression + calibration
**Files:** `scripts/fixtures/site-server.mjs` (`samename` fixture), `tests/e2e/verify-scored-resolve.test.mjs`; `tests/helpers/demo-driver.mjs` (samename case)
- [ ] `samename` fixture page: two links both named "지리" — one a same-page anchor `<a data-bf="anchor" href="#geo">지리</a>` near text "대한민국 개요", one an article link `<a data-bf="article" href="/samename/geo">지리</a>` near text "지리학 문서"; + a `/samename/geo` dest. (Mirrors the real Wikipedia 지리 collision.)
- [ ] demo-driver `samename` case: click the ANCHOR one (`[data-bf="anchor"]`) — captures its locator (href `#geo`, neighbor "대한민국 개요").
- [ ] e2e: capture samename → generate → verify. The runner replays the click; the scorer must pick the ANCHOR (not the article link) via href+neighborTexts → resolves the right element → no drift-hold (or asserts the resolved element is the anchor). **The OLD find-first would have grabbed the wrong "지리".** Assert success / correct resolution. (+ a variant: tamper the locator so signals are weak/tied → assert drift-hold, fail-safe, no wrong click.)
- [ ] **Regression**: run the full real-Chrome e2e set (full-loop ×5, drift-hold, dangling-cleanup, heal-loop, breadth, active-exploration, signal-capture) — all must still resolve confidently under the scorer. If any unambiguous fixture step now drift-holds, calibrate absFloor/marginMin/massMin (91.2 opts) until green WITHOUT making the same-name test pass the wrong element. Record the final thresholds.
- [ ] `npm run check` GREEN. Commit `phase 91: same-name fixture e2e + scorer threshold calibration + regression`.

## Task 91.6: constraint review (gate) + doc
**Files:** `.governance/state.json`, `tasks/phases/phase-91-deterministic-scorer.md`
- [ ] **Constraint review (DUE @91: last @86, cadence 5).** Audit window 87→91 (read-only enrich, active-explore, validation, signal-capture, scorer). New invariant candidates: e.g. "resolver must fail-safe (never click below-confidence)" — 4-question test (always-hold? single boundary=resolveLocator? silent corruption if violated=yes wrong-click? implied by existing? — it's a NEW safety property: *don't act under uncertainty*). Evaluate; likely document as resolver-layer invariant (single boundary = resolveLocator's confidence gate) — decide register vs document. Bump `.governance/state.json` `last_constraint_review_phase` → 91.
- [ ] **Phase doc** `tasks/phases/phase-91-deterministic-scorer.md`: quote spec §3(b) + user "find-first→score-best"/"top-p" quotes (paraphrase 금지); document the scorer, weights, similarity, coverage-aware confidence, fail-safe (no blind fallback), same-name fixture proof, final calibrated thresholds, constraint review result. Note P3 adds the model/pattern-set weight overrides.
- [ ] `npm run validate-skill` + `npm run check` GREEN. Commit `phase 91: deterministic scorer doc + constraint review (gate)`.

---

## Self-Review
- **Spec §3(b) coverage:** scoreCandidates(91.2) ✓, decideConfidence coverage-aware(91.2) ✓, in-page candidate signals(91.3) ✓, resolveLocator replacement(91.4) ✓, fail-safe-no-blind-fallback(91.4/decision §5) ✓, same-name proof + calibration(91.5) ✓.
- **Placeholder scan:** 91.1/91.2 full code+tests. 91.3 reuses named in-page helpers. 91.4 the re-resolve-by-index + back-compat path is the judgment area (flagged). Thresholds explicitly calibrated in 91.5 (not placeholders).
- **Type consistency:** signal set `{role,name,structuralKey,relXPath,href,neighborTexts,cleanId,type,alt,box}` identical across __bfElementSignals(91.3) ↔ step.locator(P1) ↔ scoreCandidates(91.2). resolveLocator return `{backendNodeId,layerUsed,confidence}` preserved (consumers unaffected).
- **Regression risk (the big one):** replacing resolveLocator could break existing fixture e2e → 91.5 explicitly re-runs the full real-Chrome set + calibrates. Back-compat: no-locator steps keep `resolveAtomicFpLocator`.
- **No-LLM:** scorer is pure deterministic; weights are static defaults (P3 adds model overrides). ✓
- **Governance:** constraint review DUE @91 — included (91.6) + state bump. eval audit next @92 (P3).

## Execution Handoff
Subagent-driven. 91.1 (similarity) + 91.2 (scorer) → fresh subagents, pure TDD. 91.3 (in-page, String.raw discipline) careful. 91.4 (resolveLocator rewrite — preserve contract, back-compat, re-resolve-by-index) delicate. Controller runs 91.5 (real Chrome + calibration — the regression gate) + 91.6 constraint review. After P2: P3 (phase 92) = scoring-agent + pattern-set + per-element weight overrides (eval-audit gate); P4 = real-site (gap2) with score-best.
