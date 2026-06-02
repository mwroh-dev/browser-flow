import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * @param {string} path
 * @returns {unknown}
 */
export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {string} path
 * @param {unknown} value
 */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * @param {string} path
 * @param {string} value
 */
export function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

/**
 * @param {string} path
 * @returns {string[]}
 */
export function listFilesRecursive(path) {
  /** @type {string[]} */
  const results = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
      continue;
    }
    results.push(fullPath);
  }
  return results;
}
