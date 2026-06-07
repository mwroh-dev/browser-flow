import test from "node:test";
import assert from "node:assert/strict";
import { inferDataIntent } from "../../scripts/lib/data-intent.mjs";

test("inferDataIntent detects top headline list extraction", () => {
  const intent = inferDataIntent("go to economy news and check the top 5 headlines");

  assert.equal(intent?.kind, "list");
  assert.equal(intent?.itemName, "headline");
  assert.equal(intent?.limit, 5);
  assert.equal(intent?.dynamic, true);
  assert.equal(intent?.recommendedStop, "listing-page");
  assert.equal(intent?.schema.fields.some((field) => field.name === "title"), true);
});

test("inferDataIntent detects Korean top N headline request", () => {
  const intent = inferDataIntent("경제 섹션에서 상위 5개 헤드라인 뉴스 확인");

  assert.equal(intent?.kind, "list");
  assert.equal(intent?.limit, 5);
  assert.equal(intent?.itemName, "headline");
});

test("inferDataIntent detects current numeric value extraction", () => {
  const intent = inferDataIntent("오늘의 증시에서 코스피 수치 확인");

  assert.equal(intent?.kind, "value");
  assert.equal(intent?.itemName, "value");
  assert.equal(intent?.schema.fields[0].name, "label");
  assert.equal(intent?.schema.fields[1].name, "value");
});

test("inferDataIntent detects current price request in English", () => {
  const intent = inferDataIntent("open the market page and get the current price");

  assert.equal(intent?.kind, "value");
  assert.equal(intent?.dynamic, true);
  assert.equal(intent?.recommendedStop, "data-page");
});

test("inferDataIntent returns null for pure navigation request", () => {
  assert.equal(inferDataIntent("open the settings page"), null);
});
