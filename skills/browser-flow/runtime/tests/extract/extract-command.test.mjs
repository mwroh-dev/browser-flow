import test from "node:test";
import assert from "node:assert/strict";
import { ensureRunDirs } from "../../scripts/lib/config.mjs";
import { writeJson, readJson } from "../../scripts/lib/fs.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { runExtractCommand } from "../../scripts/commands/extract.mjs";
import { writeScrapingKnowledge, readScrapingConfig, readGolden } from "../../scripts/extract/scraping-store.mjs";
import { readRegistry, upsertRegistryEntry } from "../../scripts/registry/workflow-registry.mjs";
import { SCHEMA_VERSIONS } from "../../scripts/lib/schema-versions.mjs";

/** @param {any} r */ const R = (r) => r;

test("runExtractCommand no --apply: emits scrape-request with the target schema", async () => {
  const runId = `extract-emit-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: "manual/x/list" }] });
  const schemaPath = join(mkdtempSync(join(tmpdir(), "schema-")), "schema.json");
  writeFileSync(schemaPath, JSON.stringify({ fields: [{ name: "title", description: "headline", required: true }] }));

  const out = R(await runExtractCommand({ runId, stepIndex: 1, schemaPath }));
  assert.equal(out.candidates[0].stepIndex, 1);
  assert.equal(out.candidates[0].pageKey, "manual/x/list");
  assert.equal(out.candidates[0].targetSchema.fields[0].name, "title");
  const req = R(readJson(runPaths.scrapeRequestPath));
  assert.equal(req.candidates[0].targetSchema.fields[0].name, "title");
});

test("runExtractCommand --apply: applies, runs against snapshot, writes extract-result (status data)", async () => {
  const runId = `extract-apply-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: "manual/x/list" }] });
  // capture snapshot for step 1
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001-list.html.gz"), gzipSync(Buffer.from(
    `<ul class="l"><li class="i"><a class="t">First</a></li><li class="i"><a class="t">Second</a></li></ul>`
  )));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "https://x/list", timestamp: 1, filename: "001-list.html.gz" }] });
  // the scrape-result the agent would have produced
  writeJson(runPaths.scrapeResultPath, {
    schemaVersion: 1, runId, stepIndex: 1, status: "extracted", pageType: "listing",
    extractorConfig: { container: "ul.l > li.i", fields: [{ name: "title", selector: "a.t", required: true }] },
    golden: { cardinality: 2, sampleValues: [{ title: "First" }] },
    pagination: { kind: "none" }
  });

  const out = R(await runExtractCommand({ runId, applyPath: runPaths.scrapeResultPath }));
  assert.equal(out.status, "data");
  assert.equal(out.cardinality, 2);
  // step.extraction reference written
  const wfOut = R(readJson(runPaths.workflowJsonPath));
  assert.equal(wfOut.steps[1].extraction.status, "extracted");
  assert.equal(wfOut.steps[1].extraction.pageKey, "manual/x/list");
  // run-scoped config + result artifacts written
  const cfg = R(readJson(runPaths.extractorConfigPath));
  assert.equal(cfg.pageKey, "manual/x/list");
  assert.equal(cfg.schemaVersion, 1);
  const res = R(readJson(runPaths.extractResultPath));
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].title, "First");
  assert.equal(Object.hasOwn(res, "dataResult"), false);
  assert.equal(Object.hasOwn(res, "dataResultPath"), false);
  const dataResult = R(readJson(runPaths.dataResultPath));
  assert.equal(dataResult.dataMode, "extract");
  assert.equal(dataResult.replayOutcome, "unknown");
  assert.equal(dataResult.dataOutcome, "data");
  assert.equal(dataResult.rowCount, 2);
  assert.equal(dataResult.rows[0].title, "First");
  assert.match(dataResult.summary.headline, /2 rows/);
});

