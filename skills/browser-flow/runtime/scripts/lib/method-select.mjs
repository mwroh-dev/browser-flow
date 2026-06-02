// @ts-check
// Deterministic resolution-method judgment criterion.
//
// Two resolution methods exist (user decision 2026-05-23 — "이2개는 다 커버"):
//   A = static anchor: identify the element by a stable boundary + text anchor
//       (Similo-style scoring). Works when a stable anchor exists.
//   B = action before/after diff: identify a morphing/anonymous element by what
//       its action makes appear/change (the recorded transition = answer key).
//       Needed when NO stable anchor exists ("정답지를 찾게끔").
//
// This is the deterministic FIRST-PASS default. The model (scope-agent) judges
// the "층위" and may override per element-context (applyScope writes the verdict).
// Runtime stays LLM-free: it reads the frozen method and dispatches deterministically.

import { isSignalPoor } from "./scope-gate.mjs";

/**
 * @param {Record<string, unknown> | undefined} locator
 * @param {{ appeared?: unknown[], changed?: unknown[] } | undefined} [transition]
 * @returns {"A" | "B"}
 */
export function selectResolutionMethod(locator, transition) {
  // Stable anchor present (name / neighborTexts / cleanId / href) → static anchor.
  if (!locator || !isSignalPoor(locator)) return "A";
  // Signal-poor: B is only usable when the action produced a distinguishing
  // delta (the element appeared or changed) to match against at replay. Without
  // such a delta there is nothing for B to track → fall back to A (fail-safe).
  const appeared = Array.isArray(transition?.appeared) ? transition.appeared.length : 0;
  const changed = Array.isArray(transition?.changed) ? transition.changed.length : 0;
  return appeared + changed > 0 ? "B" : "A";
}
