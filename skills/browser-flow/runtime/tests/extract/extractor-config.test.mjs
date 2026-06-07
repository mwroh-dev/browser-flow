import test from "node:test";
import assert from "node:assert/strict";
import { parseExtractorConfig } from "../../scripts/lib/schemas.mjs";

test("parseExtractorConfig accepts a valid listing config", () => {
  const config = {
    schemaVersion: 1,
    pageKey: "manual/example.com/list",
    container: "ul.list > li",
    fields: [{ name: "title", selector: "a.title", attribute: "textContent", required: true }]
  };
  const parsed = parseExtractorConfig(config);
  assert.equal(parsed.pageKey, "manual/example.com/list");
  assert.equal(parsed.fields.length, 1);
});

test("parseExtractorConfig accepts container=null (single-item)", () => {
  const config = {
    schemaVersion: 1,
    pageKey: "manual/example.com/article",
    container: null,
    fields: [{ name: "title", selector: "h1" }]
  };
  assert.equal(parseExtractorConfig(config).container, null);
});

test("parseExtractorConfig rejects empty fields", () => {
  const config = { schemaVersion: 1, pageKey: "k", container: null, fields: [] };
  assert.throws(() => parseExtractorConfig(config), /extractor-config/);
});

test("parseExtractorConfig rejects wrong schemaVersion", () => {
  const config = { schemaVersion: 99, pageKey: "k", container: null, fields: [{ name: "t", selector: "h1" }] };
  assert.throws(() => parseExtractorConfig(config));
});
