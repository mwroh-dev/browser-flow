import test from "node:test";
import assert from "node:assert/strict";
import { parseScrapeResult } from "../../scripts/lib/schemas.mjs";

const EXTRACTED = {
  schemaVersion: 1, runId: "x", stepIndex: 2, status: "extracted", pageType: "listing",
  extractorConfig: { container: "ul.l > li", fields: [{ name: "title", selector: "a.t", required: true }] },
  golden: { cardinality: 3, sampleValues: [{ title: "A" }] },
  pagination: { kind: "none" }
};

test("parseScrapeResult: valid extracted result parses", () => {
  const r = parseScrapeResult(EXTRACTED);
  assert.equal(r.status, "extracted");
  assert.equal(r.extractorConfig?.fields.length, 1);
});

test("parseScrapeResult: valid no-schema result parses", () => {
  const r = parseScrapeResult({ schemaVersion: 1, runId: "x", stepIndex: 2, status: "no-schema", reason: "no reliable selectors" });
  assert.equal(r.status, "no-schema");
});

test("parseScrapeResult: extracted without extractorConfig throws", () => {
  assert.throws(() => parseScrapeResult({ schemaVersion: 1, runId: "x", stepIndex: 2, status: "extracted" }), /scrape-result/);
});

test("parseScrapeResult: no-schema without reason throws", () => {
  assert.throws(() => parseScrapeResult({ schemaVersion: 1, runId: "x", stepIndex: 2, status: "no-schema" }), /scrape-result/);
});

test("parseScrapeResult: bad schemaVersion throws", () => {
  assert.throws(() => parseScrapeResult({ ...EXTRACTED, schemaVersion: 2 }), /scrape-result/);
});
