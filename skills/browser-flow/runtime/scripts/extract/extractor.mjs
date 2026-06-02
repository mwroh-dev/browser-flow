// Phase NNN: deterministic extractor core. Pure function — no LLM, no browser,
// no storage. Parses a (sanitized) HTML snapshot with cheerio and applies an
// ExtractorConfig to produce raw extraction facts. The 3-state verdict is the
// job of golden-probe.mjs; this module reports only what it observed.

import * as cheerio from "cheerio";

// Agent-blind safety hook (code, not prompt — multi-layered-safety-via-code):
// the sanitizer emits two redaction marker formats — `<redacted-input-value>`
// (attributes) and `[redacted-secret-text]` / `[redacted-email]` (text nodes).
// Never emit either as extracted data.
function isRedacted(/** @type {unknown} */ v) {
  return /[[<]redacted-/.test(String(v ?? ""));
}

/** @param {string} value @param {string|null} transform */
function applyTransform(value, transform) {
  switch (transform) {
    case "trim":
      return String(value).trim();
    case "parseInt": {
      const n = parseInt(String(value).replace(/[^\d-]/g, ""), 10);
      return Number.isNaN(n) ? null : n;
    }
    case "parseFloat": {
      const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
      return Number.isNaN(n) ? null : n;
    }
    default:
      return value;
  }
}

/**
 * @param {cheerio.Cheerio<any>} scope
 * @param {string} selector
 */
function selectFirst(scope, selector) {
  return scope.find(selector).first();
}

/**
 * @param {cheerio.Cheerio<any>} scope
 * @param {{ selector: string, attribute?: string, fallbackSelector?: string|null, transform?: string|null }} field
 * @returns {string|number|null}
 */
function readField(scope, field) {
  let node = selectFirst(scope, field.selector);
  if ((!node || node.length === 0) && field.fallbackSelector) {
    node = selectFirst(scope, field.fallbackSelector);
  }
  if (!node || node.length === 0) return null;
  const attr = field.attribute || "textContent";
  let raw = attr === "textContent" ? node.text() : node.attr(attr) || "";
  if (attr === "textContent") raw = raw.replace(/\s+/g, " ").trim();
  if (isRedacted(raw)) return null;
  return applyTransform(raw, field.transform || null);
}

/**
 * @param {Record<string, unknown>} row
 * @param {Array<{ name: string, required?: boolean }>} fields
 */
function rowIsKeepable(row, fields) {
  const requiredOk = fields
    .filter((f) => f.required)
    .every((f) => row[f.name] != null && row[f.name] !== "");
  const hasAny = fields.some((f) => row[f.name] != null && row[f.name] !== "");
  return requiredOk && hasAny;
}

/**
 * Run an extractor config against an HTML string.
 * @param {string} html
 * @param {{ container: string|null, fields: Array<{ name: string, selector: string, attribute?: string, required?: boolean, fallbackSelector?: string|null, transform?: string|null }> }} config
 * @returns {{ rows: Record<string, unknown>[], cardinality: number, containerResolved: boolean }}
 */
export function runExtractor(html, config) {
  const $ = cheerio.load(typeof html === "string" ? html : "");

  if (config.container === null || config.container === undefined) {
    /** @type {Record<string, unknown>} */
    const row = {};
    const scope = $.root();
    for (const field of config.fields) row[field.name] = readField(scope, field);
    const keep = rowIsKeepable(row, config.fields);
    return { rows: keep ? [row] : [], cardinality: keep ? 1 : 0, containerResolved: true };
  }

  const containers = $(config.container).toArray().map((element) => $(element));
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (const el of containers) {
    /** @type {Record<string, unknown>} */
    const row = {};
    for (const field of config.fields) row[field.name] = readField(el, field);
    if (rowIsKeepable(row, config.fields)) rows.push(row);
  }
  return { rows, cardinality: rows.length, containerResolved: containers.length > 0 };
}
