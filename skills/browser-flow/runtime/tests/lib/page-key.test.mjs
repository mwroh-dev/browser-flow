import test from "node:test";
import assert from "node:assert/strict";
import { derivePageKey } from "../../scripts/lib/page-key.mjs";

// derivePageKey heuristic v1. These tests document the contract;
// real-site refinement happens against actual captures.

test("derivePageKey: bundled fixture root pages get fixture-prefixed pageKey", () => {
  assert.equal(derivePageKey("http://127.0.0.1:3000/synthetic", "synthetic"), "synthetic/synthetic");
  assert.equal(derivePageKey("http://127.0.0.1:3000/docs", "docs"), "docs/docs");
  assert.equal(derivePageKey("http://127.0.0.1:3000/stateful", "stateful"), "stateful/stateful");
});

test("derivePageKey: nested fixture pathnames preserve segment structure", () => {
  assert.equal(
    derivePageKey("http://127.0.0.1:3000/docs/catalog", "docs"),
    "docs/docs/catalog"
  );
  assert.equal(
    derivePageKey("http://127.0.0.1:3000/docs/detail/browser-flow", "docs"),
    "docs/docs/detail/browser-flow"
  );
});

test("derivePageKey: query string and fragment are dropped (same pageKey)", () => {
  const a = derivePageKey("http://127.0.0.1:3000/synthetic/result?name=Codex", "synthetic");
  const b = derivePageKey("http://127.0.0.1:3000/synthetic/result?name=Alice", "synthetic");
  const c = derivePageKey("http://127.0.0.1:3000/synthetic/result#section", "synthetic");
  assert.equal(a, b, "different query params must yield the same pageKey");
  assert.equal(a, c, "fragment must not affect pageKey");
});

test("derivePageKey: UUID segments are normalized to :id", () => {
  assert.equal(
    derivePageKey("http://example.com/notebook/d2b3c4a5-e6f7-1234-5678-9abcdef01234", "manual"),
    "manual/example.com/notebook/:id"
  );
});

test("derivePageKey: long numeric segments are normalized to :id", () => {
  assert.equal(
    derivePageKey("http://github.com/foo/bar/issues/123456", "manual"),
    "manual/github.com/foo/bar/issues/:id"
  );
  // Short numbers (< 6 digits) are NOT normalized — they are likely
  // pagination or status codes, not identifiers.
  assert.equal(
    derivePageKey("http://example.com/page/42", "manual"),
    "manual/example.com/page/42"
  );
});

test("derivePageKey: long opaque alphanumeric segments are normalized to :id", () => {
  assert.equal(
    derivePageKey("http://notion.so/notebook/abc123def456ghi7", "manual"),
    "manual/notion.so/notebook/:id"
  );
  // Short tokens are NOT normalized.
  assert.equal(
    derivePageKey("http://example.com/repo/foo-bar", "manual"),
    "manual/example.com/repo/foo-bar"
  );
});

test("derivePageKey: manual fixture without hostname falls back to plain manual prefix", () => {
  assert.equal(derivePageKey("about:blank", "manual"), "manual/about:blank");
});

test("derivePageKey: invalid input returns sentinel", () => {
  assert.equal(derivePageKey("", "synthetic"), "<invalid-url>");
  // @ts-expect-error — runtime tolerance for non-string input
  assert.equal(derivePageKey(null, "synthetic"), "<invalid-url>");
});

test("derivePageKey: cross-fixture isolation — different fixtures with same pathname produce different pageKeys", () => {
  const a = derivePageKey("http://127.0.0.1:3000/result", "synthetic");
  const b = derivePageKey("http://127.0.0.1:3000/result", "submit");
  assert.notEqual(a, b);
  assert.equal(a, "synthetic/result");
  assert.equal(b, "submit/result");
});
