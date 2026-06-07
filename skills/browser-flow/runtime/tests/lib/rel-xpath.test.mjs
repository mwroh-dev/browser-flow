import test from "node:test";
import assert from "node:assert/strict";
import { buildRelXPath } from "../../scripts/lib/rel-xpath.mjs";

test("anchors at nearest stable ancestor (id), tag-indexes only when ambiguous", () => {
  const chain = [
    { tag: "main", id: "", indexAmongTag: 1, sameTagSiblings: 1 },
    { tag: "form", id: "checkout", indexAmongTag: 1, sameTagSiblings: 1 },
    { tag: "div", id: "", indexAmongTag: 2, sameTagSiblings: 3 },
    { tag: "button", id: "", indexAmongTag: 1, sameTagSiblings: 2 }
  ];
  assert.equal(buildRelXPath(chain), "//*[@id='checkout']/div[2]/button[1]");
});

test("anchors at data-bf when no id", () => {
  const chain = [
    { tag: "section", dataBf: "panel", indexAmongTag: 1, sameTagSiblings: 1 },
    { tag: "span", indexAmongTag: 1, sameTagSiblings: 1 }
  ];
  assert.equal(buildRelXPath(chain), "//*[@data-bf='panel']/span");
});

test("no stable ancestor → absolute-ish tag path from top with indices", () => {
  const chain = [
    { tag: "div", indexAmongTag: 1, sameTagSiblings: 2 },
    { tag: "button", indexAmongTag: 3, sameTagSiblings: 4 }
  ];
  assert.equal(buildRelXPath(chain), "//div[1]/button[3]");
});

test("target itself carrying an id anchors on the target", () => {
  const chain = [
    { tag: "main", indexAmongTag: 1, sameTagSiblings: 1 },
    { tag: "input", id: "email", indexAmongTag: 1, sameTagSiblings: 2 }
  ];
  assert.equal(buildRelXPath(chain), "//*[@id='email']");
});

test("tolerates empty/garbage", () => {
  assert.equal(buildRelXPath([]), "");
  assert.equal(buildRelXPath(null), "");
});
