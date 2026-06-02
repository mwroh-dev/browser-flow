// Page-as-node — pageKey derivation.
//
// Pure function. Takes a raw URL + fixture name, returns a stable
// identifier for "the same page" across captures. The id is the
// dedup boundary in the page-node graph (knowledge/pages/<pageKey>/).
//
// Heuristic v1 — designed against bundled fixtures; may be refined
// against real-site URL patterns (Notion / GitHub / etc.).
//
// Steps:
// 1. Parse URL. On failure → "<invalid-url>".
// 2. Drop query string and fragment (session / user / temporary
//    state — not page identity).
// 3. Normalize ID-shaped pathname segments to `:id` placeholder.
//    Three patterns recognized:
//    - UUID: `[hex8]-[hex4]-[hex4]-[hex4]-[hex12]`
//    - Long numeric: `\d{6,}`
//    - Long opaque alphanumeric: `[A-Za-z0-9]{16,}` with no separator
// 4. Prefix with the fixture name. For `manual` fixture, prefix
//    with `manual/<hostname>` so different external sites don't
//    collide under the same fixture.
// 5. Normalize: lowercase, collapse repeated `/`, trim leading /
//    trailing `/`.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_NUMERIC_PATTERN = /^\d{6,}$/;
const LONG_OPAQUE_PATTERN = /^[A-Za-z0-9]{16,}$/;

/**
 * @param {string} segment
 * @returns {string}
 */
function normalizeIdSegment(segment) {
  if (UUID_PATTERN.test(segment)) return ":id";
  if (LONG_NUMERIC_PATTERN.test(segment)) return ":id";
  if (LONG_OPAQUE_PATTERN.test(segment)) return ":id";
  return segment.toLowerCase();
}

/**
 * Derive a stable pageKey for a captured URL.
 *
 * @param {string} rawUrl
 * @param {string} fixture
 * @returns {string}
 */
export function derivePageKey(rawUrl, fixture) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return "<invalid-url>";
  }
  if (rawUrl === "about:blank") {
    return `${fixture || "manual"}/about:blank`;
  }
  let pathname = "";
  let hostname = "";
  try {
    const parsed = new URL(rawUrl, "http://127.0.0.1");
    pathname = parsed.pathname || "/";
    hostname = parsed.hostname || "";
  } catch (urlError) {
    return "<invalid-url>";
  }

  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const normalizedSegments = segments.map(normalizeIdSegment);

  const safeFixture = (fixture || "manual").toLowerCase();
  const prefix = safeFixture === "manual" && hostname ? `manual/${hostname.toLowerCase()}` : safeFixture;
  const suffix = normalizedSegments.join("/");
  const composed = suffix ? `${prefix}/${suffix}` : prefix;

  return composed.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}