test("runExtractCommand --apply updates public-read external registry data metadata", async () => {
  const runId = `extract-public-registry-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, {
    schemaVersion: 1,
    id: runId,
    startUrl: "https://news.example/list",
    finalUrl: "https://news.example/list",
    steps: [{ action: "goto" }, { action: "click", pageKey: "manual/news.example/list" }],
    security: {
      localOnly: false,
      installScope: "project-local",
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    }
  });
  writeJson(runPaths.verificationPath, {
    schemaVersion: SCHEMA_VERSIONS.verification,
    success: true,
    pathComplete: true,
    replayOutcome: "passed",
    executedSteps: [],
    stepCount: 0,
    transitionChecks: [],
    resultEvidence: { passed: true },
    verifiedAt: new Date().toISOString()
  });
  writeJson(runPaths.securityPath, {
    schemaVersion: SCHEMA_VERSIONS.security,
    ok: true,
    warningOnly: false,
    findings: []
  });
  upsertRegistryEntry({
    id: runId,
    fixture: "manual",
    runId,
    status: "replay_verified",
    startUrl: "https://news.example/list",
    finalUrl: "https://news.example/list",
    verificationPath: runPaths.verificationPath,
    securityPath: runPaths.securityPath,
    security: {
      localOnly: false,
      targetScope: "external",
      sanitizedArtifactsOnly: true,
      screenshotsPersisted: false
    },
    promotion: {
      scope: "external",
      approved: true,
      approvalSource: "auto-public-read",
      origins: ["https://news.example"],
      authMode: "none",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  });

  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001-list.html.gz"), gzipSync(Buffer.from(
    `<ul class="l"><li class="i"><a class="t">First</a></li><li class="i"><a class="t">Second</a></li></ul>`
  )));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "https://news.example/list", timestamp: 1, filename: "001-list.html.gz" }] });
  writeJson(runPaths.scrapeResultPath, {
    schemaVersion: 1, runId, stepIndex: 1, status: "extracted", pageType: "listing",
    extractorConfig: { container: "ul.l > li.i", fields: [{ name: "title", selector: "a.t", required: true }] },
    golden: { cardinality: 2, sampleValues: [{ title: "First" }] },
    pagination: { kind: "none" }
  });

  await runExtractCommand({ runId, applyPath: runPaths.scrapeResultPath });

  const saved = /** @type {Record<string, any> | undefined} */ (readRegistry().find((entry) => entry.id === runId));
  assert.equal(saved?.promotion?.dataMode, "extract");
  assert.equal(saved?.promotion?.dataResultPath, runPaths.dataResultPath);
  assert.equal(saved?.promotion?.dataOutcome, "data");
  assert.equal(saved?.promotion?.rowCount, 2);
});

test("runExtractCommand --apply no-schema: writes reference, no extraction run", async () => {
  const runId = `extract-apply-ns-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: "k" }] });
  writeJson(runPaths.scrapeResultPath, { schemaVersion: 1, runId, stepIndex: 1, status: "no-schema", reason: "no reliable selectors" });

  const out = R(await runExtractCommand({ runId, applyPath: runPaths.scrapeResultPath }));
  assert.equal(out.status, "no-schema");
  const wfOut = R(readJson(runPaths.workflowJsonPath));
  assert.equal(wfOut.steps[1].extraction.status, "no-schema");
});

test("runExtractCommand --apply persists durable config + golden by pageKey", async () => {
  const runId = `extract-durable-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  const pageKey = `manual/durable.example/${runId}`;
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001-list.html.gz"), gzipSync(Buffer.from(
    `<ul class="l"><li class="i"><a class="t">First</a></li><li class="i"><a class="t">Second</a></li></ul>`
  )));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "https://x/list", timestamp: 1, filename: "001-list.html.gz" }] });
  writeJson(runPaths.scrapeResultPath, {
    schemaVersion: 1, runId, stepIndex: 1, status: "extracted", pageType: "listing",
    extractorConfig: { container: "ul.l > li.i", fields: [{ name: "title", selector: "a.t", required: true }] },
    golden: { cardinality: 2, sampleValues: [{ title: "First" }] }, pagination: { kind: "none" }
  });

  const out = R(await runExtractCommand({ runId, applyPath: runPaths.scrapeResultPath }));
  assert.equal(out.status, "data");
  // durable knowledge persisted by pageKey
  const cfg = R(readScrapingConfig(pageKey));
  assert.equal(cfg.pageKey, pageKey);
  assert.equal(cfg.container, "ul.l > li.i");
  const g = R(readGolden(pageKey));
  assert.equal(g.cardinality, 2);
});

test("runExtractCommand --reuse: runs the durable config on a NEW run's snapshot (no agent)", async () => {
  const pageKey = `manual/reuse.example/${Date.now()}`;
  // seed durable knowledge (as if a prior flow established it)
  writeScrapingKnowledge(pageKey, { schemaVersion: 1, pageKey, container: "ul.l > li.i", fields: [{ name: "title", selector: "a.t", required: true }] }, { cardinality: 2, sampleValues: [{ title: "First" }] });

  // a fresh run that lands on the same page
  const runId = `extract-reuse-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(
    `<ul class="l"><li class="i"><a class="t">Alpha</a></li><li class="i"><a class="t">Beta</a></li><li class="i"><a class="t">Gamma</a></li></ul>`
  )));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "https://x/list", timestamp: 1, filename: "001.html.gz" }] });

  const out = R(await runExtractCommand({ runId, stepIndex: 1, reuse: true }));
  assert.equal(out.status, "data");
  assert.equal(out.cardinality, 3);
  assert.equal(out.rows[0].title, "Alpha");
  assert.equal(out.reused, true);
});

