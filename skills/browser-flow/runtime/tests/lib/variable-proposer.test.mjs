import test from "node:test";
import assert from "node:assert/strict";
import { proposeInputs, applyProposalToWorkflow } from "../../scripts/lib/variable-proposer.mjs";

test("proposeInputs returns empty result for workflow without fill steps", () => {
  const result = proposeInputs({ steps: [{ action: "goto" }, { action: "click", selector: "#x" }] });
  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.stepValueRefs, []);
});

test("proposeInputs proposes one input per non-empty fill step", () => {
  const workflow = {
    steps: [
      { action: "goto" },
      { action: "fill", selector: "#a", fieldName: "title", value: "hello" },
      { action: "click", selector: "#x" },
      { action: "fill", selector: "#b", fieldName: "body", value: "world" }
    ]
  };
  const result = proposeInputs(workflow);
  assert.equal(result.proposals.length, 2);
  assert.equal(result.proposals[0].name, "title");
  assert.equal(result.proposals[0].suggestedFrom, 1);
  assert.equal(result.proposals[1].name, "body");
  assert.equal(result.proposals[1].suggestedFrom, 3);
  assert.deepEqual(result.stepValueRefs[0], { stepIndex: 1, valueRef: "{{input.title}}" });
  assert.deepEqual(result.stepValueRefs[1], { stepIndex: 3, valueRef: "{{input.body}}" });
});

test("proposeInputs treats secret fill as secret type even with empty value", () => {
  const workflow = {
    steps: [
      { action: "fill", selector: "#p", fieldName: "password", secret: true }
    ]
  };
  const result = proposeInputs(workflow);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].type, "secret");
  assert.equal(result.proposals[0].name, "password");
});

test("proposeInputs picks path type for path-like values", () => {
  const workflow = {
    steps: [
      { action: "fill", selector: "#f", fieldName: "filePath", value: "/Users/x/file.pdf" },
      { action: "fill", selector: "#g", fieldName: "relPath", value: "./folder/x.txt" },
      { action: "fill", selector: "#h", fieldName: "winPath", value: "C:\\foo\\bar.docx" }
    ]
  };
  const result = proposeInputs(workflow);
  assert.equal(result.proposals[0].type, "path");
  assert.equal(result.proposals[1].type, "path");
  assert.equal(result.proposals[2].type, "path");
});

test("proposeInputs falls back to input<idx> when fieldName missing or empty", () => {
  const workflow = {
    steps: [
      { action: "fill", selector: "#a", value: "v1" },
      { action: "fill", selector: "#b", fieldName: "", value: "v2" }
    ]
  };
  const result = proposeInputs(workflow);
  assert.equal(result.proposals[0].name, "input0");
  assert.equal(result.proposals[1].name, "input1");
});

test("proposeInputs sanitizes fieldName (non-word chars → underscore, leading digit prefixed)", () => {
  const workflow = {
    steps: [
      { action: "fill", selector: "#a", fieldName: "mat-input-0", value: "x" },
      { action: "fill", selector: "#b", fieldName: "1leading-digit", value: "y" }
    ]
  };
  const result = proposeInputs(workflow);
  assert.equal(result.proposals[0].name, "mat_input_0");
  assert.equal(result.proposals[1].name, "i_1leading_digit");
});

test("proposeInputs uniquifies duplicate names with _2, _3 suffix", () => {
  const workflow = {
    steps: [
      { action: "fill", selector: "#a", fieldName: "name", value: "x" },
      { action: "fill", selector: "#b", fieldName: "name", value: "y" },
      { action: "fill", selector: "#c", fieldName: "name", value: "z" }
    ]
  };
  const result = proposeInputs(workflow);
  assert.equal(result.proposals[0].name, "name");
  assert.equal(result.proposals[1].name, "name_2");
  assert.equal(result.proposals[2].name, "name_3");
});

test("applyProposalToWorkflow mutates workflow with inputs[] + per-step valueRef", () => {
  const workflow = {
    steps: [
      { action: "goto" },
      { action: "fill", selector: "#x", fieldName: "q", value: "search" }
    ]
  };
  const result = proposeInputs(workflow);
  const returned = applyProposalToWorkflow(workflow, result);
  assert.equal(returned, workflow, "returns same reference for chaining");
  const mutated = /** @type {{ inputs: Array<{ name: string }>, steps: Array<{ valueRef?: string }> }} */ (/** @type {unknown} */ (workflow));
  assert.equal(mutated.inputs.length, 1);
  assert.equal(mutated.inputs[0].name, "q");
  assert.equal(mutated.steps[1].valueRef, "{{input.q}}");
});
