/**
 * @param {import("../cdp/browser-session.mjs").BrowserSession} session
 * @param {string} targetId
 */
export async function collectPageEvidence(session, targetId) {
  // stamp timestamp at collect-time so the raw page-evidence
  // (persisted at raw-page-evidence.json) carries capture-time ground
  // truth. Without this, sanitizeEvent fills event.timestamp with
  // Date.now() at sanitize-time, which differs between the live done
  // and `bf replay` and breaks deterministic re-execution comparison.
  const timestamp = Date.now();
  const sid = session.sessionManager.getSessionId(targetId);
  if (!sid) return [];

  const script = `
    (function() {
      function cleanText(text) {
        return String(text || "").replace(/\\s+/g, " ").trim().slice(0, 120);
      }
      return [...document.querySelectorAll("[data-bf-evidence], [role=status], [aria-live], h1, h2")]
        .slice(0, 12)
        .map((node) => {
          let selector = node.tagName.toLowerCase();
          if (node instanceof HTMLElement && node.dataset.bfEvidence) {
            selector = '[data-bf-evidence="' + node.dataset.bfEvidence + '"]';
          }
          return {
            type: "page-evidence",
            selector,
            text: cleanText(node.textContent),
            url: location.href
          };
        });
    })()
  `;

  /** @type {any} */
  const result = await session.client.send("Runtime.evaluate", {
    expression: script,
    returnByValue: true
  }, sid).catch(() => ({ result: { value: [] } }));

  const evidence = Array.isArray(result?.result?.value) ? result.result.value : [];
  return evidence.map((/** @type {any} */ entry) => ({ ...entry, timestamp }));
}
