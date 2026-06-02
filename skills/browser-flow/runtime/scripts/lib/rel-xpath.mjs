/**
 * rel-xpath.mjs — Build a relative XPath anchored at the nearest stable ancestor.
 *
 * @param {Array<{
 *   tag: string,
 *   id?: string,
 *   dataBf?: string,
 *   dataTestid?: string,
 *   indexAmongTag?: number,
 *   sameTagSiblings?: number
 * }>|null|undefined} chain  Ordered top → target (outermost first, target last).
 * @returns {string}
 */
export function buildRelXPath(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return "";

  /**
   * Returns the stable-anchor XPath step for an entry, or null if unstable.
   * Priority: id > data-bf > data-testid.
   * @param {{ id?: string, dataBf?: string, dataTestid?: string }} entry
   * @returns {string|null}
   */
  function anchorStep(entry) {
    if (entry.id) return `//*[@id='${entry.id}']`;
    if (entry.dataBf) return `//*[@data-bf='${entry.dataBf}']`;
    if (entry.dataTestid) return `//*[@data-testid='${entry.dataTestid}']`;
    return null;
  }

  /**
   * Returns the positional step for an entry (tag or tag[n]).
   * Use [index] only when sameTagSiblings > 1.
   * @param {{ tag: string, indexAmongTag?: number, sameTagSiblings?: number }} entry
   * @returns {string}
   */
  function positionalStep(entry) {
    const tag = entry.tag;
    const siblings = entry.sameTagSiblings ?? 1;
    if (siblings > 1) {
      return `${tag}[${entry.indexAmongTag ?? 1}]`;
    }
    return tag;
  }

  // Scan from target (last) backward to find the nearest stable anchor.
  let anchorIdx = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (anchorStep(chain[i]) !== null) {
      anchorIdx = i;
      break;
    }
  }

  if (anchorIdx !== -1) {
    // Anchor found: start with anchor's stable step.
    const parts = [anchorStep(chain[anchorIdx])];
    // Append positional steps for everything after the anchor.
    for (let i = anchorIdx + 1; i < chain.length; i++) {
      parts.push(positionalStep(chain[i]));
    }
    return parts.join("/");
  }

  // No anchor: absolute-ish path from top using positional steps.
  return "//" + chain.map(positionalStep).join("/");
}
