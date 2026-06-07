import test from "node:test";
import assert from "node:assert/strict";
import { scrapingPaths } from "../../scripts/lib/config.mjs";

test("scrapingPaths maps a pageKey to config + golden under the scraping root", () => {
  const p = scrapingPaths("manual/news.naver.com/section");
  assert.match(p.scrapingDir, /scraping\/manual\/news\.naver\.com\/section$/);
  assert.match(p.configPath, /manual\/news\.naver\.com\/section\/config\.json$/);
  assert.match(p.goldenPath, /manual\/news\.naver\.com\/section\/golden\.json$/);
});

test("scrapingPaths rejects an empty pageKey", () => {
  assert.throws(() => scrapingPaths(""), /pageKey/);
});
