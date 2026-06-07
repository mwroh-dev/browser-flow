import test from "node:test";
import assert from "node:assert/strict";
import { generateDummyName, isDummyName, findDummies } from "../../scripts/lib/dummy-naming.mjs";

test("generateDummyName = prefix + hash (human-readable + searchable), unique", () => {
  const a = generateDummyName("__bf_test__", 8);
  const b = generateDummyName("__bf_test__", 8);
  assert.match(a, /^__bf_test__[0-9a-f]{8}$/);
  assert.notEqual(a, b); // unique per call
  assert.ok(isDummyName(a, "__bf_test__"));
  assert.ok(!isDummyName("real-notebook", "__bf_test__"));
});

test("findDummies returns only names matching the prefix (orphan recovery)", () => {
  const names = ["real-1", "__bf_test__aaaa1111", "note", "__bf_test__bbbb2222"];
  assert.deepEqual(findDummies(names, "__bf_test__").sort(), ["__bf_test__aaaa1111", "__bf_test__bbbb2222"]);
});
