import { randomBytes } from "node:crypto";

/**
 * Generate an identifiable test-dummy name: human-readable prefix +
 * agent-searchable hex hash. Unique per call (random) so concurrent
 * verifies don't collide; the prefix makes orphans findable for cleanup.
 * @param {string} prefix @param {number} hashLen @returns {string}
 */
export function generateDummyName(prefix, hashLen) {
  const hex = randomBytes(Math.ceil(hashLen / 2)).toString("hex").slice(0, hashLen);
  return `${prefix}${hex}`;
}

/** @param {string} name @param {string} prefix @returns {boolean} */
export function isDummyName(name, prefix) {
  return typeof name === "string" && name.startsWith(prefix);
}

/** @param {string[]} names @param {string} prefix @returns {string[]} */
export function findDummies(names, prefix) {
  return names.filter((n) => isDummyName(n, prefix));
}
