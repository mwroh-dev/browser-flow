import test from "node:test";
import assert from "node:assert/strict";
import { inferOrdinalListIntent } from "../../scripts/lib/ordinal-list-intent.mjs";

test("inferOrdinalListIntent detects a first headline item as dynamic list intent", () => {
  const result = inferOrdinalListIntent({
    type: "click",
    selector: ".news-list article:first-child a.headline",
    text: "Captured headline title",
    href: "/news/2026/05/story",
    role: "link",
    locator: { ordinal: 0, name: "Captured headline title" },
    ancestors: [
      { tag: "section", ariaLabel: "News" },
      { tag: "article", role: "listitem" }
    ]
  });

  assert.deepEqual(result, {
    kind: "dynamic-list-item",
    ordinal: 0,
    description: "current list item #1",
    titleAtCapture: "Captured headline title"
  });
});

test("inferOrdinalListIntent does not classify a fixed 증권 nav link", () => {
  const result = inferOrdinalListIntent({
    type: "click",
    selector: "nav a[href=\"/finance\"]",
    text: "증권",
    href: "/finance",
    role: "link",
    locator: { ordinal: 0, name: "증권", href: "/finance" },
    ancestors: [
      { tag: "header", role: "banner" },
      { tag: "nav", role: "navigation" }
    ]
  });

  assert.equal(result, null);
});

test("inferOrdinalListIntent does not classify Naver shortcut service links", () => {
  const result = inferOrdinalListIntent({
    type: "click",
    selector: "a",
    text: "뉴스",
    href: "https://news.naver.com/",
    role: "link",
    locator: {
      ordinal: 0,
      name: "뉴스",
      href: "https://news.naver.com/",
      structuralKey: "div>div>div>ul>li|a||link_service|뉴스"
    },
    ancestors: [
      { tag: "div", id: "shortcutArea", role: "navigation" },
      { tag: "ul" },
      { tag: "li" }
    ]
  });

  assert.equal(result, null);
});

test("inferOrdinalListIntent does not classify Naver section menu items", () => {
  const result = inferOrdinalListIntent({
    type: "click",
    selector: "a",
    text: "경제",
    href: "https://news.naver.com/section/101",
    role: "menuitem",
    locator: {
      ordinal: 0,
      name: "경제",
      href: "https://news.naver.com/section/101",
      structuralKey: "div>div>div>ul>li|a|role=menuitem|Nitem_link|경제"
    },
    ancestors: [
      { tag: "header", role: "banner" },
      { tag: "ul" },
      { tag: "li" }
    ]
  });

  assert.equal(result, null);
});

test("inferOrdinalListIntent still classifies Naver headline list items", () => {
  const result = inferOrdinalListIntent({
    type: "click",
    selector: "a",
    text: "홈플러스, 대형마트·온라인 매각 작업 착수",
    href: "https://n.news.naver.com/mnews/article/082/0001382262",
    role: "link",
    locator: {
      ordinal: 0,
      name: "홈플러스, 대형마트·온라인 매각 작업 착수",
      href: "https://n.news.naver.com/mnews/article/082/0001382262"
    },
    ancestors: [
      { tag: "ul", id: "_SECTION_HEADLINE_LIST_5yhbe" },
      { tag: "li" }
    ]
  });

  assert.deepEqual(result, {
    kind: "dynamic-list-item",
    ordinal: 0,
    description: "current list item #1",
    titleAtCapture: "홈플러스, 대형마트·온라인 매각 작업 착수"
  });
});

test("inferOrdinalListIntent does not classify a plain same-name article link", () => {
  const result = inferOrdinalListIntent({
    type: "click",
    selector: "[data-bf=\"article\"]",
    text: "지리",
    href: "/samename/geo",
    role: "link",
    locator: { ordinal: 1, name: "지리", href: "/samename/geo" },
    ancestors: [
      { tag: "body" },
      { tag: "main", role: "main" }
    ]
  });

  assert.equal(result, null);
});
