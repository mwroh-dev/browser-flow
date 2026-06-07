import test from "node:test";
import assert from "node:assert/strict";
import {
  placeholderFor,
  parsePlaceholder,
  validateInputs,
  bindInputs,
  bindingsShortHash
} from "../../scripts/lib/workflow-inputs.mjs";

test("placeholderFor produces canonical {{input.X}} form", () => {
  assert.equal(placeholderFor("fileName"), "{{input.fileName}}");
  assert.equal(placeholderFor("search_term"), "{{input.search_term}}");
});

test("placeholderFor rejects invalid input names", () => {
  assert.throws(() => placeholderFor(""), /Invalid input name/);
  assert.throws(() => placeholderFor("1leading-digit"), /Invalid input name/);
  assert.throws(() => placeholderFor("has-dash"), /Invalid input name/);
});

test("parsePlaceholder extracts input name or returns null", () => {
  assert.equal(parsePlaceholder("{{input.fileName}}"), "fileName");
  assert.equal(parsePlaceholder("{{ input.foo }}"), "foo");
  assert.equal(parsePlaceholder("plain literal"), null);
  assert.equal(parsePlaceholder("{{not-an-input}}"), null);
  assert.equal(parsePlaceholder(123), null);
  assert.equal(parsePlaceholder(undefined), null);
});

test("validateInputs accepts canonical inputs array", () => {
  const inputs = [
    { name: "fileName", label: "파일 경로", suggestedFrom: 4, type: "path" },
    { name: "searchTerm", label: "검색어", suggestedFrom: 2, type: "text" }
  ];
  const result = validateInputs(inputs);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "fileName");
  assert.equal(result[0].type, "path");
});

test("validateInputs defaults label to name when missing", () => {
  const inputs = [{ name: "foo", type: "text" }];
  const result = validateInputs(inputs);
  assert.equal(result[0].label, "foo");
});

test("validateInputs rejects duplicate names", () => {
  assert.throws(
    () => validateInputs([
      { name: "x", type: "text" },
      { name: "x", type: "path" }
    ]),
    /Duplicate input name "x"/
  );
});

test("validateInputs rejects invalid type", () => {
  assert.throws(
    () => validateInputs([{ name: "x", type: "binary" }]),
    /Invalid input type "binary"/
  );
});

test("bindInputs substitutes valueRef placeholders with bound values", () => {
  const workflow = {
    inputs: [
      { name: "fileName", type: "path" },
      { name: "searchTerm", type: "text" }
    ],
    steps: [
      { action: "goto", url: "/" },
      { action: "fill", selector: "#search", value: "literal", valueRef: "{{input.searchTerm}}" },
      { action: "fill", selector: "#file", value: "literal", valueRef: "{{input.fileName}}" },
      { action: "click", selector: "#go" }
    ]
  };
  const bound = bindInputs(workflow, { fileName: "/tmp/x.pdf", searchTerm: "AI papers" });
  assert.equal(bound.steps[1].value, "AI papers");
  assert.equal(bound.steps[1].valueRef, undefined, "valueRef stripped after binding");
  assert.equal(bound.steps[2].value, "/tmp/x.pdf");
  assert.equal(bound.steps[3].value, undefined, "non-placeholder step untouched");
  // input은 immutable — 원본 workflow 변경 없음
  assert.equal(workflow.steps[1].value, "literal");
  assert.equal(workflow.steps[1].valueRef, "{{input.searchTerm}}");
});

test("bindInputs throws when binding references undeclared input", () => {
  const workflow = {
    inputs: [{ name: "foo", type: "text" }],
    steps: []
  };
  assert.throws(
    () => bindInputs(workflow, { foo: "ok", bar: "not declared" }),
    /Binding "bar" does not match/
  );
});

test("bindInputs throws when a step's placeholder has no binding", () => {
  const workflow = {
    inputs: [{ name: "foo", type: "text" }, { name: "bar", type: "text" }],
    steps: [
      { action: "fill", selector: "#x", value: "", valueRef: "{{input.bar}}" }
    ]
  };
  assert.throws(
    () => bindInputs(workflow, { foo: "ok" }),
    /Missing binding for input "bar"/
  );
});

test("bindInputs accepts workflow without declared inputs (no placeholders → no-op)", () => {
  const workflow = {
    steps: [{ action: "fill", selector: "#x", value: "literal" }]
  };
  const bound = bindInputs(workflow, {});
  assert.equal(bound.steps[0].value, "literal");
});

test("bindingsShortHash is deterministic across key orderings", () => {
  const a = bindingsShortHash({ foo: "1", bar: "2" });
  const b = bindingsShortHash({ bar: "2", foo: "1" });
  assert.equal(a, b);
  assert.equal(a.length, 8);
  assert.match(a, /^[0-9a-f]{8}$/);
});

test("bindingsShortHash differs for different bindings", () => {
  const a = bindingsShortHash({ foo: "1" });
  const b = bindingsShortHash({ foo: "2" });
  assert.notEqual(a, b);
});
