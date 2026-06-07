import test from "node:test";
import assert from "node:assert/strict";
import { scrapingPaths, pagePaths, validatePageKey } from "../../scripts/lib/config.mjs";

test("validatePageKey rejects traversal / absolute / url-like / backslash keys", () => {
  for (const bad of [
    "../../escape", "manual/../../escape", "manual\\escape", "/etc/passwd",
    "C:\\x", "http://evil.com/x", "", "manual/./x", "manual//x"
  ]) {
    assert.throws(() => validatePageKey(bad), /pageKey/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("validatePageKey accepts valid nested + derived keys", () => {
  for (const ok of [
    "manual/search-results", "manual/news.naver.com/section",
    "docs", "manual/about:blank", "<invalid-url>", "manual/example.com/post/:id"
  ]) {
    assert.equal(validatePageKey(ok), ok);
  }
});

test("scrapingPaths blocks traversal, keeps dir under scraping root", () => {
  assert.throws(() => scrapingPaths("../../escape"), /pageKey/);
  assert.throws(() => scrapingPaths("manual/../../escape"), /pageKey/);
  const p = scrapingPaths("manual/search-results");
  assert.match(p.scrapingDir, /scraping\/manual\/search-results$/);
});

test("pagePaths blocks traversal, keeps dir under pages root", () => {
  assert.throws(() => pagePaths("../../escape"), /pageKey/);
  const p = pagePaths("manual/search-results");
  assert.match(p.pageDir, /pages\/manual\/search-results$/);
});
