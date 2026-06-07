import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordTeardown, buildSearchTeardown } from "../../scripts/lib/teardown.mjs";

test("buildRecordTeardown wraps cleanup steps with record strategy + default dummyNaming", () => {
  const cleanup = [{ action: "click", selector: "button[aria-label='삭제']" }];
  const td = buildRecordTeardown(cleanup);
  assert.equal(td.strategy, "record");
  assert.deepEqual(td.steps, cleanup);
  assert.deepEqual(td.dummyNaming, { prefix: "__bf_test__", hashLen: 8 });
});

test("buildRecordTeardown accepts custom dummyNaming + empty steps", () => {
  const td = buildRecordTeardown([], { prefix: "__x__", hashLen: 4 });
  assert.deepEqual(td.steps, []);
  assert.equal(td.dummyNaming.prefix, "__x__");
});

test("buildSearchTeardown discovers a delete affordance from captured selectors", () => {
  const selectors = [
    { selector: "[data-bf=\"item-delete\"]", actions: ["click"], text: "Delete", ancestors: [{ role: "button" }] },
    { selector: "[data-bf=\"item-create\"]", actions: ["click"], text: "Create" }
  ];
  const td = buildSearchTeardown(selectors, "delete the item");
  assert.equal(td.strategy, "search");
  assert.equal(td.steps.length, 1);
  assert.equal(td.steps[0].action, "click");
  assert.equal(td.steps[0].selector, "[data-bf=\"item-delete\"]");
  assert.deepEqual(td.dummyNaming, { prefix: "__bf_test__", hashLen: 8 });
});

test("buildSearchTeardown returns empty steps when no affordance matches", () => {
  const td = buildSearchTeardown([{ selector: "button", actions: ["click"], text: "Create" }], "remove");
  assert.deepEqual(td.steps, []);
  assert.equal(td.strategy, "search");
});

test("buildSearchTeardown accepts custom dummyNaming", () => {
  const td = buildSearchTeardown([], "x", { prefix: "__x__", hashLen: 4 });
  assert.equal(td.dummyNaming.prefix, "__x__");
});
