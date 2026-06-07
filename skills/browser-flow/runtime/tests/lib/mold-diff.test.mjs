import test from "node:test";
import assert from "node:assert/strict";
import { diffSkeletons } from "../../scripts/lib/mold-diff.mjs";

test("diffSkeletons: key-matched same name = unchanged; role+name-matched diff key = changed", () => {
  const oldS = [
    { role: "textbox", name: "Title", structuralKey: "k1" },
    { role: "button", name: "Save", structuralKey: "k2" }
  ];
  const live = [
    { role: "textbox", name: "Title", structuralKey: "k1b" }, // same role+name, new key -> changed
    { role: "button", name: "Save", structuralKey: "k2" }     // exact key match -> unchanged
  ];
  const d = diffSkeletons(oldS, live);
  assert.deepEqual(d.unchanged.map((x) => x.structuralKey), ["k2"]);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].old.structuralKey, "k1");
  assert.equal(d.changed[0].live.structuralKey, "k1b");
  assert.deepEqual(d.appeared, []);
  assert.deepEqual(d.disappeared, []);
});

test("diffSkeletons: name change at same key = changed", () => {
  const d = diffSkeletons(
    [{ role: "textbox", name: "Title", structuralKey: "k1" }],
    [{ role: "textbox", name: "제목", structuralKey: "k1" }]
  );
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].old.name, "Title");
  assert.equal(d.changed[0].live.name, "제목");
});

test("diffSkeletons: no match = appeared/disappeared", () => {
  const d = diffSkeletons(
    [{ role: "button", name: "X", structuralKey: "a" }],
    [{ role: "link", name: "Y", structuralKey: "b" }]
  );
  assert.deepEqual(d.disappeared.map((x) => x.name), ["X"]);
  assert.deepEqual(d.appeared.map((x) => x.name), ["Y"]);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.unchanged, []);
});

test("diffSkeletons tolerates null/empty", () => {
  assert.deepEqual(diffSkeletons(null, null), { unchanged: [], changed: [], appeared: [], disappeared: [] });
});
