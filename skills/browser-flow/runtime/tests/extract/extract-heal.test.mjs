import test from "node:test";
import assert from "node:assert/strict";
import { parseExtractHealResult } from "../../scripts/lib/schemas.mjs";
import { getRunPaths } from "../../scripts/lib/config.mjs";

test("parseExtractHealResult: valid healed parses", () => {
  const r = parseExtractHealResult({
    schemaVersion: 1, runId: "x", pageKey: "k", status: "healed",
    extractorConfig: { container: "ul.l > li", fields: [{ name: "t", selector: "a" }] },
    golden: { cardinality: 3 }
  });
  assert.equal(r.status, "healed");
});

test("parseExtractHealResult: valid unrepairable parses", () => {
  const r = parseExtractHealResult({ schemaVersion: 1, runId: "x", pageKey: "k", status: "unrepairable", reason: "price field removed" });
  assert.equal(r.status, "unrepairable");
});

test("parseExtractHealResult: healed without extractorConfig throws", () => {
  assert.throws(() => parseExtractHealResult({ schemaVersion: 1, runId: "x", pageKey: "k", status: "healed" }), /extract-heal-result/);
});

test("parseExtractHealResult: unrepairable without reason throws", () => {
  assert.throws(() => parseExtractHealResult({ schemaVersion: 1, runId: "x", pageKey: "k", status: "unrepairable" }), /extract-heal-result/);
});

test("getRunPaths exposes extract-heal artifact paths", () => {
  const p = getRunPaths("demo");
  assert.match(p.extractHealRequestPath, /demo\/extract-heal-request\.json$/);
  assert.match(p.extractHealResultPath, /demo\/extract-heal-result\.json$/);
});

// --- command --------------------------------------------------------------
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { readScrapingConfig } from "../../scripts/extract/scraping-store.mjs";
import { runExtractHealCommand } from "../../scripts/commands/extract-heal.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
/** @param {any} r */ const RH = (r) => r;

test("runExtractHealCommand no --apply: returns the heal-request", async () => {
  const runId = `eh-read-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.extractHealRequestPath, { pageKey: "k", stepIndex: 1, expected: {}, observed: {}, snapshotsManifestPath: runPaths.snapshotsManifestPath, snapshotsDir: runPaths.snapshotsDir });
  const out = RH(await runExtractHealCommand({ runId }));
  assert.equal(out.extractHealRequest.pageKey, "k");
});

test("runExtractHealCommand --apply healed: force-writes durable config + verifies", async () => {
  const pageKey = `manual/heal.example/${Date.now()}`;
  const runId = `eh-apply-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(`<section class="new"><div class="card"><h3>Healed</h3></div></section>`)));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "u", timestamp: 1, filename: "001.html.gz" }] });
  writeJson(runPaths.extractHealRequestPath, { pageKey, stepIndex: 1, expected: { cardinality: 1 }, observed: { cardinality: 0, containerResolved: false }, snapshotsManifestPath: runPaths.snapshotsManifestPath, snapshotsDir: runPaths.snapshotsDir });
  writeJson(runPaths.extractHealResultPath, {
    schemaVersion: 1, runId, pageKey, status: "healed",
    extractorConfig: { container: "section.new > div.card", fields: [{ name: "title", selector: "h3", required: true }] },
    golden: { cardinality: 1, sampleValues: [{ title: "Healed" }] }
  });

  const out = RH(await runExtractHealCommand({ runId, applyPath: runPaths.extractHealResultPath }));
  assert.equal(out.status, "healed");
  assert.equal(out.verify.status, "data");
  assert.equal(out.verify.cardinality, 1);
  const cfg = RH(readScrapingConfig(pageKey));
  assert.equal(cfg.container, "section.new > div.card");
});

test("runExtractHealCommand --apply unrepairable: reports reason, no durable write", async () => {
  const pageKey = `manual/unrep.example/${Date.now()}`;
  const runId = `eh-unrep-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.extractHealRequestPath, { pageKey, stepIndex: 1, expected: {}, observed: {}, snapshotsManifestPath: runPaths.snapshotsManifestPath, snapshotsDir: runPaths.snapshotsDir });
  writeJson(runPaths.extractHealResultPath, { schemaVersion: 1, runId, pageKey, status: "unrepairable", reason: "price field removed from page" });
  const out = RH(await runExtractHealCommand({ runId, applyPath: runPaths.extractHealResultPath }));
  assert.equal(out.status, "unrepairable");
  assert.match(out.reason, /price field/);
  assert.equal(readScrapingConfig(pageKey), null);
});
