// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { locatorCaptureSource } from "../../scripts/observe/locator-capture.mjs";
import { filterDynamicClasses, buildStructuralKey, buildElementKey } from "../../scripts/lib/structural-fp.mjs";
import { buildRelXPath } from "../../scripts/lib/rel-xpath.mjs";

/** @typedef {import("../../scripts/lib/structural-fp.mjs").StructuralDescriptor} StructuralDescriptor */

const inpage = new Function(locatorCaptureSource + "; return { fdc: __bfFilterDynamicClasses, sk: __bfBuildStructuralKey, ek: __bfBuildElementKey, rx: __bfBuildRelXPath };")();

/** @type {StructuralDescriptor[]} */
const descriptors = [
  { tagPath: ["main","form","div"], tag: "button", staticAttrs: { role: "button", type: "submit" }, classes: ["btn","css-xyz123ab","is-active"], name: "Save" },
  { tagPath: ["div"], tag: "a", staticAttrs: {}, classes: [], name: "Home" },
  { tagPath: [], tag: "input", staticAttrs: { name: "q" }, classes: ["x9f8a7b6c5"], name: "" }
];
const chains = [
  [{ tag: "main", indexAmongTag:1, sameTagSiblings:1 }, { tag: "form", id: "checkout", indexAmongTag:1, sameTagSiblings:1 }, { tag: "div", indexAmongTag:2, sameTagSiblings:3 }, { tag: "button", indexAmongTag:1, sameTagSiblings:2 }],
  [{ tag: "section", dataBf: "panel", indexAmongTag:1, sameTagSiblings:1 }, { tag: "span", indexAmongTag:1, sameTagSiblings:1 }]
];

test("in-page structural key matches Node lib", () => {
  for (const d of descriptors) {
    assert.equal(inpage.sk(d), buildStructuralKey(d), JSON.stringify(d));
    assert.equal(inpage.ek(d), buildElementKey(d), JSON.stringify(d));
  }
});
test("in-page filterDynamicClasses matches Node lib", () => {
  for (const d of descriptors) assert.deepEqual(inpage.fdc(d.classes).sort(), filterDynamicClasses(d.classes).sort());
});
test("in-page relXPath matches Node lib", () => {
  for (const c of chains) assert.equal(inpage.rx(c), buildRelXPath(c));
});
