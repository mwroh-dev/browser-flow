import test from "node:test";
import assert from "node:assert/strict";
import { deriveSemanticSlotForSignals } from "../../scripts/lib/semantic-slot.mjs";

test("deriveSemanticSlotForSignals identifies Naver home news slot", () => {
  const slot = deriveSemanticSlotForSignals({
    pageKey: "manual/www.naver.com",
    role: "link",
    name: "뉴스",
    href: "https://news.naver.com/"
  });
  assert.deepEqual(slot, {
    slotKey: "naver.home.service.news",
    targetPageKey: "manual/news.naver.com"
  });
});

test("deriveSemanticSlotForSignals identifies Naver economy section slot", () => {
  const slot = deriveSemanticSlotForSignals({
    pageKey: "manual/news.naver.com",
    role: "menuitem",
    name: "경제",
    href: "https://news.naver.com/section/101"
  });
  assert.deepEqual(slot, {
    slotKey: "naver.news.section.economy",
    targetPageKey: "manual/news.naver.com/section/101"
  });
});

test("deriveSemanticSlotForSignals returns null for ambiguous generic labels without matching page context", () => {
  const slot = deriveSemanticSlotForSignals({
    pageKey: "manual/example.com",
    role: "link",
    name: "뉴스",
    href: "https://news.example.com/"
  });
  assert.equal(slot, null);
});
