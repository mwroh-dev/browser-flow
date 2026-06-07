import test from "node:test";
import assert from "node:assert/strict";
import { collectDangling } from "../../scripts/lib/dangling.mjs";

test("collectDangling flattens created[] across journal entries, deduped + in order", () => {
  const journal = [
    { segmentIndex: 0, status: "done", created: ["__bf_test__a"] },
    { segmentIndex: 1, status: "incomplete", created: ["__bf_test__b"] },
    { segmentIndex: 2, status: "done" }
  ];
  assert.deepEqual(collectDangling(journal), ["__bf_test__a", "__bf_test__b"]);
});

test("collectDangling dedupes repeats", () => {
  const journal = [
    { segmentIndex: 0, created: ["__bf_test__a", "__bf_test__a"] },
    { segmentIndex: 1, created: ["__bf_test__a", "__bf_test__c"] }
  ];
  assert.deepEqual(collectDangling(journal), ["__bf_test__a", "__bf_test__c"]);
});

test("collectDangling tolerates empty / malformed input", () => {
  assert.deepEqual(collectDangling([]), []);
  assert.deepEqual(collectDangling(null), []);
  assert.deepEqual(collectDangling([{ segmentIndex: 0 }, { created: null }, { created: [""] }]), []);
});
