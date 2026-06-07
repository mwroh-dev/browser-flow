import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeHttpUrlForComparison,
  urlsEqForCompare
} from "../../scripts/lib/url-equivalence.mjs";

test("normalizeHttpUrlForComparison canonicalizes empty path, default ports, and scheme/host casing", () => {
  assert.equal(
    normalizeHttpUrlForComparison("HTTPS://Weather.NAVER.com:443"),
    "https://weather.naver.com/"
  );
  assert.equal(
    normalizeHttpUrlForComparison("http://Example.com:80/path?q=1#frag"),
    "http://example.com/path?q=1#frag"
  );
});

test("urlsEqForCompare treats slash-only HTTP differences as equal", () => {
  assert.equal(
    urlsEqForCompare("https://weather.naver.com/", "https://weather.naver.com"),
    true
  );
});

test("urlsEqForCompare treats default ports as equal", () => {
  assert.equal(
    urlsEqForCompare("https://example.com:443/path", "https://example.com/path"),
    true
  );
  assert.equal(
    urlsEqForCompare("http://example.com:80/path", "http://example.com/path"),
    true
  );
});

test("urlsEqForCompare preserves real path/query differences", () => {
  assert.equal(
    urlsEqForCompare("https://example.com/path", "https://example.com/other"),
    false
  );
  assert.equal(
    urlsEqForCompare("https://example.com/path?a=1", "https://example.com/path?a=2"),
    false
  );
});
