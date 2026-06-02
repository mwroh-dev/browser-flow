const ORDER = [
  "request_structured",
  "reusable_prefix_selected",
  "learning_gap_resolved",
  "workflow_generated",
  "verification_passed"
];

export function advanceCheckpoint({ current, ok, blockedReason = "none" }) {
  const index = ORDER.indexOf(current);
  if (index < 0) {
    throw new Error(`Unknown compose checkpoint: ${current}`);
  }
  if (!ok) {
    return { status: "broken", blockedReason, next: null };
  }
  return {
    status: "in-progress",
    blockedReason: "none",
    next: index + 1 < ORDER.length ? ORDER[index + 1] : null
  };
}
