// @ts-check
// Pure, agent-blind element-type matcher. Maps a captured step.locator to a set of
// weightOverrides by element TYPE — using only the locator's own structural signals
// (role, structuralKey substring, href presence, type). No real text/URL VALUES are
// inspected, so this respects the agent-blind boundary.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getScoringPatternsPath } from "./config.mjs";

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../agents/analyzer/playbooks/scoring-patterns.json");

const KNOWN_SIGNALS = new Set(["name", "structuralKey", "neighborTexts", "semanticRegion", "cleanId", "role", "type", "alt", "href", "relXPath", "box"]);

/** @param {Record<string,unknown>} loc @param {Record<string,unknown>} match @returns {boolean} */
export function evalMatch(loc, match) {
  const keys = Object.keys(match || {});
  if (keys.length === 0) return false; // empty predicate is never a catch-all
  for (const k of keys) {
    const cond = match[k];
    if (k === "roleIn") { if (!Array.isArray(cond) || !cond.includes(loc.role)) return false; }
    else if (k === "typeIn") { if (!Array.isArray(cond) || !cond.includes(loc.type)) return false; }
    else if (k === "structuralKeyIncludes") { if (typeof loc.structuralKey !== "string" || !loc.structuralKey.includes(String(cond))) return false; }
    else if (k === "hasHref") { const has = typeof loc.href === "string" && loc.href !== ""; if (Boolean(cond) !== has) return false; }
    else return false; // unknown predicate key -> conservative no-match
  }
  return true;
}

/**
 * First matching pattern's signalWeights (whitelisted + clamped) as weightOverrides.
 * @param {Record<string,unknown>} loc
 * @param {Array<{id:string, match:Record<string,unknown>, signalWeights:Record<string,number>}>} patterns
 * @returns {{id:string, weightOverrides:Record<string,number>} | null}
 */
export function matchPattern(loc, patterns) {
  for (const p of patterns || []) {
    if (p && p.match && evalMatch(loc, p.match)) {
      return { id: p.id, weightOverrides: sanitizeWeights(p.signalWeights) };
    }
  }
  return null;
}

/** @param {Record<string,number>} w @returns {Record<string,number>} */
export function sanitizeWeights(w) {
  /** @type {Record<string,number>} */ const out = {};
  for (const [k, v] of Object.entries(w || {})) {
    if (!KNOWN_SIGNALS.has(k)) continue;            // ignore unknown signal names
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = n < 0 ? 0 : n > 3 ? 3 : n;             // clamp [0,3]
  }
  return out;
}

/** @param {string} path @returns {Array<any>} */
function readPatterns(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.id && p.match && p.signalWeights) : [];
  } catch { return []; }
}

/** Load scoring patterns. Default = static playbook seeds + learned knowledge. Missing/invalid -> [] (never throws). @param {string} [path] @returns {Array<any>} */
export function loadPatterns(path) {
  if (path) return readPatterns(path);
  const patterns = [...readPatterns(SEED_PATH), ...readPatterns(getScoringPatternsPath())];
  const seen = new Set();
  return patterns.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/**
 * Return a copy of the locator with disambiguation.weightOverrides set when a pattern
 * matches AND no disambiguation already exists (model output wins over pattern seed).
 * @param {Record<string,unknown>} loc @param {Array<any>} patterns @returns {Record<string,unknown>}
 */
export function applyPatterns(loc, patterns) {
  if (loc && loc.disambiguation) return loc;          // already decided (model) — leave it
  const m = matchPattern(loc, patterns);
  if (!m) return loc;
  return { ...loc, disambiguation: { weightOverrides: m.weightOverrides, patternId: m.id } };
}
