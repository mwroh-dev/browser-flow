import test from "node:test";
import assert from "node:assert/strict";
import { matchPattern, evalMatch, loadPatterns, applyPatterns, sanitizeWeights } from "../../scripts/lib/pattern-match.mjs";

/** @type {Array<{id:string, match:Record<string,unknown>, signalWeights:Record<string,number>}>} */
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
  assert.equal(evalMatch({ role: "link" }, {}), false);
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

test("sanitizeWeights: drops unknown keys, clamps [0,3], rejects non-finite", () => {
  assert.deepEqual(sanitizeWeights({ href: -1, name: NaN, role: Infinity, type: 0.5, bogus: 2 }), { href: 0, type: 0.5 });
  assert.deepEqual(sanitizeWeights({ href: 9 }), { href: 3 });
  assert.deepEqual(sanitizeWeights({}), {});
  assert.deepEqual(sanitizeWeights(/** @type {any} */ (null)), {});
});

test("loadPatterns: returns an array (seed file) and never throws", () => {
  const ps = loadPatterns();
  assert.ok(Array.isArray(ps) && ps.length >= 1, "seed patterns.json must load as a non-empty array");
  for (const p of ps) { assert.ok(p.id && p.match && p.signalWeights, `each pattern needs id/match/signalWeights: ${JSON.stringify(p)}`); }
  assert.deepEqual(loadPatterns("/no/such/file.json"), []); // missing -> []
});

test("applyPatterns: sets disambiguation.weightOverrides on a match, leaves existing untouched", () => {
  const navTab = { role: "link", structuralKey: "nav>ul>li|a|||Talk", href: "/navtab/talk" };
  const out = /** @type {any} */ (applyPatterns(navTab, loadPatterns()));
  assert.deepEqual(out.disambiguation.weightOverrides, { href: 1.5, structuralKey: 0.5 });
  assert.equal(out.disambiguation.patternId, "nav-tab");

  const noMatch = /** @type {any} */ (applyPatterns({ role: "button" }, loadPatterns()));
  assert.equal(noMatch.disambiguation, undefined, "no match -> no disambiguation added");

  const preset = { role: "link", structuralKey: "nav>x", href: "/x", disambiguation: { weightOverrides: { name: 2 } } };
  const kept = /** @type {any} */ (applyPatterns(preset, loadPatterns()));
  assert.deepEqual(kept.disambiguation.weightOverrides, { name: 2 }, "existing disambiguation (model output) is not overwritten");
});
