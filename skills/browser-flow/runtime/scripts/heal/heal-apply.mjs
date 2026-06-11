/**
 * Apply a heal-result to a workflow. PURE — returns a new workflow; the
 * input is not mutated. Matches steps by the OLD locator.structuralKey and
 * replaces step.locator with the healed locator (self-heal cache).
 *
 * @param {{ steps: Array<Record<string, any>> }} workflow
 * @param {{ status: string, healedLocators?: Array<{ match: { structuralKey: string }, locator: Record<string, any> }>, reason?: string }} healResult
 * @returns {{ workflow: any, applied: string[], unmatched: string[], status: string, reason?: string }}
 */
export function applyHeal(workflow, healResult) {
  if (healResult.status === "partial-incomplete") {
    return { workflow, applied: [], unmatched: [], status: "partial-incomplete", reason: healResult.reason };
  }
  const next = structuredClone(workflow);
  /** @type {string[]} */ const applied = [];
  /** @type {string[]} */ const unmatched = [];
  for (const entry of (healResult.healedLocators || [])) {
    const key = entry.match.structuralKey;
    const matched = next.steps.filter((s) => s && s.locator && s.locator.structuralKey === key);
    if (matched.length > 0) {
      for (const step of matched) { step.locator = entry.locator; }
      applied.push(key);
    } else {
      unmatched.push(key);
    }
  }
  return { workflow: next, applied, unmatched, status: "healed" };
}
