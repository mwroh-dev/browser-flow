/**
 * Deterministic gap detection. A question is "answered" if the operator
 * already provided it in knownAnswers, OR the raw request text matches the
 * question's detectInRawRequest regex (case-insensitive). Otherwise it is
 * "missing" and must be asked. No LLM here — the deterministic pipeline
 * stays LLM-free (LLM refinement is the offline spec-agent sub-skill).
 *
 * @param {Array<{ id: string, detectInRawRequest?: string, requiredWhen?: string }>} questions
 * @param {string} rawRequest
 * @param {Record<string, unknown>} knownAnswers
 * @returns {{ answered: string[], missing: string[] }}
 */
export function detectGaps(questions, rawRequest, knownAnswers) {
  const raw = String(rawRequest ?? "");
  const isExternalTarget = isExternalTargetRequest(raw);
  const answered = [];
  const missing = [];
  for (const q of questions) {
    if (knownAnswers && Object.prototype.hasOwnProperty.call(knownAnswers, q.id)) {
      answered.push(q.id);
      continue;
    }
    if (q.requiredWhen === "external-target") {
      if (isExternalTarget) {
        missing.push(q.id);
      }
      continue;
    }
    const pattern = q.detectInRawRequest;
    if (pattern && new RegExp(pattern, "i").test(raw)) {
      answered.push(q.id);
    } else {
      missing.push(q.id);
    }
  }
  return { answered, missing };
}

/**
 * @param {string} raw
 */
function isExternalTargetRequest(raw) {
  const text = String(raw ?? "");
  if (/\bnotion\b|\bnotebooklm\b|\bnaver\b|\bgmail\b|\bexternal\b|--unmasked/i.test(text)) {
    return true;
  }
  if (/\bgoogle keep\b|keep\.google\.com/i.test(text)) {
    return true;
  }
  const urlMatches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const urlText of urlMatches) {
    try {
      const host = new URL(urlText).hostname.toLowerCase();
      if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
