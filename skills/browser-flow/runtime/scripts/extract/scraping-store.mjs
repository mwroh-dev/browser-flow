// Phase NNN: durable scraping-knowledge store. Separate domain from the
// page-node graph (decision ①): config.json (ExtractorConfigV1) + golden.json
// (drift oracle), keyed by structural pageKey under knowledge/scraping/<key>/.
// first-write-wins by default — the agent establishes once; heal (Plan 4) passes
// { force: true } to update in place. Committed knowledge (survives runs).

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { scrapingPaths } from "../lib/config.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";

/**
 * @param {string} pageKey
 * @param {Record<string, any>} config  full ExtractorConfigV1
 * @param {{ cardinality?: number, sampleValues?: any[] }} golden
 * @param {{ force?: boolean }} [opts]
 * @returns {{ written: boolean, kept?: boolean, pageKey: string }}
 */
export function writeScrapingKnowledge(pageKey, config, golden, opts = {}) {
  const paths = scrapingPaths(pageKey);
  if (!opts.force && existsSync(paths.configPath)) {
    return { written: false, kept: true, pageKey: paths.pageKey };
  }
  mkdirSync(dirname(paths.configPath), { recursive: true });
  writeJson(paths.configPath, config);
  writeJson(paths.goldenPath, {
    schemaVersion: 1,
    pageKey: paths.pageKey,
    capturedAt: new Date().toISOString(),
    cardinality: (golden && golden.cardinality) ?? 0,
    sampleValues: (golden && golden.sampleValues) ?? []
  });
  return { written: true, pageKey: paths.pageKey };
}

/**
 * @param {string} pageKey
 * @returns {Record<string, any>|null}
 */
export function readScrapingConfig(pageKey) {
  const paths = scrapingPaths(pageKey);
  return existsSync(paths.configPath) ? /** @type {Record<string, any>} */ (readJson(paths.configPath)) : null;
}

/**
 * @param {string} pageKey
 * @returns {Record<string, any>|null}
 */
export function readGolden(pageKey) {
  const paths = scrapingPaths(pageKey);
  return existsSync(paths.goldenPath) ? /** @type {Record<string, any>} */ (readJson(paths.goldenPath)) : null;
}
