import test from "node:test";
import assert from "node:assert/strict";
import { deriveAtomicLocator, deriveAtomicSubmitter } from "../../scripts/lib/atomic-fp.mjs";

test("deriveAtomicLocator returns null when totalMatchingSelector <= 1 (already atomic)", () => {
  assert.equal(
    deriveAtomicLocator({
      selector: "button[aria-label=\"검색 열기\"]",
      text: "search",
      siblings: { totalMatchingSelector: 1, totalMatchingRole: 1 }
    }),
    null
  );
});

test("deriveAtomicLocator returns null when siblings field missing (back-compat)", () => {
  assert.equal(
    deriveAtomicLocator({ selector: "[data-bf=\"launch\"]", text: "Run Demo" }),
    null
  );
});

test("deriveAtomicLocator picks role strategy when totalMatchingRole === 1 and tag has implicit role", () => {
  // selector=button matches 73 nodes,
  // accessible name "delete 삭제" is unique → role disambiguates.
  const result = deriveAtomicLocator({
    selector: "button",
    text: "delete 삭제",
    siblings: { totalMatchingSelector: 73, totalMatchingRole: 1 },
    ancestors: [
      { tag: "div" },
      { tag: "div", id: "cdk-overlay-3" },
      { tag: "div", id: "mat-menu-panel-279", role: "menu" }
    ]
  });
  assert.deepEqual(result, { strategy: "role", role: "button", name: "delete 삭제" });
});

test("deriveAtomicLocator falls back to ancestor-scope when role doesn't disambiguate", () => {
  // selector=form matches 3, role=form not
  // recognized (totalMatchingRole=0) → ancestor [role=dialog] scopes.
  const result = deriveAtomicLocator({
    selector: "form",
    text: "",
    siblings: { totalMatchingSelector: 3, totalMatchingRole: 0 },
    ancestors: [
      { tag: "mat-dialog-container", id: "mat-mdc-dialog-0", role: "dialog" },
      { tag: "div" },
      { tag: "div" }
    ]
  });
  assert.deepEqual(result, { strategy: "ancestor-scope", scopeSelector: "[role=\"dialog\"]" });
});

test("deriveAtomicLocator prefers data-bf > data-testid > role > custom-element-tag in ancestor pick", () => {
  // closest ancestor with data-bf wins, even if outer ancestor has role
  const result = deriveAtomicLocator({
    selector: "button",
    text: "common",
    siblings: { totalMatchingSelector: 5, totalMatchingRole: 5 },
    ancestors: [
      { tag: "div", role: "region" },
      { tag: "div", dataBf: "card" },
      { tag: "div" }
    ]
  });
  assert.deepEqual(result, { strategy: "ancestor-scope", scopeSelector: "[data-bf=\"card\"]" });
});

test("deriveAtomicLocator picks custom-element tag (Angular component) when no role/data-* present", () => {
  // ancestor chains include tags like welcome-page,
  // notebook-search-input, artifact-library — stable Angular names.
  const result = deriveAtomicLocator({
    selector: "button",
    text: "more",
    siblings: { totalMatchingSelector: 4, totalMatchingRole: 4 },
    ancestors: [
      { tag: "div" },
      { tag: "div" },
      { tag: "artifact-library-item" }
    ]
  });
  assert.deepEqual(result, { strategy: "ancestor-scope", scopeSelector: "artifact-library-item" });
});

test("deriveAtomicLocator returns null when no stable ancestor exists", () => {
  // bare div soup — no disambiguation possible from data alone.
  const result = deriveAtomicLocator({
    selector: "button",
    text: "x",
    siblings: { totalMatchingSelector: 3, totalMatchingRole: 0 },
    ancestors: [{ tag: "div" }, { tag: "div" }, { tag: "div" }]
  });
  assert.equal(result, null);
});

test("deriveAtomicLocator escapes attribute-value quotes/backslashes in scope selector", () => {
  const result = deriveAtomicLocator({
    selector: "button",
    text: "x",
    siblings: { totalMatchingSelector: 2, totalMatchingRole: 0 },
    ancestors: [{ tag: "div", role: 'dia"log' }]
  });
  assert.deepEqual(result, { strategy: "ancestor-scope", scopeSelector: '[role="dia\\"log"]' });
});

test("deriveAtomicLocator requires non-empty text for role strategy (else fallback)", () => {
  const result = deriveAtomicLocator({
    selector: "button",
    text: "",
    siblings: { totalMatchingSelector: 2, totalMatchingRole: 1 },
    ancestors: [{ tag: "section", role: "region" }]
  });
  // empty text disqualifies role strategy → ancestor scope wins
  assert.deepEqual(result, { strategy: "ancestor-scope", scopeSelector: "[role=\"region\"]" });
});

test("deriveAtomicSubmitter applies role strategy for button submitters with non-empty text", () => {
  const result = deriveAtomicSubmitter({
    type: "submit",
    selector: "form",
    submitterSelector: "button[aria-label=\"삭제 확인\"]",
    submitterText: "삭제"
  });
  assert.deepEqual(result, { strategy: "role", role: "button", name: "삭제" });
});

test("deriveAtomicSubmitter returns null when no submitter selector", () => {
  assert.equal(
    deriveAtomicSubmitter({ type: "submit", selector: "form" }),
    null
  );
});

test("deriveAtomicSubmitter returns null when submitter has empty text (no name to match)", () => {
  assert.equal(
    deriveAtomicSubmitter({
      type: "submit",
      selector: "form",
      submitterSelector: "button",
      submitterText: ""
    }),
    null
  );
});

test("deriveAtomicLocator uses an emitted explicit role (contenteditable textbox on a div)", () => {
  const fp = deriveAtomicLocator({
    selector: 'div[aria-label="제목"]',
    role: "textbox",
    fieldName: "제목",
    siblings: { totalMatchingSelector: 2, totalMatchingRole: 1 }
  });
  assert.deepEqual(fp, { strategy: "role", role: "textbox", name: "제목" });
});

test("deriveAtomicLocator uses explicit role for a role-less div button (name from text)", () => {
  const fp = deriveAtomicLocator({
    selector: "div",
    role: "button",
    text: "Create",
    siblings: { totalMatchingSelector: 3, totalMatchingRole: 1 }
  });
  assert.deepEqual(fp, { strategy: "role", role: "button", name: "Create" });
});

test("deriveAtomicLocator still falls back to tag-implicit role when no explicit role", () => {
  const fp = deriveAtomicLocator({
    selector: "button",
    text: "Save",
    siblings: { totalMatchingSelector: 2, totalMatchingRole: 1 }
  });
  assert.deepEqual(fp, { strategy: "role", role: "button", name: "Save" });
});
