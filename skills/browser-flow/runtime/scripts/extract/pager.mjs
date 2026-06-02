// Phase NNN: deterministic pagination extraction. The replay layer captures one
// snapshot per page (the user's recorded "next" clicks); this runs ONE config
// over all captured page snapshots and concatenates the rows. Pure + LLM-free.
// (Decision ③: the loop lives in the live replay; this is the deterministic core
// it calls. Unbounded live "click next" beyond captured pages is out of scope.)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { readJson } from "../lib/fs.mjs";
import { runExtractor } from "./extractor.mjs";

/**
 * @param {string[]} htmls
 * @param {{ container: string|null, fields: any[] }} config
 * @returns {{ rows: Record<string, unknown>[], cardinality: number, pages: number }}
 */
export function runExtractorPaged(htmls, config) {
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  let pages = 0;
  for (const html of Array.isArray(htmls) ? htmls : []) {
    const r = runExtractor(html, config);
    for (const row of r.rows) rows.push(row);
    pages += 1;
  }
  return { rows, cardinality: rows.length, pages };
}

/**
 * @param {string} manifestPath
 * @param {string} snapshotsDir
 * @returns {string[]}  one HTML string per manifest entry, in listed order
 */
export function readAllSnapshotsHtml(manifestPath, snapshotsDir) {
  const manifest = /** @type {{ entries?: Array<{ filename: string }> }} */ (readJson(manifestPath));
  const rawEntries = manifest && manifest.entries;
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  return entries.map((e) => {
    const file = resolve(snapshotsDir, e.filename);
    const buf = readFileSync(file);
    return e.filename.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  });
}
