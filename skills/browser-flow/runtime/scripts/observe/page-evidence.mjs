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
      function cssString(value) {
        return String(value || "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');
      }
      function cssIdent(value) {
        var text = String(value || "");
        return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(text) ? text : "";
      }
      function visibleContentNode(node) {
        if (!(node instanceof HTMLElement)) return false;
        var tag = node.tagName.toLowerCase();
        if (/^(script|style|template|noscript|head|meta|title|link)$/.test(tag)) return false;
        if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
        var text = cleanText(node.textContent);
        if (!text) return false;
        var style = getComputedStyle(node);
        if (!style || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
        if (style.opacity === "0") return false;
        var rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return true;
      }
      function interactiveControl(node) {
        var tag = node.tagName.toLowerCase();
        if (/^(a|button|input|select|textarea|option)$/.test(tag)) return true;
        var role = String(node.getAttribute("role") || "").toLowerCase();
        return /^(button|link|menuitem|option|checkbox|radio|switch|tab|textbox|combobox|searchbox)$/.test(role);
      }
      function semanticRegion(node) {
        var tag = node.tagName.toLowerCase();
        if (tag === "h1" || tag === "h2") return true;
        if (node.dataset && node.dataset.bfEvidence) return true;
        if (node.getAttribute("role") === "status") return true;
        if (node.hasAttribute("aria-live")) return true;
        if (interactiveControl(node)) return false;
        var label = [
          node.id || "",
          node.className || "",
          node.getAttribute("role") || ""
        ].join(" ").toLowerCase();
        return /\\b(details?|results?|status|summaries|summary|confirmations?|confirmed|complete|success|receipts?|prices?|costs?|totals?|messages?|outputs?)\\b/.test(label);
      }
      function selectorFor(node) {
        var tag = node.tagName.toLowerCase();
        if (node.dataset && node.dataset.bfEvidence) {
          return '[data-bf-evidence="' + cssString(node.dataset.bfEvidence) + '"]';
        }
        if (node.id) {
          var id = cssIdent(node.id);
          return id ? "#" + id : '[id="' + cssString(node.id) + '"]';
        }
        if (node.getAttribute("role") === "status") return '[role="status"]';
        if (node.hasAttribute("aria-live")) return "[aria-live]";
        if (node.className && typeof node.className === "string") {
          var classes = node.className.split(/\\s+/).filter(Boolean);
          var semantic = classes.find(function(name) {
            return /\\b(detail|result|status|summary|confirmation|confirmed|complete|success|receipt|price|cost|total|message|output)\\b/i.test(name);
          });
          var cls = cssIdent(semantic || classes[0] || "");
          if (cls) return "." + cls;
        }
        return tag;
      }
      var explicit = [
        "[data-bf-evidence]",
        "[role=status]",
        "[aria-live]",
        "h1",
        "h2"
      ].join(", ");
      var bounded = [
        '[id*="detail" i]',
        '[id*="result" i]',
        '[id*="status" i]',
        '[id*="summary" i]',
        '[id*="confirm" i]',
        '[id*="complete" i]',
        '[id*="success" i]',
        '[id*="receipt" i]',
        '[id*="price" i]',
        '[id*="cost" i]',
        '[class*="detail" i]',
        '[class*="result" i]',
        '[class*="status" i]',
        '[class*="summary" i]',
        '[class*="confirm" i]',
        '[class*="complete" i]',
        '[class*="success" i]',
        '[class*="receipt" i]',
        '[class*="price" i]',
        '[class*="cost" i]'
      ].join(", ");
      var elements = document.querySelectorAll(explicit + ", " + bounded);
      var results = [];
      for (var i = 0; i < elements.length && results.length < 24; i++) {
        var node = elements[i];
        if (visibleContentNode(node) && semanticRegion(node)) {
          results.push({
            type: "page-evidence",
            selector: selectorFor(node),
            text: cleanText(node.innerText || node.textContent),
            url: location.href
          });
        }
      }
      return results;
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
