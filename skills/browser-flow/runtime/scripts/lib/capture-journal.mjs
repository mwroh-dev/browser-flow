import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sanitizeEvent } from "../sanitize/event-sanitizer.mjs";

/**
 * Build one append-only capture journal fact from an observed browser event.
 * The journal is intentionally low-judgment: it preserves ordering and
 * correlation fields, while redacting through the same sanitizer used for
 * persisted capture artifacts.
 *
 * @param {{
 *   source: "recorder" | "cdp" | "daemon",
 *   phase: "capture",
 *   event: Record<string, any>,
 *   unmasked?: boolean
 * }} input
 */
export function toJournalEvent(input) {
  const event = input.event && typeof input.event === "object" ? input.event : {};
  const sanitized = sanitizeEvent(/** @type {any} */ (event), { unmasked: input.unmasked === true });
  return {
    schemaVersion: 1,
    source: input.source,
    phase: input.phase,
    kind: journalKindForEvent(sanitized),
    recordedAt: new Date().toISOString(),
    ...sanitized
  };
}

/**
 * @param {string} journalPath
 * @param {Record<string, any>} entry
 */
export function appendJournalEvent(journalPath, entry) {
  mkdirSync(dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * @param {string} journalPath
 * @returns {Array<Record<string, any>>}
 */
export function readJournalEvents(journalPath) {
  if (!existsSync(journalPath)) return [];
  const text = readFileSync(journalPath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * @param {Record<string, any>} event
 */
function journalKindForEvent(event) {
  const type = String(event?.type || "");
  if (type === "action-window") return "action-window";
  if (type === "action-enrichment") return "enrichment";
  if (type === "click" || type === "input" || type === "submit") return "user-action";
  if (type === "action-diff") return "action-diff";
  if (type === "navigate") return "navigation";
  if (type.startsWith("network.")) return "network";
  if (type === "mutation" || type === "mutation.batch") return "mutation";
  if (type === "page-evidence") return "page-evidence";
  return "observation";
}
