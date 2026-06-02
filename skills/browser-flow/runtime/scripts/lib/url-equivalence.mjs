/**
 * Normalize an absolute HTTP(S) URL for guarded equivalence comparison.
 *
 * V1 intentionally limits normalization to:
 * - lowercase scheme + host
 * - default port removal
 * - empty path canonicalized to "/"
 * - otherwise preserving path/query/hash as-is
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeHttpUrlForComparison(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return "";
  }
  try {
    const url = new URL(rawUrl);
    if (!isComparableHttpScheme(url.protocol)) {
      return rawUrl;
    }
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const port = stripDefaultPort(protocol, url.port);
    const pathname = url.pathname === "" ? "/" : url.pathname;
    return `${protocol}//${host}${port}${pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Compare two URL-like strings using HTTP(S) equivalence only when both sides
 * are absolute HTTP(S) URLs. Otherwise fall back to exact-string semantics.
 *
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function urlsEqForCompare(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }
  if (isAbsoluteComparableHttpUrl(actual) && isAbsoluteComparableHttpUrl(expected)) {
    return normalizeHttpUrlForComparison(actual) === normalizeHttpUrlForComparison(expected);
  }
  return actual === expected;
}

/**
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isAbsoluteComparableHttpUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return isComparableHttpScheme(url.protocol);
  } catch {
    return false;
  }
}

/**
 * @param {string} protocol
 * @returns {boolean}
 */
function isComparableHttpScheme(protocol) {
  return protocol === "http:" || protocol === "https:";
}

/**
 * @param {string} protocol
 * @param {string} port
 * @returns {string}
 */
function stripDefaultPort(protocol, port) {
  if (!port) return "";
  if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443")) {
    return "";
  }
  return `:${port}`;
}
