import test from "node:test";
import assert from "node:assert/strict";
import { equalitySim, normLevenshtein, wordSetJaccard, numericSim, urlPathSim } from "../../scripts/lib/signal-similarity.mjs";

test("equalitySim", () => { assert.equal(equalitySim("a","a"),1); assert.equal(equalitySim("a","b"),0); assert.equal(equalitySim("",""),1); });
test("normLevenshtein", () => {
  assert.equal(normLevenshtein("kitten","kitten"),1);
  const s = normLevenshtein("kitten","sitting"); assert.ok(s > 0.5 && s < 1);
  assert.equal(normLevenshtein("",""),1); assert.equal(normLevenshtein("abc",""),0);
});
test("wordSetJaccard", () => {
  assert.equal(wordSetJaccard(["a b","c"],["a","c"]), 2/3);
  assert.equal(wordSetJaccard([],[]),1); assert.equal(wordSetJaccard(["x"],["y"]),0);
});
test("urlPathSim: identical path -> 1, both empty -> 1, one empty -> 0", () => {
  assert.equal(urlPathSim("/wiki/A", "/wiki/A"), 1);
  assert.equal(urlPathSim("", ""), 1);
  assert.equal(urlPathSim("/wiki/A", ""), 0);
});
test("urlPathSim: encoding-invariant (percent-decoded equality)", () => {
  assert.equal(urlPathSim("/a/" + encodeURIComponent("대한"), "/a/대한"), 1);
});
test("urlPathSim: shared prefix but different last segment -> low (the wiki nav case Levenshtein over-credited)", () => {
  // /wiki/토론:대한민국 vs /wiki/특수:최근바뀐목록 share only the "wiki" segment.
  const s = urlPathSim("/wiki/" + encodeURIComponent("토론:대한민국"), "/wiki/" + encodeURIComponent("특수:최근바뀐목록"));
  assert.ok(s <= 0.34, `shared-prefix urls must score low, got ${s}`);
  // Levenshtein over-credited the same pair to ~0.54 — the defect this fix addresses.
  assert.ok(s < normLevenshtein("/wiki/토론:대한민국", "/wiki/특수:최근바뀐목록"), "must discriminate better than raw Levenshtein");
});
test("urlPathSim: path vs fragment-only are distinct (samename anchor #geo vs article /samename/geo)", () => {
  assert.ok(urlPathSim("/samename/geo", "#geo") < 0.5, "article path must not match a fragment-only anchor");
  assert.equal(urlPathSim("/samename/geo", "/samename/geo"), 1);
});
test("urlPathSim: query params discriminate (history vs edit) yet share path+title", () => {
  const s = urlPathSim("/w/index.php?title=X&action=history", "/w/index.php?title=X&action=edit");
  assert.ok(s > 0 && s < 1, `partial overlap expected, got ${s}`);
});
test("numericSim viewport-normalized", () => {
  assert.equal(numericSim({cx:10,cy:10},{cx:10,cy:10},{w:100,h:100}),1);
  assert.ok(numericSim({cx:0,cy:0},{cx:100,cy:100},{w:100,h:100}) < 0.1);
});
