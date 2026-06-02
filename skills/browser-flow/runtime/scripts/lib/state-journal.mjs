/**
 * Write-ahead state journal — append-only JSONL ledger.
 *
 * AGENT-BLIND CONTRACT:
 *   Callers pass only segment indices, intents, status strings, created-artifact
 *   NAMES (not content), and observed URLs. NEVER pass secret values, credentials,
 *   session tokens, cookies, or any sensitive session state. This lib performs no
 *   redaction; it appends whatever is given verbatim. Artifact names used in
 *   `created[]` must be stable identifiers (e.g. note title, page key), not
 *   user data or secret values. URLs in `observedEndUrl` should be path-only or
 *   stripped of query-string tokens before passing.
 *
 * Design:
 *   - Append-only JSONL (one JSON object per line, terminated by "\n").
 *   - Each line carries a `ts` field (Date.now() ms).
 *   - `readJournal` folds all lines to the latest state per segmentIndex:
 *     later lines override earlier fields; `intent` is preserved from the
 *     first entry if absent in later ones.
 *   - No rewriting of the file: even `markStatus` appends a new line.
 *   - A partially-failed automation leaves "in-progress" entries readable
 *     for cleanup (dangling-artifact detection).
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * @typedef {Object} JournalEntry
 * @property {number} segmentIndex  - Which automation segment this event belongs to.
 * @property {string} [intent]      - Human-readable description of what the segment was about to do.
 * @property {string} status        - Lifecycle status: "in-progress" | "done" | "failed" | string.
 * @property {string[]} [created]   - Artifact NAMES (not content) created by this segment.
 * @property {string} [observedEndUrl] - The URL observed at segment completion (path-only recommended).
 * @property {string} [error]       - Error message if status is "failed".
 */

/**
 * Append one event line to the journal. Adds a `ts` timestamp automatically.
 *
 * @param {string} journalPath - Absolute path to the JSONL journal file.
 * @param {Omit<JournalEntry, never> & Record<string, unknown>} entry - Event data. Must include `segmentIndex` and `status`.
 */
export function appendEntry(journalPath, entry) {
  const line = { ts: Date.now(), ...entry };
  appendFileSync(journalPath, JSON.stringify(line) + "\n", "utf8");
}

/**
 * Append a status-update event. Does NOT rewrite the file — pure append.
 *
 * @param {string} journalPath - Absolute path to the JSONL journal file.
 * @param {number} segmentIndex - Which segment to update.
 * @param {string} status - New status value.
 * @param {{ created?: string[], observedEndUrl?: string, error?: string } & Record<string, unknown>} [extra] - Additional fields to merge.
 */
export function markStatus(journalPath, segmentIndex, status, extra = {}) {
  const line = { ts: Date.now(), segmentIndex, status, ...extra };
  appendFileSync(journalPath, JSON.stringify(line) + "\n", "utf8");
}

/**
 * Read and fold all lines to the latest state per segmentIndex.
 * Later events override earlier fields; `intent` is preserved from the
 * first entry if a later event omits it.
 *
 * @param {string} journalPath - Absolute path to the JSONL journal file.
 * @returns {any[]} Array of folded JournalEntry objects sorted by segmentIndex (ascending).
 */
export function readJournal(journalPath) {
  if (!existsSync(journalPath)) {
    return [];
  }

  const raw = readFileSync(journalPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  /** @type {Map<number, Record<string, unknown>>} */
  const bySegment = new Map();

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip malformed lines (crash-interrupted writes).
      continue;
    }

    const idx = parsed.segmentIndex;
    if (typeof idx !== "number") continue;

    const existing = bySegment.get(idx);
    if (!existing) {
      bySegment.set(idx, { ...parsed });
    } else {
      // Later events override all fields — but preserve `intent` from the
      // earliest entry if the new event omits it.
      const preservedIntent = existing.intent;
      bySegment.set(idx, { ...existing, ...parsed });
      if (parsed.intent === undefined && preservedIntent !== undefined) {
        const merged = bySegment.get(idx);
        if (merged) merged.intent = preservedIntent;
      }
      if (parsed.status === "done" && parsed.error === undefined) {
        const merged = bySegment.get(idx);
        if (merged) delete merged.error;
      }
    }
  }

  return Array.from(bySegment.values()).sort(
    (a, b) => /** @type {number} */ (a.segmentIndex) - /** @type {number} */ (b.segmentIndex)
  );
}
