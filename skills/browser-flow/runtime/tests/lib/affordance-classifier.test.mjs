import test from "node:test";
import assert from "node:assert/strict";
import { classifyAffordance } from "../../scripts/lib/affordance-classifier.mjs";

test("cud: irreversible + create/update keywords", () => {
  for (const name of ["Delete", "삭제", "결제", "Save", "저장", "Add item", "추가", "Edit", "수정", "Send"]) {
    assert.equal(classifyAffordance({ role: "button", name }), "cud", name);
  }
});
test("navigate: links and explicit nav buttons", () => {
  assert.equal(classifyAffordance({ role: "link", name: "Catalog" }), "navigate");
  assert.equal(classifyAffordance({ role: "link", name: "" }), "navigate");
  assert.equal(classifyAffordance({ role: "button", name: "View details" }), "navigate");
  assert.equal(classifyAffordance({ role: "button", name: "더보기" }), "navigate");
});
test("skip: ambiguous buttons + inputs (conservative)", () => {
  assert.equal(classifyAffordance({ role: "button", name: "Process" }), "skip");
  assert.equal(classifyAffordance({ role: "textbox", name: "Title" }), "skip");
  assert.equal(classifyAffordance({ role: "button", name: "" }), "skip");
});
test("cud takes precedence over a nav-looking name", () => {
  assert.equal(classifyAffordance({ role: "button", name: "Save and view" }), "cud");
});
