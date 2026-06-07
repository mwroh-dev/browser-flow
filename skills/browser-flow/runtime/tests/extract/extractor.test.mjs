import test from "node:test";
import assert from "node:assert/strict";
import { runExtractor } from "../../scripts/extract/extractor.mjs";

const LISTING = `<!doctype html><html><body><ul class="list">
  <li class="item"><a class="title">First</a><span class="price">₩1,000</span></li>
  <li class="item"><a class="title">Second</a><span class="price">₩2,000</span></li>
</ul></body></html>`;

test("runExtractor extracts rows from a listing container", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.list > li.item",
    fields: [
      { name: "title", selector: "a.title", attribute: "textContent", required: true },
      { name: "price", selector: "span.price", attribute: "textContent" }
    ]
  };
  const out = runExtractor(LISTING, config);
  assert.equal(out.containerResolved, true);
  assert.equal(out.cardinality, 2);
  assert.deepEqual(out.rows[0], { title: "First", price: "₩1,000" });
  assert.equal(out.rows[1].title, "Second");
});

test("runExtractor reports containerResolved=false when container absent", () => {
  const config = { schemaVersion: 1, pageKey: "k", container: "ul.missing > li", fields: [{ name: "t", selector: "a" }] };
  const out = runExtractor(LISTING, config);
  assert.equal(out.containerResolved, false);
  assert.equal(out.cardinality, 0);
});

const ARTICLE = `<!doctype html><html><body><main>
  <h1 class="hd">Headline</h1><div class="body">Body text</div>
</main></body></html>`;

test("runExtractor extracts a single row when container is null", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: null,
    fields: [{ name: "title", selector: "h1.hd" }, { name: "body", selector: "div.body" }]
  };
  const out = runExtractor(ARTICLE, config);
  assert.equal(out.containerResolved, true);
  assert.equal(out.cardinality, 1);
  assert.equal(out.rows[0].title, "Headline");
  assert.equal(out.rows[0].body, "Body text");
});

test("runExtractor returns 0 rows when single-item required field missing", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: null,
    fields: [{ name: "title", selector: "h1.absent", required: true }]
  };
  const out = runExtractor(ARTICLE, config);
  assert.equal(out.cardinality, 0);
  assert.equal(out.containerResolved, true);
});

const FALLBACK = `<ul class="l"><li class="i">
  <a class="t">Item</a><span class="p2">₩29.99</span>
</li></ul>`;

test("runExtractor uses fallbackSelector when primary misses", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.l > li.i",
    fields: [{ name: "title", selector: "a.t" }, { name: "price", selector: "span.price", fallbackSelector: "span.p2" }]
  };
  const out = runExtractor(FALLBACK, config);
  assert.equal(out.rows[0].price, "₩29.99");
});

test("runExtractor applies parseFloat transform", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.l > li.i",
    fields: [{ name: "title", selector: "a.t" }, { name: "price", selector: "span.p2", transform: "parseFloat" }]
  };
  const out = runExtractor(FALLBACK, config);
  assert.equal(out.rows[0].price, 29.99);
});

const REDACTED = `<ul class="l"><li class="i">
  <a class="t">[redacted-email]</a><input class="v" value="<redacted-input-value>">
  <span class="ok">Visible</span>
</li></ul>`;

test("runExtractor never emits redacted markers (both [..] and <..> forms)", () => {
  const config = {
    schemaVersion: 1, pageKey: "k", container: "ul.l > li.i",
    fields: [
      { name: "email", selector: "a.t" },
      { name: "val", selector: "input.v", attribute: "value" },
      { name: "ok", selector: "span.ok" }
    ]
  };
  const out = runExtractor(REDACTED, config);
  assert.equal(/redacted-/.test(JSON.stringify(out.rows)), false);
  // the non-redacted field still extracts
  assert.equal(out.rows[0].ok, "Visible");
  assert.equal(out.rows[0].email, null);
  assert.equal(out.rows[0].val, null);
});
