import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { runExtractorPaged, readAllSnapshotsHtml } from "../../scripts/extract/pager.mjs";

const CONFIG = { container: "ul.l > li.i", fields: [{ name: "t", selector: "a.t", required: true }] };
/** @param {string[]} items */
const page = (items) => `<ul class="l">${items.map((/** @type {string} */ x) => `<li class="i"><a class="t">${x}</a></li>`).join("")}</ul>`;

test("runExtractorPaged concatenates rows across pages", () => {
  const out = runExtractorPaged([page(["A", "B"]), page(["C"]), page(["D", "E"])], CONFIG);
  assert.equal(out.pages, 3);
  assert.equal(out.cardinality, 5);
  assert.deepEqual(out.rows.map((r) => r.t), ["A", "B", "C", "D", "E"]);
});

test("readAllSnapshotsHtml gunzips every manifest entry in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "pager-"));
  const snapsDir = join(dir, "snapshots");
  mkdirSync(snapsDir, { recursive: true });
  writeFileSync(join(snapsDir, "000.html.gz"), gzipSync(Buffer.from(page(["A"]))));
  writeFileSync(join(snapsDir, "001.html.gz"), gzipSync(Buffer.from(page(["B"]))));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, entries: [
    { index: 0, url: "u0", timestamp: 1, filename: "000.html.gz" },
    { index: 1, url: "u1", timestamp: 2, filename: "001.html.gz" }
  ] }));
  const htmls = readAllSnapshotsHtml(manifestPath, snapsDir);
  assert.equal(htmls.length, 2);
  assert.match(htmls[0], />A</);
  assert.match(htmls[1], />B</);
});
