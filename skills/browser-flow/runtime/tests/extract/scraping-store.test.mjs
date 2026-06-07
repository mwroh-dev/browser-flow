import test from "node:test";
import assert from "node:assert/strict";
import { writeScrapingKnowledge, readScrapingConfig, readGolden } from "../../scripts/extract/scraping-store.mjs";

/** @param {any} r */ const R = (r) => r;

const KEY = () => `manual/test.example/${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CONFIG = { schemaVersion: 1, pageKey: "x", container: "ul.l > li", fields: [{ name: "t", selector: "a" }] };
const GOLDEN = { cardinality: 3, sampleValues: [{ t: "First" }] };

test("readScrapingConfig returns null when none stored", () => {
  assert.equal(readScrapingConfig(KEY()), null);
});

test("writeScrapingKnowledge persists config + golden; readers return them", () => {
  const key = KEY();
  const res = writeScrapingKnowledge(key, { ...CONFIG, pageKey: key }, GOLDEN);
  assert.equal(res.written, true);
  const cfg = R(readScrapingConfig(key));
  assert.equal(cfg.pageKey, key);
  assert.equal(cfg.fields.length, 1);
  const g = R(readGolden(key));
  assert.equal(g.cardinality, 3);
  assert.equal(g.pageKey, key); // store stamps pageKey + capturedAt
  assert.equal(typeof g.capturedAt, "string");
});

test("writeScrapingKnowledge is first-write-wins (keeps existing without force)", () => {
  const key = KEY();
  writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "first" }, GOLDEN);
  const res = writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "second" }, GOLDEN);
  assert.equal(res.written, false);
  assert.equal(res.kept, true);
  assert.equal(R(readScrapingConfig(key)).container, "first");
});

test("writeScrapingKnowledge with force overwrites (heal-in-place path)", () => {
  const key = KEY();
  writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "first" }, GOLDEN);
  const res = writeScrapingKnowledge(key, { ...CONFIG, pageKey: key, container: "second" }, GOLDEN, { force: true });
  assert.equal(res.written, true);
  assert.equal(R(readScrapingConfig(key)).container, "second");
});
