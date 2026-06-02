/**
 * @param {string | undefined} rawUrl
 */
export function isAllowedLocalUrl(rawUrl) {
  if (!rawUrl || rawUrl === "about:blank") {
    return true;
  }
  if (rawUrl.startsWith("//")) {
    return false;
  }
  if (rawUrl.startsWith("/")) {
    return true;
  }

  try {
    const url = new URL(rawUrl);
    if (url.protocol === "file:" || url.protocol === "about:") {
      return true;
    }
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * @param {string | undefined} rawUrl
 * @param {string} label
 */
export function assertLocalUrl(rawUrl, label) {
  if (!isAllowedLocalUrl(rawUrl)) {
    throw new Error(`${label} must remain local-only. Received: ${rawUrl}`);
  }
}

/**
 * @param {{
 *   startUrl?: string,
 *   finalUrl?: string,
 *   steps?: Array<Record<string, unknown>>,
 *   verification?: {
 *     expectedFinalUrl?: string,
 *     expectedNetwork?: { url?: string } | null
 *   }
 * }} workflow
 */
export function assertLocalWorkflow(workflow) {
  assertLocalUrl(workflow.startUrl, "workflow.startUrl");
  assertLocalUrl(workflow.finalUrl, "workflow.finalUrl");
  for (const step of workflow.steps ?? []) {
    if (typeof step.url === "string") {
      assertLocalUrl(step.url, "workflow.step.url");
    }
    if (typeof step.expectUrl === "string") {
      assertLocalUrl(step.expectUrl, "workflow.step.expectUrl");
    }
    if (typeof step.href === "string") {
      assertLocalUrl(step.href, "workflow.step.href");
    }
  }
  assertLocalUrl(workflow.verification?.expectedFinalUrl, "workflow.verification.expectedFinalUrl");
  assertLocalUrl(workflow.verification?.expectedNetwork?.url, "workflow.verification.expectedNetwork.url");
}
