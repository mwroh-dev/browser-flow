import test from "node:test";
import assert from "node:assert/strict";
import { makeTabOrdinal } from "../../scripts/observe/tab-ordinal.mjs";

test("makeTabOrdinal assigns 0,1,2 by first-seen targetId order", () => {
  const t = makeTabOrdinal();
  assert.equal(t.ordinalFor("a"), 0);
  assert.equal(t.ordinalFor("a"), 0); // stable
  assert.equal(t.ordinalFor("b"), 1);
  assert.equal(t.ordinalFor("c"), 2);
  assert.equal(t.ordinalFor("b"), 1);
  assert.equal(t.ordinalFor(""), 0, "empty/unknown targetId -> 0 (initial)");
});
