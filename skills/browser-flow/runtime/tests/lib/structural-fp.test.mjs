import test from "node:test";
import assert from "node:assert/strict";
import { filterDynamicClasses, buildStructuralKey, buildElementKey, isDynamicId } from "../../scripts/lib/structural-fp.mjs";

test("filterDynamicClasses drops hashed/state/generated classes, keeps semantic", () => {
  assert.deepEqual(
    filterDynamicClasses(["btn", "css-1a2b3c", "is-active", "PrimaryButton", "x8f9q2k7zz"]).sort(),
    ["PrimaryButton", "btn"].sort()
  );
});
test("filterDynamicClasses tolerates non-array", () => {
  assert.deepEqual(filterDynamicClasses(null), []);
});
test("buildStructuralKey is stable across attr order + dynamic-class differences", () => {
  const a = buildStructuralKey({ tagPath: ["main","form","div"], tag: "button", staticAttrs: { role: "button", type: "submit" }, classes: ["btn","css-xyz123ab"], name: "Save" });
  const b = buildStructuralKey({ tagPath: ["main","form","div"], tag: "button", staticAttrs: { type: "submit", role: "button" }, classes: ["btn","css-DIFFERENT99"], name: "Save" });
  assert.equal(a, b);
});
test("buildStructuralKey changes when a semantic signal changes", () => {
  const base = { tagPath: ["div"], tag: "button", staticAttrs: { role: "button" }, classes: [], name: "Save" };
  assert.notEqual(buildStructuralKey(base), buildStructuralKey({ ...base, name: "Delete" }));
  assert.notEqual(buildStructuralKey(base), buildStructuralKey({ ...base, tag: "a" }));
});
test("buildElementKey retains all classes (more precise than structuralKey)", () => {
  const d = { tagPath: ["div"], tag: "button", staticAttrs: {}, classes: ["btn","css-xyz123ab"], name: "X" };
  assert.notEqual(buildStructuralKey(d), buildElementKey(d));
});
test("isDynamicId flags auto-generated ids, keeps semantic ones", () => {
  for (const id of ["mwAtQ", "mwDw", "ember123", ":r1a:", "radix-abc", "a1b2c3d4e5f6"]) assert.equal(isDynamicId(id), true, id);
  for (const id of ["firstHeading", "search", "p-search", "main-content", "submit-btn", "logo"]) assert.equal(isDynamicId(id), false, id);
  assert.equal(isDynamicId(""), false);
});
