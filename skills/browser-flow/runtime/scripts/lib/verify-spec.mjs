import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseVerifySpec } from "./schemas.mjs";

/**
 * @typedef {{ id: string, prompt: string, category: string, requiredWhen?: string, detectInRawRequest?: string }} SpecQuestion
 */

/**
 * Merge override onto base by question id. Override replaces a base
 * question with the same id and appends new ids. The base array/objects
 * are never mutated (a fresh merged array of fresh objects is returned).
 *
 * @param {string} basePath
 * @param {string} overridePath
 * @returns {SpecQuestion[]}
 */
export function loadMergedQuestions(basePath, overridePath) {
  const base = /** @type {SpecQuestion[]} */ (JSON.parse(readFileSync(basePath, "utf8")));
  const override = existsSync(overridePath)
    ? /** @type {SpecQuestion[]} */ (JSON.parse(readFileSync(overridePath, "utf8")))
    : [];
  const byId = new Map();
  for (const q of base) byId.set(q.id, { ...q });
  for (const q of override) byId.set(q.id, { ...q });
  return Array.from(byId.values());
}

/**
 * Validate and write a verify-spec.json to disk.
 *
 * @param {string} path
 * @param {unknown} spec
 */
export function writeVerifySpec(path, spec) {
  const validated = parseVerifySpec(spec, path);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`);
}

/**
 * Read and validate a verify-spec.json from disk.
 *
 * @param {string} path
 */
export function readVerifySpec(path) {
  return parseVerifySpec(JSON.parse(readFileSync(path, "utf8")), path);
}
