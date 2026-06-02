function hostFromPageKey(pageKey) {
  if (typeof pageKey !== "string" || !pageKey.startsWith("manual/")) return "";
  const parts = pageKey.split("/");
  return parts[1] || "";
}

function absoluteHref(pageKey, href) {
  if (typeof href !== "string" || href.length === 0) return "";
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith("/")) {
    const host = hostFromPageKey(pageKey);
    if (host) return `https://${host}${href}`;
  }
  return href;
}

function normalizedText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * @param {{
 *   pageKey?: string,
 *   role?: string,
 *   name?: string,
 *   text?: string,
 *   href?: string,
 *   structuralKey?: string
 * }} input
 */
export function deriveSemanticSlotForSignals(input) {
  const pageKey = input?.pageKey ?? "";
  const role = normalizedText(input?.role).toLowerCase();
  const name = normalizedText(input?.name || input?.text);
  const href = absoluteHref(pageKey, input?.href ?? "");
  const structuralKey = normalizedText(input?.structuralKey);

  if (
    pageKey === "manual/www.naver.com" &&
    role === "link" &&
    name === "뉴스" &&
    href === "https://news.naver.com/"
  ) {
    return { slotKey: "naver.home.service.news", targetPageKey: "manual/news.naver.com" };
  }

  if (
    pageKey === "manual/www.naver.com" &&
    role === "link" &&
    name === "증권" &&
    href === "https://finance.naver.com/"
  ) {
    return { slotKey: "naver.home.service.stock", targetPageKey: "manual/finance.naver.com" };
  }

  if (
    pageKey === "manual/news.naver.com" &&
    (role === "menuitem" || role === "link") &&
    name === "경제" &&
    href === "https://news.naver.com/section/101"
  ) {
    return { slotKey: "naver.news.section.economy", targetPageKey: "manual/news.naver.com/section/101" };
  }

  if (
    pageKey === "manual/finance.naver.com" &&
    role === "link" &&
    href.endsWith("/sise/sise_index.naver?code=KOSPI") &&
    (name.includes("코스피") || structuralKey.includes("코스피지수 상세보기"))
  ) {
    return {
      slotKey: "naver.finance.index.kospi.detail",
      targetPageKey: "manual/finance.naver.com/sise/sise_index.naver"
    };
  }

  return null;
}
