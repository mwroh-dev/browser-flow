/**
 * @param {Record<string, any>} event
 * @returns {{ kind: "dynamic-list-item", ordinal: number, description: string, titleAtCapture: string } | null}
 */
export function inferOrdinalListIntent(event) {
  if (!event || event.type !== "click") {
    return null;
  }
  const context = [
    event.selector,
    event.href,
    event.text,
    event.locator?.name,
    event.locator?.href,
    event.locator?.structuralKey,
    ...(Array.isArray(event.ancestors)
      ? event.ancestors.flatMap((ancestor) => [
          ancestor.tag,
          ancestor.id,
          ancestor.role,
          ancestor.ariaLabel,
          ancestor.dataBf,
          ancestor.dataTestid
        ])
      : [])
  ].filter(Boolean).join(" ").toLowerCase();

  const inNavigation = /\bnav\b|navigation/.test(context);
  const fixedNavigationSignal = /link_service|nitem_link|gnb_|shortcut|menuitem/.test(context);
  const strongListSignal = /\b(headline|list|listitem|feed)\b|section_headline_list/.test(context);
  const dynamicListSignal = /\b(news|headline|list|listitem|item|story|feed)\b/.test(context);
  const strongContentSignal = /\b(news|headline|story|feed)\b/.test(context);
  if (fixedNavigationSignal && !strongListSignal) {
    return null;
  }
  if (!dynamicListSignal || (inNavigation && !strongContentSignal)) {
    return null;
  }

  const rawOrdinal = event.locator && typeof event.locator.ordinal === "number" ? event.locator.ordinal : 0;
  const ordinal = Number.isInteger(rawOrdinal) && rawOrdinal >= 0 && rawOrdinal <= 20 ? rawOrdinal : 0;
  return {
    kind: "dynamic-list-item",
    ordinal,
    description: `current list item #${ordinal + 1}`,
    titleAtCapture: String(event.text || event.locator?.name || "")
  };
}
