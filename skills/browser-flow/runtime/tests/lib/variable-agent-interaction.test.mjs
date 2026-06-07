import test from "node:test";
import assert from "node:assert/strict";
import {
  createScriptedAsk,
  interactiveConfirm,
  applyDecisions,
  ZeroProposalRejectedError
} from "../../scripts/lib/variable-agent-interaction.mjs";

test("createScriptedAsk returns answers in queued order then throws", async () => {
  const ask = createScriptedAsk(["a", "b"]);
  assert.equal(await ask("first?"), "a");
  assert.equal(await ask("second?"), "b");
  await assert.rejects(ask("third?"), /Scripted ask exhausted/);
});

test("interactiveConfirm walks proposals; default empty answer = accept", async () => {
  const workflow = {
    inputs: [
      { name: "title", suggestedFrom: 1, type: "text" },
      { name: "body", suggestedFrom: 3, type: "text" }
    ],
    steps: [
      { action: "goto" },
      { action: "fill", value: "Hello", valueRef: "{{input.title}}" },
      { action: "click" },
      { action: "fill", value: "World", valueRef: "{{input.body}}" }
    ]
  };
  const ask = createScriptedAsk(["", "y"]);
  const decisions = await interactiveConfirm({ workflow, ask });
  assert.deepEqual(decisions, [
    { originalName: "title", decision: "accept" },
    { originalName: "body", decision: "accept" }
  ]);
});

test("interactiveConfirm records reject + rename decisions", async () => {
  const workflow = {
    inputs: [
      { name: "a", suggestedFrom: 0, type: "text" },
      { name: "b", suggestedFrom: 1, type: "text" },
      { name: "c", suggestedFrom: 2, type: "text" }
    ],
    steps: [
      { action: "fill", value: "1" },
      { action: "fill", value: "2" },
      { action: "fill", value: "3" }
    ]
  };
  const ask = createScriptedAsk(["n", "renamed", "y"]);
  const decisions = await interactiveConfirm({ workflow, ask });
  assert.deepEqual(decisions, [
    { originalName: "a", decision: "reject" },
    { originalName: "b", decision: "rename", newName: "renamed" },
    { originalName: "c", decision: "accept" }
  ]);
});

test("interactiveConfirm rejects invalid rename (bad characters)", async () => {
  const workflow = {
    inputs: [{ name: "a", suggestedFrom: 0, type: "text" }],
    steps: [{ action: "fill", value: "v" }]
  };
  const ask = createScriptedAsk(["bad-name!"]);
  await assert.rejects(
    interactiveConfirm({ workflow, ask }),
    /Invalid rename "bad-name!"/
  );
});

test("interactiveConfirm with zero proposals: 'y' confirms 0-count", async () => {
  const workflow = { inputs: [], steps: [] };
  const ask = createScriptedAsk(["y"]);
  const decisions = await interactiveConfirm({ workflow, ask });
  assert.deepEqual(decisions, []);
});

test("interactiveConfirm with zero proposals: 'n' throws ZeroProposalRejectedError", async () => {
  const workflow = { inputs: [], steps: [] };
  const ask = createScriptedAsk(["n"]);
  await assert.rejects(
    interactiveConfirm({ workflow, ask }),
    ZeroProposalRejectedError
  );
});

test("applyDecisions: accept keeps input + valueRef, reject removes both, rename updates both", () => {
  const workflow = {
    inputs: [
      { name: "kept", type: "text" },
      { name: "dropped", type: "text" },
      { name: "renamed", type: "path" }
    ],
    steps: [
      { action: "fill", value: "k", valueRef: "{{input.kept}}" },
      { action: "fill", value: "d", valueRef: "{{input.dropped}}" },
      { action: "fill", value: "r", valueRef: "{{input.renamed}}" },
      { action: "click" }
    ]
  };
  applyDecisions(workflow, [
    { originalName: "kept", decision: "accept" },
    { originalName: "dropped", decision: "reject" },
    { originalName: "renamed", decision: "rename", newName: "newName" }
  ]);
  // inputs[]: kept + newName (dropped gone, renamed → newName)
  assert.equal(workflow.inputs.length, 2);
  assert.equal(workflow.inputs[0].name, "kept");
  assert.equal(workflow.inputs[1].name, "newName");
  assert.equal(workflow.inputs[1].type, "path");
  // step valueRef
  assert.equal(workflow.steps[0].valueRef, "{{input.kept}}");
  assert.equal(workflow.steps[1].valueRef, undefined, "rejected: valueRef stripped, value literal preserved");
  assert.equal(workflow.steps[1].value, "d", "literal value still there");
  assert.equal(workflow.steps[2].valueRef, "{{input.newName}}");
});

test("applyDecisions handles step without valueRef gracefully", () => {
  const workflow = {
    inputs: [{ name: "a", type: "text" }],
    steps: [{ action: "click" }, { action: "fill", value: "v", valueRef: "{{input.a}}" }]
  };
  applyDecisions(workflow, [{ originalName: "a", decision: "accept" }]);
  assert.equal(workflow.steps[0].valueRef, undefined);
  assert.equal(workflow.steps[1].valueRef, "{{input.a}}");
});
