/**
 * Select the browser target that represents the operator's final capture
 * context. CDP target ids are ephemeral and must not be persisted, but they are
 * safe to use in-memory for screenshot selection.
 *
 * @param {{
 *   targets: Array<{ targetId?: string, url?: string, liveUrl?: string }>,
 *   lastUserActionTargetId?: string,
 *   lastUserActionTabOrdinal?: number,
 *   lastRealNavigateTargetId?: string,
 *   finalUrl?: string,
 *   tabOrdinalForTarget?: (targetId: string) => number | undefined
 * }} input
 * @returns {{ targetId: string, tabOrdinal: number, targetUrl: string, reason: string } | null}
 */
export function selectCaptureFinalTarget(input) {
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const byId = new Map(targets.map((target) => [String(target.targetId || ""), target]));

  const fromLastAction = selectKnownTarget(
    byId,
    input.lastUserActionTargetId,
    "last-user-action",
    input.tabOrdinalForTarget,
    input.lastUserActionTabOrdinal
  );
  if (fromLastAction) return fromLastAction;

  const fromLastNavigation = selectKnownTarget(
    byId,
    input.lastRealNavigateTargetId,
    "last-real-navigation",
    input.tabOrdinalForTarget
  );
  if (fromLastNavigation) return fromLastNavigation;

  const finalUrl = normalizeComparableUrl(input.finalUrl);
  if (finalUrl) {
    const finalUrlTarget = targets.find((target) => normalizeComparableUrl(targetUrl(target)) === finalUrl);
    const selected = materializeTarget(finalUrlTarget, "final-url", input.tabOrdinalForTarget);
    if (selected) return selected;
  }

  const nonBlank = targets.find((target) => isNonBlankUrl(targetUrl(target)));
  const selectedNonBlank = materializeTarget(nonBlank, "non-blank-target", input.tabOrdinalForTarget);
  if (selectedNonBlank) return selectedNonBlank;

  return materializeTarget(targets[0], "first-target", input.tabOrdinalForTarget);
}

/**
 * @param {Map<string, { targetId?: string, url?: string, liveUrl?: string }>} byId
 * @param {string | undefined} targetId
 * @param {string} reason
 * @param {((targetId: string) => number | undefined) | undefined} tabOrdinalForTarget
 * @param {number | undefined} fallbackTabOrdinal
 */
function selectKnownTarget(byId, targetId, reason, tabOrdinalForTarget, fallbackTabOrdinal = undefined) {
  if (!targetId) return null;
  const target = byId.get(targetId);
  if (!target || !isNonBlankUrl(targetUrl(target))) return null;
  return materializeTarget(target, reason, tabOrdinalForTarget, fallbackTabOrdinal);
}

/**
 * @param {{ targetId?: string, url?: string, liveUrl?: string } | undefined} target
 * @param {string} reason
 * @param {((targetId: string) => number | undefined) | undefined} tabOrdinalForTarget
 * @param {number | undefined} fallbackTabOrdinal
 */
function materializeTarget(target, reason, tabOrdinalForTarget, fallbackTabOrdinal = undefined) {
  const targetId = String(target?.targetId || "");
  if (!targetId) return null;
  const tabOrdinal = tabOrdinalForTarget ? tabOrdinalForTarget(targetId) : undefined;
  return {
    targetId,
    tabOrdinal: typeof tabOrdinal === "number" ? tabOrdinal : fallbackTabOrdinal ?? 0,
    targetUrl: targetUrl(target),
    reason
  };
}

/**
 * @param {{ url?: string, liveUrl?: string } | undefined} target
 */
function targetUrl(target) {
  return String(target?.liveUrl || target?.url || "");
}

/**
 * @param {string | undefined} url
 */
function isNonBlankUrl(url) {
  const normalized = normalizeComparableUrl(url);
  return Boolean(normalized && normalized !== "about:blank");
}

/**
 * @param {string | undefined} url
 */
function normalizeComparableUrl(url) {
  return typeof url === "string" ? url.trim() : "";
}
