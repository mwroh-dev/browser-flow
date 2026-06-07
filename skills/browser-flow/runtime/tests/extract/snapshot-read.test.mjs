import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readSnapshotHtml } from "../../scripts/extract/snapshot-read.mjs";

/** @returns {{ manifestPath: string, snapsDir: string }} */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  const snapsDir = join(dir, "snapshots");
  mkdirSync(snapsDir, { recursive: true });
  writeFileSync(join(snapsDir, "000-root.html.gz"), gzipSync(Buffer.from("<html><body>root</body></html>")));
  writeFileSync(join(snapsDir, "002-list.html.gz"), gzipSync(Buffer.from("<html><body><ul><li>item</li></ul></body></html>")));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    entries: [
      { index: 0, url: "https://x/", timestamp: 1, filename: "000-root.html.gz" },
      { index: 2, url: "https://x/list", timestamp: 2, filename: "002-list.html.gz" }
    ]
  }));
  return { manifestPath, snapsDir };
}

test("readSnapshotHtml returns gunzipped HTML for an exact index", () => {
  const { manifestPath, snapsDir } = fixture();
  const html = readSnapshotHtml(manifestPath, snapsDir, 2);
  assert.match(html, /<li>item<\/li>/);
});

test("readSnapshotHtml falls back to nearest index <= stepIndex", () => {
  const { manifestPath, snapsDir } = fixture();
  const html = readSnapshotHtml(manifestPath, snapsDir, 1); // no index 1 → nearest below = 0
  assert.match(html, /root/);
});

test("readSnapshotHtml throws on empty manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "snap-empty-"));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, entries: [] }));
  assert.throws(() => readSnapshotHtml(manifestPath, dir, 0), /no snapshots/);
});
