// Phase NNN: read a captured snapshot's HTML for a given step. Snapshots are
// gzipped (`<index>-<slug>.html.gz`) under artifacts/runs/<id>/snapshots/, indexed
// by the snapshots-manifest. Matches the step by snapshot index: exact, else the
// nearest entry with index <= stepIndex, else the first entry.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { readJson } from "../lib/fs.mjs";

/**
 * @param {string} manifestPath
 * @param {string} snapshotsDir
 * @param {number} stepIndex
 * @returns {string}
 */
export function readSnapshotHtml(manifestPath, snapshotsDir, stepIndex) {
  const manifest = /** @type {{ entries?: Array<{ index: number, filename: string }> }} */ (readJson(manifestPath));
  const rawEntries = manifest && manifest.entries;
  const entries = Array.isArray(rawEntries) ? rawEntries : [];
  if (entries.length === 0) throw new Error("no snapshots in manifest");

  let entry = entries.find((e) => e.index === stepIndex);
  if (!entry) {
    const below = entries
      .filter((e) => typeof e.index === "number" && e.index <= stepIndex)
      .sort((a, b) => b.index - a.index);
    entry = below[0] || entries[0];
  }

  const file = resolve(snapshotsDir, entry.filename);
  const buf = readFileSync(file);
  return entry.filename.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}
