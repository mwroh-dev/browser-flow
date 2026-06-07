import test from "node:test";
import assert from "node:assert/strict";
import { runLearningLoop } from "../../scripts/compose/learning-loop.mjs";

test("learning loop records learned steps and resolves when reconnect succeeds", async () => {
  const journal = [];
  const chosenActions = [
    { action: "fill", selector: "#email", value: "person@example.test" },
    { action: "submit", selector: "form" }
  ];
  let reconnectAttempts = 0;

  const result = await runLearningLoop({
    requestIntent: { targetState: "account created" },
    observe: async () => ({ pageKey: "signup/form" }),
    choose: async () => chosenActions.shift() ?? null,
    execute: async ({ action }) => ({ ...action, pageKey: "signup/form" }),
    reconnect: async () => {
      reconnectAttempts += 1;
      return reconnectAttempts === 2 ? { pageKey: "signup/done" } : null;
    },
    appendJournal: async (entry) => journal.push(entry)
  });

  assert.deepEqual(result, {
    status: "resolved",
    reconnectPageKey: "signup/done",
    learnedSteps: [
      { action: "fill", selector: "#email", value: "person@example.test", pageKey: "signup/form" },
      { action: "submit", selector: "form", pageKey: "signup/form" }
    ]
  });
  assert.deepEqual(journal.map((entry) => entry.step), result.learnedSteps);
});

test("learning loop returns unreachable_goal when no action is available", async () => {
  const result = await runLearningLoop({
    requestIntent: { targetState: "account created" },
    observe: async () => ({ pageKey: "signup/form" }),
    choose: async () => null,
    execute: async () => {
      throw new Error("execute should not be called");
    },
    reconnect: async () => null,
    appendJournal: async () => {
      throw new Error("appendJournal should not be called");
    }
  });

  assert.deepEqual(result, {
    status: "blocked",
    blockedReason: "unreachable_goal",
    learnedSteps: []
  });
});

test("learning loop reports graph_disconnect when learned steps do not reconnect", async () => {
  const chosenActions = [{ action: "click", selector: "#continue" }];
  const result = await runLearningLoop({
    requestIntent: { targetState: "account created" },
    observe: async () => ({ pageKey: "signup/form" }),
    choose: async () => chosenActions.shift() ?? null,
    execute: async ({ action }) => action,
    reconnect: async () => null,
    appendJournal: async () => {}
  });

  assert.deepEqual(result, {
    status: "blocked",
    blockedReason: "graph_disconnect",
    learnedSteps: [{ action: "click", selector: "#continue" }]
  });
});
