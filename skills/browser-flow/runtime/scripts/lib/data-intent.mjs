const LIST_WORDS = /\b(top|latest|current|headline(?:s)?|rows?|list|items?|table)\b|상위|최신|현재|헤드라인|목록|리스트|표|테이블|뉴스/u;
const VALUE_WORDS = /\b(value|price|quote|number|rate|index)\b|수치|가격|환율|지수|코스피|코스닥/u;
const ACTION_WORDS = /\b(check|read|get|collect|extract|show|list)\b|확인|조회|읽|수집|추출|보여/u;
const DYNAMIC_WORDS = /\b(current|today|latest|top)\b|현재|오늘|최신|상위/u;

/**
 * @typedef {{
 *   kind: "list" | "value",
 *   itemName: "headline" | "item" | "value",
 *   limit: number,
 *   dynamic: boolean,
 *   recommendedStop: "listing-page" | "data-page",
 *   schema: {
 *     fields: Array<{ name: string, type: "number" | "string", optional?: true }>,
 *     limit: number
 *   }
 * }} DataIntent
 */

/**
 * @param {string} text
 * @returns {DataIntent | null}
 */
export function inferDataIntent(text) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.toLowerCase();
  const limit = parseLimit(raw);
  const listIntent = LIST_WORDS.test(normalized) && ACTION_WORDS.test(normalized);
  const valueIntent = VALUE_WORDS.test(normalized) && ACTION_WORDS.test(normalized);
  const strongListShape =
    limit !== null ||
    /\bheadline(?:s)?\b|rows?|list|items?|table\b|헤드라인|목록|리스트|표|테이블|뉴스/u.test(normalized);

  if (valueIntent && !strongListShape) {
    return {
      kind: "value",
      itemName: "value",
      limit: 1,
      dynamic: DYNAMIC_WORDS.test(normalized),
      recommendedStop: "data-page",
      schema: {
        fields: [
          { name: "label", type: "string" },
          { name: "value", type: "string" },
          { name: "change", type: "string", optional: true }
        ],
        limit: 1
      }
    };
  }

  if (listIntent) {
    const itemName = /\bheadline(?:s)?\b|헤드라인|뉴스/u.test(normalized) ? "headline" : "item";
    const resolvedLimit = limit ?? 5;
    return {
      kind: "list",
      itemName,
      limit: resolvedLimit,
      dynamic: DYNAMIC_WORDS.test(normalized),
      recommendedStop: "listing-page",
      schema: {
        fields: [
          { name: "rank", type: "number" },
          { name: itemName === "headline" ? "title" : "text", type: "string" },
          { name: "url", type: "string" }
        ],
        limit: resolvedLimit
      }
    };
  }

  if (valueIntent) {
    return {
      kind: "value",
      itemName: "value",
      limit: 1,
      dynamic: DYNAMIC_WORDS.test(normalized),
      recommendedStop: "data-page",
      schema: {
        fields: [
          { name: "label", type: "string" },
          { name: "value", type: "string" },
          { name: "change", type: "string", optional: true }
        ],
        limit: 1
      }
    };
  }

  return null;
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function parseLimit(text) {
  const ascii = String(text).match(/\b(\d{1,2})\b/u);
  if (ascii) {
    return Number(ascii[1]);
  }
  const korean = String(text).match(/(\d{1,2})\s*개/u);
  if (korean) {
    return Number(korean[1]);
  }
  return null;
}
