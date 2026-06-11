import { HIGH_ENTROPY_PATTERN, SECRET_FIELD_PATTERN, SECRET_HEADER_PATTERN } from "./patterns.mjs";
import { isAllowedLocalUrl } from "./local-only.mjs";
const SECRET_ASSIGNMENT_PATTERN = /["']?(password|passcode|secret|token|session|csrf|auth(?:orization)?|api[-_ ]?key)["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,}]+)/ig;

/**
 * Header-name redaction uses substring match (`SECRET_FIELD_PATTERN`)
 * rather than exact-match (`SECRET_HEADER_PATTERN`, anchored `^(...)$`)
 * to catch vendor-prefixed variants (`x-goog-api-key`, `x-google-auth-token`,
 * `x-aws-api-key`, etc.).
 *
 * `SECRET_HEADER_PATTERN` (and its source `SENSITIVE_HEADER_NAMES`)
 * are retained as documentation of canonical names; the function
 * switches its implementation.
 *
 * @param {string} name
 */
export function isSensitiveHeaderName(name) {
  return SECRET_FIELD_PATTERN.test(name) || SECRET_HEADER_PATTERN.test(name);
}

/**
 * @param {string} name
 */
export function isSensitiveFieldName(name) {
  return SECRET_FIELD_PATTERN.test(name);
}

/**
 * @param {string} value
 */
export function looksLikeSecretValue(value) {
  return value.length >= 24 && HIGH_ENTROPY_PATTERN.test(value);
}

/**
 * @param {string | undefined} rawText
 */
export function sanitizeText(rawText) {
  if (!rawText) {
    return "";
  }
  const collapsed = rawText.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "";
  }
  if (looksLikeSecretValue(collapsed)) {
    return "<redacted-secret>";
  }
  return collapsed.slice(0, 120);
}

/**
 * @param {string | undefined} rawText
 */
export function sanitizeEvidenceText(rawText) {
  const collapsed = sanitizeText(rawText);
  if (!collapsed) {
    return "";
  }
  if (findSemanticSecretAssignment(collapsed)) {
    return "<redacted-secret-text>";
  }
  return collapsed;
}

/**
 * @param {string | undefined} rawText
 */
export function findSemanticSecretAssignment(rawText) {
  if (!rawText) {
    return null;
  }
  const source = String(rawText);
  for (const match of source.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    const key = (match[1]?.toLowerCase() ?? "").replace(/[_\s]+/g, "-");
    const rawValue = match[2] ?? "";
    const normalizedValue = rawValue.replace(/^['"]|['"]$/g, "").trim();
    if (!normalizedValue) {
      continue;
    }
    const lowerValue = normalizedValue.toLowerCase();
    if (["true", "false", "null", "0", "1", "on", "off", "enabled", "disabled", "yes", "no"].includes(lowerValue)) {
      continue;
    }
    if (["password", "passcode", "secret"].includes(key)) {
      return match[0];
    }
    if (["token", "session", "csrf", "api-key", "auth", "authorization"].includes(key)) {
      return match[0];
    }
    if (/^(bearer|basic)\s+\S+/i.test(normalizedValue)) {
      return match[0];
    }
    if (looksLikeSecretValue(normalizedValue)) {
      return match[0];
    }
    if (normalizedValue.length >= 12) {
      return match[0];
    }
  }
  return null;
}

/**
 * @param {Record<string, string>} headers
 */
export function sanitizeHeaders(headers) {
  /** @type {Record<string, string>} */
  const sanitized = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHeaderName(name)) {
      continue;
    }
    sanitized[name] = sanitizeText(value);
  }
  return sanitized;
}

/**
 * `unmasked` option propagates the URL-boundary bypass (`--unmasked`
 * capture mode) to the sanitize layer. When `unmasked` is true, external
 * URLs are NOT collapsed to `<non-local-url>` — credential and
 * secret-named-query-param redaction still applies. This unblocks real-site
 * captures: compile.mjs receives real URLs as input to `derivePageKey`,
 * producing meaningful pageKeys instead of
 * `manual/127.0.0.1/%3cnon-local-url%3e`.
 *
 * Constitutional invariant #1 stays enforced at the persistence boundary
 * (registry upsert refuses workflow.security.localOnly=false).
 * The URL-boundary bypass is opt-in; it does NOT relax the
 * persistence-boundary block.
 *
 * @param {string} rawUrl
 * @param {{ unmasked?: boolean }} [options]
 */
export function sanitizeUrl(rawUrl, options = {}) {
  const unmasked = options.unmasked === true;
  try {
    const protocolRelative = rawUrl.startsWith("//");
    const relativePath = !protocolRelative && /^[/?.#]/.test(rawUrl);
    const url = protocolRelative
      ? new URL(`http:${rawUrl}`)
      : relativePath
        ? new URL(rawUrl, "http://127.0.0.1")
        : new URL(rawUrl);

    if (!relativePath && !unmasked && !isAllowedLocalUrl(url.toString())) {
      return "<non-local-url>";
    }

    url.username = "";
    url.password = "";
    for (const [name, value] of [...url.searchParams.entries()]) {
      if (isSensitiveFieldName(name) || looksLikeSecretValue(value)) {
        url.searchParams.set(name, "<redacted>");
      }
    }

    if (protocolRelative) {
      return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    }
    if (relativePath) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return "<unparseable-url>";
  }
}