test("runExtractCommand --reuse throws when no durable config exists for the pageKey", async () => {
  const runId = `extract-reuse-miss-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey: `manual/missing/${runId}` }] });
  await assert.rejects(() => runExtractCommand({ runId, stepIndex: 1, reuse: true }), /no durable/);
});

test("runExtractCommand --reuse drift emits extract-heal-request", async () => {
  const pageKey = `manual/drift.example/${Date.now()}`;
  // durable config whose container is ABSENT in the new snapshot → drift
  writeScrapingKnowledge(pageKey, { schemaVersion: 1, pageKey, container: "ul.gone > li", fields: [{ name: "t", selector: "a", required: true }] }, { cardinality: 5, sampleValues: [{ t: "X" }] });
  const runId = `extract-drift-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(`<div class="other">no list here</div>`)));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [{ index: 1, url: "u", timestamp: 1, filename: "001.html.gz" }] });

  const out = R(await runExtractCommand({ runId, stepIndex: 1, reuse: true }));
  assert.equal(out.status, "drift");
  assert.equal(existsSync(runPaths.extractHealRequestPath), true);
  const req = R(readJson(runPaths.extractHealRequestPath));
  assert.equal(req.pageKey, pageKey);
  assert.equal(req.observed.containerResolved, false);
  assert.equal(req.expected.cardinality, 5);
  const res = R(readJson(runPaths.extractResultPath));
  assert.equal(Object.hasOwn(res, "dataResult"), false);
  assert.equal(Object.hasOwn(res, "dataResultPath"), false);
  const dataResult = R(readJson(runPaths.dataResultPath));
  assert.equal(dataResult.dataOutcome, "drift");
  assert.match(dataResult.summary.headline, /drift/i);
});

test("runExtractCommand --reuse --paged: extracts across all captured snapshots", async () => {
  const pageKey = `manual/paged.example/${Date.now()}`;
  writeScrapingKnowledge(pageKey, { schemaVersion: 1, pageKey, container: "ul.l > li.i", fields: [{ name: "t", selector: "a.t", required: true }] }, { cardinality: 2, sampleValues: [{ t: "A" }] });
  const runId = `extract-paged-${Date.now()}`;
  const runPaths = ensureRunDirs(runId);
  writeJson(runPaths.workflowJsonPath, { schemaVersion: 1, id: runId, steps: [{ action: "goto" }, { action: "click", pageKey }] });
  mkdirSync(runPaths.snapshotsDir, { recursive: true });
  const page = (/** @type {string[]} */ items) => `<ul class="l">${items.map((/** @type {string} */ x) => `<li class="i"><a class="t">${x}</a></li>`).join("")}</ul>`;
  writeFileSync(join(runPaths.snapshotsDir, "000.html.gz"), gzipSync(Buffer.from(page(["A", "B"]))));
  writeFileSync(join(runPaths.snapshotsDir, "001.html.gz"), gzipSync(Buffer.from(page(["C", "D", "E"]))));
  writeJson(runPaths.snapshotsManifestPath, { schemaVersion: 1, entries: [
    { index: 0, url: "u0", timestamp: 1, filename: "000.html.gz" },
    { index: 1, url: "u1", timestamp: 2, filename: "001.html.gz" }
  ] });

  const out = R(await runExtractCommand({ runId, stepIndex: 1, reuse: true, paged: true }));
  assert.equal(out.status, "data");
  assert.equal(out.pages, 2);
  assert.equal(out.cardinality, 5);
});
