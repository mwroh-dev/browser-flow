import test from "node:test";
import assert from "node:assert/strict";
import { transitionMatches } from "../../scripts/lib/transition-match.mjs";

test("transitionMatches — same appeared key → match", () => {
  const recorded = { appeared: [{ structuralKey: "k-body" }], disappeared: [], changed: [] };
  const live = { appeared: [{ structuralKey: "k-body" }, { structuralKey: "k-noise" }], disappeared: [], changed: [] };
  assert.equal(transitionMatches(recorded, live), true);
});

test("transitionMatches — wrong element reacted (zero overlap) → mismatch", () => {
  const recorded = { appeared: [{ structuralKey: "k-body" }], disappeared: [], changed: [] };
  const live = { appeared: [{ structuralKey: "k-something-else" }], disappeared: [], changed: [] };
  assert.equal(transitionMatches(recorded, live), false);
});

test("transitionMatches — nothing distinguishing recorded → no-op true (don't block)", () => {
  assert.equal(transitionMatches({ appeared: [], disappeared: [], changed: [] }, { appeared: [{ structuralKey: "x" }] }), true);
  assert.equal(transitionMatches(null, { appeared: [{ structuralKey: "x" }] }), true);
});

test("transitionMatches — changed-key overlap counts", () => {
  const recorded = { appeared: [], disappeared: [], changed: [{ old: { structuralKey: "k1" }, live: { structuralKey: "k2" } }] };
  const live = { appeared: [], disappeared: [], changed: [{ old: { structuralKey: "k1" }, live: { structuralKey: "k2" } }] };
  assert.equal(transitionMatches(recorded, live), true);
  // live where the changed element's keys differ entirely → mismatch.
  const liveOther = { appeared: [], disappeared: [], changed: [{ old: { structuralKey: "z1" }, live: { structuralKey: "z2" } }] };
  assert.equal(transitionMatches(recorded, liveOther), false);
});
