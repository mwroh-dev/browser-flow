import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Raw artifact persistence. The observer-daemon records
 * every recorder + network event into `artifacts/runs/<run-id>/raw-events.jsonl`
 * as it arrives, so the raw capture survives even when `/done` later
 * fail-closes (security scan, sanitize crash, daemon abort). The
 * persistence boundary remains the registry-write site;
 * raw-events.jsonl stays inside `artifacts/` which is gitignored.
 *
 * One JSONL line per recorder/network event, append-only. Each line is
 * the unsanitized `RawEvent` shape from `scripts/sanitize/event-sanitizer.mjs`.
 * `bf replay <run-id>` consumes this file to re-execute
 * sanitize → done → analyze → generate → verify without re-driving the
 * browser.
 *
 * @typedef {import("../sanitize/event-sanitizer.mjs").RawEvent} RawEvent
 *
 * @typedef {{
 *   runId: string,
 *   rawEventsPath: string
 * }} RunPaths
 */

/**
 * Append a single raw event to the per-run jsonl. Sync write keeps
 * ordering deterministic and survives process crash mid-capture.
 *
 * @param {RunPaths} runPaths
 * @param {RawEvent} event
 */
export function appendRawEvent(runPaths, event) {
  mkdirSync(dirname(runPaths.rawEventsPath), { recursive: true });
  appendFileSync(runPaths.rawEventsPath, `${JSON.stringify(event)}\n`);
}

/**
 * Read the persisted raw event log for a run. Returns an empty array
 * when the file does not exist (capture never wrote any events). Used
 * by `bf replay` to re-feed sanitize/done without re-driving
 * the browser.
 *
 * @param {RunPaths} runPaths
 * @returns {RawEvent[]}
 */
export function readRawEventLog(runPaths) {
  if (!existsSync(runPaths.rawEventsPath)) {
    return [];
  }
  const contents = readFileSync(runPaths.rawEventsPath, "utf8");
  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}
