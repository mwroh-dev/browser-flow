function reconnectPageKey(result) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    if (typeof result.pageKey === "string") return result.pageKey;
    if (typeof result.reconnectPageKey === "string") return result.reconnectPageKey;
  }
  return undefined;
}

export async function runLearningLoop({
  requestIntent,
  observe,
  choose,
  execute,
  reconnect,
  appendJournal
}) {
  const learnedSteps = [];
  let observation = await observe({ requestIntent, learnedSteps });

  while (true) {
    const action = await choose({ requestIntent, observation, learnedSteps });
    if (!action) {
      const blockedReason = learnedSteps.length > 0 ? "graph_disconnect" : "unreachable_goal";
      return { status: "blocked", blockedReason, learnedSteps };
    }

    const executedStep = await execute({ requestIntent, observation, action, learnedSteps });
    const step = structuredClone(executedStep ?? action);
    learnedSteps.push(step);
    await appendJournal({
      type: "learned_step",
      stepIndex: learnedSteps.length - 1,
      step
    });

    const reconnectResult = await reconnect({ requestIntent, observation, learnedSteps, step });
    const pageKey = reconnectPageKey(reconnectResult);
    if (pageKey) {
      return { status: "resolved", reconnectPageKey: pageKey, learnedSteps };
    }

    observation = await observe({ requestIntent, learnedSteps, previousObservation: observation });
  }
}
