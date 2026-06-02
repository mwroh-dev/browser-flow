/**
 * @param {string | undefined} csv
 * @returns {string[]}
 */
export function normalizeOrigins(csv) {
  const origins = String(csv ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const url = new URL(item);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`external promotion origin must be http(s): ${item}`);
      }
      if (url.origin === "null") {
        throw new Error(`external promotion origin must not be opaque: ${item}`);
      }
      return url.origin;
    });
  return [...new Set(origins)];
}

const AUTH_MODES = new Set(["none", "login-required", "keychain-session", "attach", "persistent-profile"]);
const PROFILE_MODES = new Set(["ephemeral", "named-profile", "attached-browser"]);
const PRIVACY_LEVELS = new Set(["minimal", "profile", "full"]);
const SCREENSHOTS = new Set(["off", "allowed"]);
const DATA_MODES = new Set(["route", "extract", "mixed"]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function originForExternalUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin === "null") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function registrySafeUrl(value) {
  const origin = originForExternalUrl(value);
  if (origin) return origin;
  if (typeof value !== "string" || value.length === 0) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "<non-http-url>";
    }
    if (url.origin === "null") {
      return "<non-http-url>";
    }
  } catch {
    return value;
  }
  return value;
}

/**
 * @param {Record<string, any>} workflowLike
 * @returns {string[]}
 */
export function collectExternalWorkflowOrigins(workflowLike) {
  const values = [
    workflowLike.startUrl,
    workflowLike.finalUrl,
    workflowLike.verification?.expectedFinalUrl,
    workflowLike.verification?.expectedNetwork?.url
  ];
  if (Array.isArray(workflowLike.steps)) {
    for (const step of workflowLike.steps) {
      if (!step || typeof step !== "object") continue;
      values.push(step.url, step.expectedUrl, step.href);
      const transition = step.transition;
      if (transition && typeof transition === "object") {
        values.push(transition.url, transition.expectedUrl);
      }
    }
  }
  return [...new Set(values.map(originForExternalUrl).filter((origin) => typeof origin === "string"))];
}

/**
 * @param {Record<string, any>} workflowLike
 * @param {{ ok?: boolean, warningOnly?: boolean, findings?: Array<{ reason?: string }> }} security
 */
export function isPublicReadExternalWorkflow(workflowLike, security) {
  const workflowSecurity = workflowLike.security && typeof workflowLike.security === "object"
    ? workflowLike.security
    : {};
  const external = workflowSecurity.localOnly === false || workflowSecurity.targetScope === "external";
  if (!external || security?.ok !== true) return false;
  if (workflowSecurity.screenshotsPersisted === true) return false;
  if (Array.isArray(workflowLike.preconditions) && workflowLike.preconditions.length > 0) return false;
  if (workflowLike.safety?.consentRequired === true) return false;
  const findings = Array.isArray(security.findings) ? security.findings : [];
  return findings.every((finding) => finding.reason === "high entropy token candidate");
}

/**
 * @param {Record<string, any>} workflowLike
 * @param {{ ok?: boolean, warningOnly?: boolean, findings?: Array<{ reason?: string }> }} security
 * @param {{
 *   dataMode?: "route" | "extract" | "mixed",
 *   dataResultPath?: string,
 *   dataOutcome?: string,
 *   rowCount?: number
 * }} [data]
 */
export function buildPublicReadPromotion(workflowLike, security, data = {}) {
  if (!isPublicReadExternalWorkflow(workflowLike, security)) return null;
  const origins = collectExternalWorkflowOrigins(workflowLike);
  if (origins.length === 0) return null;
  const dataMode = data.dataMode ?? "route";
  return {
    scope: "external",
    approved: true,
    approvalSource: "auto-public-read",
    origins,
    authMode: "none",
    profileMode: "ephemeral",
    privacyLevel: "minimal",
    screenshots: "off",
    dataMode,
    warningOnly: security.warningOnly === true,
    findingsCount: Array.isArray(security.findings) ? security.findings.length : 0,
    ...(dataMode === "extract" || dataMode === "mixed"
      ? {
          dataResultPath: data.dataResultPath,
          dataOutcome: data.dataOutcome,
          rowCount: data.rowCount
        }
      : {})
  };
}

/**
 * @param {string[]} approvedOrigins
 * @param {Record<string, any>} workflowLike
 */
export function assertOriginsCoverWorkflow(approvedOrigins, workflowLike) {
  const approved = new Set(approvedOrigins);
  const missing = collectExternalWorkflowOrigins(workflowLike).filter((origin) => !approved.has(origin));
  if (missing.length > 0) {
    throw new Error(`promote external origins must include workflow origin(s): ${missing.join(", ")}.`);
  }
}

/**
 * @param {Record<string, any>} promotion
 */
function hasRequiredPolicyMetadata(promotion) {
  return AUTH_MODES.has(promotion.authMode)
    && PROFILE_MODES.has(promotion.profileMode)
    && PRIVACY_LEVELS.has(promotion.privacyLevel)
    && SCREENSHOTS.has(promotion.screenshots)
    && DATA_MODES.has(promotion.dataMode);
}

/**
 * @param {Record<string, any>} entry
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function classifyRegistryPromotion(entry) {
  const external = entry.security?.localOnly === false || entry.security?.targetScope === "external";
  if (!external) {
    return { ok: true };
  }

  if (entry.status !== "replay_verified") {
    return { ok: false, reason: "external_requires_replay_verified_status" };
  }
  const promotion = entry.promotion ?? {};
  if (promotion.scope !== "external" || promotion.approved !== true) {
    return { ok: false, reason: "external_requires_operator_approval" };
  }
  if (!Array.isArray(promotion.origins) || promotion.origins.length === 0) {
    return { ok: false, reason: "external_requires_allowed_origins" };
  }
  if (!hasRequiredPolicyMetadata(promotion)) {
    return { ok: false, reason: "external_requires_policy_metadata" };
  }
  if ((promotion.dataMode === "extract" || promotion.dataMode === "mixed")
    && (typeof promotion.dataResultPath !== "string"
      || typeof promotion.dataOutcome !== "string"
      || typeof promotion.rowCount !== "number")) {
    return { ok: false, reason: "external_requires_data_result" };
  }
  const approved = new Set(promotion.origins);
  const missing = collectExternalWorkflowOrigins(entry).filter((origin) => !approved.has(origin));
  if (missing.length > 0) {
    return { ok: false, reason: "external_origin_not_approved" };
  }
  return { ok: true };
}

/**
 * @param {string} reason
 * @param {string | number | symbol | undefined} id
 */
export function formatPromotionRefusal(reason, id) {
  return `registry: not promoted "${String(id ?? "unknown")}" — ${reason}.`;
}
