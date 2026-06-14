const NOTICE_SEVERITIES = new Set(["info", "warning", "error"]);

/**
 * @typedef {{
 *   severity: "info" | "warning" | "error",
 *   code: string,
 *   message: string,
 *   suggestedCommands?: string[]
 * }} CliNotice
 */

/**
 * @param {unknown} result
 * @returns {result is Record<string, unknown>}
 */
function isPlainObject(result) {
  return result !== null && typeof result === "object" && Object.getPrototypeOf(result) === Object.prototype;
}

/**
 * @param {CliNotice} notice
 * @returns {CliNotice}
 */
export function normalizeCliNotice(notice) {
  if (!NOTICE_SEVERITIES.has(notice.severity)) {
    throw new Error(`Unknown CLI notice severity: ${notice.severity}`);
  }
  if (!notice.code) throw new Error("CLI notice requires code.");
  if (!notice.message) throw new Error("CLI notice requires message.");
  return {
    severity: notice.severity,
    code: notice.code,
    message: notice.message,
    ...(notice.suggestedCommands?.length ? { suggestedCommands: notice.suggestedCommands } : {})
  };
}

/**
 * @param {unknown} result
 * @param {CliNotice[]} notices
 * @returns {unknown}
 */
export function withCliNotices(result, notices) {
  if (notices.length === 0) return result;
  const normalized = notices.map(normalizeCliNotice);
  if (!isPlainObject(result)) {
    return { ok: true, value: result, notices: normalized };
  }
  const existing = Array.isArray(result.notices)
    ? result.notices.map((notice) => normalizeCliNotice(/** @type {CliNotice} */ (notice)))
    : [];
  return { ...result, notices: [...existing, ...normalized] };
}
