import test from "node:test";
import assert from "node:assert/strict";
import { findDeleteAffordances, findDummyItemNames } from "../../scripts/lib/affordance-search.mjs";

test("findDeleteAffordances matches clickable elements whose text is a delete keyword", () => {
  const selectors = [
    { selector: "button#a", actions: ["click"], text: "삭제" },
    { selector: "button#b", actions: ["click"], text: "Create" },
    { selector: "a#c", actions: ["click"], text: "Remove item" },
    { selector: "input#d", actions: ["fill"], text: "delete" }, // not clickable → excluded
  ];
  const hits = findDeleteAffordances(selectors);
  assert.deepEqual(hits.map((h) => h.selector), ["button#a", "a#c"]);
});

test("findDeleteAffordances honors custom keywords + carries the entry through", () => {
  const selectors = [{ selector: "button", actions: ["click"], text: "지우기", ancestors: [{ role: "button" }] }];
  const hits = findDeleteAffordances(selectors, ["지우기"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, "지우기");
});

test("findDeleteAffordances tolerates non-array / malformed input", () => {
  assert.deepEqual(findDeleteAffordances(null), []);
  assert.deepEqual(findDeleteAffordances([null, { selector: "x" }]), []);
});

test("findDummyItemNames returns AX node names matching the dummy prefix (deduped, in order)", () => {
  const ax = [
    { role: "listitem", name: "__bf_test__dead" },
    { role: "listitem", name: "real-item" },
    { role: "listitem", name: "__bf_test__dead" },
    { role: "button", name: "__bf_test__ignore-me" },
  ];
  assert.deepEqual(findDummyItemNames(ax, "__bf_test__"), ["__bf_test__dead", "__bf_test__ignore-me"]);
});
