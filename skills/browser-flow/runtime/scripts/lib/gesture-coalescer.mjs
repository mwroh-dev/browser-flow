/**
 * @param {Array<Record<string, any>>} events
 * @returns {{ events: Array<Record<string, any>>, ignored: Array<Record<string, any>> }}
 */
export function coalesceGestureClicks(events) {
  const output = [];
  const ignored = [];
  /** @type {Record<string, boolean[]>} */
  const actionDiffKeepQueues = { click: [] };
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (isActionDiff(event)) {
      const refType = String(event.refType || "");
      const keepQueue = actionDiffKeepQueues[refType];
      const keep = keepQueue && keepQueue.length > 0 ? keepQueue.shift() : true;
      if (!keep) {
        ignored.push({
          type: "coalesced-action-diff",
          reason: "same-gesture-ignored-click-transition",
          refType
        });
        continue;
      }
      output.push(event);
      continue;
    }
    if (!isClick(event)) {
      output.push(event);
      continue;
    }

    const group = [event];
    while (index + 1 < events.length && isClick(events[index + 1]) && isSameGestureClick(group[group.length - 1], events[index + 1])) {
      group.push(events[index + 1]);
      index += 1;
    }

    if (group.length === 1) {
      output.push(event);
      actionDiffKeepQueues.click.push(true);
      continue;
    }

    if (group.every((candidate) => isHiddenOrZeroBoxClick(candidate)) || group.some(hasVisibleTargetConflict)) {
      for (const candidate of group) {
        output.push(candidate);
        actionDiffKeepQueues.click.push(true);
      }
      continue;
    }

    const kept = pickMostActionable(group);
    output.push(kept);
    for (const candidate of group) {
      actionDiffKeepQueues.click.push(candidate === kept);
      if (candidate === kept) continue;
      ignored.push({
        type: "coalesced-click",
        reason: "same-gesture-less-actionable-target",
        keptSelector: String(kept.selector || kept.actionableSelector || ""),
        ignoredSelector: String(candidate.selector || candidate.actionableSelector || ""),
        gestureId: String(kept.gestureId || candidate.gestureId || ""),
        ignoredText: String(candidate.text || "")
      });
    }
  }
  return { events: output, ignored };
}

/**
 * @param {Record<string, any>} event
 */
function isClick(event) {
  return event && event.type === "click";
}

/**
 * @param {Record<string, any>} event
 */
function isActionDiff(event) {
  return event && event.type === "action-diff";
}

/**
 * @param {Record<string, any>} left
 * @param {Record<string, any>} right
 */
function isSameGestureClick(left, right) {
  if (left.gestureId && right.gestureId && left.gestureId === right.gestureId) {
    return true;
  }
  if (left.gestureId && right.gestureId) {
    return false;
  }
  const leftPoint = clickPoint(left);
  const rightPoint = clickPoint(right);
  if (!leftPoint || !rightPoint) {
    return false;
  }
  const dt = Math.abs(Number(right.timestamp || 0) - Number(left.timestamp || 0));
  const distance = Math.hypot(leftPoint.x - rightPoint.x, leftPoint.y - rightPoint.y);
  return distance <= 4 && dt <= 250;
}

/**
 * @param {Record<string, any>} event
 */
function clickPoint(event) {
  if (typeof event.clickX === "number" && typeof event.clickY === "number") {
    return { x: event.clickX, y: event.clickY };
  }
  if (event.coords && typeof event.coords.x === "number" && typeof event.coords.y === "number") {
    return { x: event.coords.x, y: event.coords.y };
  }
  return null;
}

/**
 * @param {Array<Record<string, any>>} group
 */
function pickMostActionable(group) {
  let best = group[0];
  let bestScore = actionabilityScore(best);
  for (const event of group.slice(1)) {
    const score = actionabilityScore(event);
    if (score > bestScore) {
      best = event;
      bestScore = score;
    }
  }
  return best;
}

/**
 * @param {Record<string, any>} event
 */
function actionabilityScore(event) {
  const selector = String(event.selector || "");
  const actionableSelector = String(event.actionableSelector || "");
  const role = String(event.role || event.locator?.role || "").toLowerCase();
  const text = String(event.text || event.name || event.locator?.name || "").trim();
  let score = 0;
  if (hasVisibleGeometry(event)) score += 6;
  if (isHiddenOrZeroBoxClick(event)) score -= 8;
  if (event.href || event.locator?.href) score += 5;
  if (role === "link" || role === "button") score += 4;
  if (/^(a|button)\b|\[href=/.test(selector) || /^(a|button)\b|\[href=/.test(actionableSelector)) score += 3;
  if (actionableSelector && actionableSelector !== selector) score += 2;
  if (text) score += 1;
  return score;
}

/**
 * @param {Record<string, any>} event
 */
function hasVisibleGeometry(event) {
  if (event?.targetVisibility?.hasVisibleBox === true) return true;
  const box = event?.locator?.box;
  return Boolean(box && typeof box.w === "number" && typeof box.h === "number" && box.w > 0 && box.h > 0);
}

/**
 * @param {Record<string, any>} event
 */
function isHiddenOrZeroBoxClick(event) {
  if (!event || event.type !== "click") return false;
  if (event.targetVisibility?.hasVisibleBox === false) return true;
  const rawBox = event.targetVisibility?.rawBox ?? event.locator?.box;
  if (rawBox && typeof rawBox.w === "number" && typeof rawBox.h === "number") {
    return rawBox.w <= 0 || rawBox.h <= 0;
  }
  return false;
}

/**
 * @param {Record<string, any>} event
 */
function hasVisibleTargetConflict(event) {
  if (event?.isTrusted === false) return false;
  const visible = event?.visibleActionableAncestor || event?.visibleHitTarget;
  if (!visible || typeof visible !== "object") return false;
  const visibleSelector = String(visible.selector || "");
  const visibleName = String(visible.name || "");
  const actionableSelector = String(event.actionableSelector || event.selector || "");
  const text = String(event.text || event.locator?.name || "");
  return Boolean(
    (isUsableVisibleSignal(visibleSelector) && actionableSelector && visibleSelector !== actionableSelector) ||
    (isUsableVisibleSignal(visibleName) && text && !isRedactedSignal(text) && visibleName !== text)
  );
}

/**
 * @param {string} value
 */
function isUsableVisibleSignal(value) {
  return Boolean(value && !isRedactedSignal(value));
}

/**
 * @param {string} value
 */
function isRedactedSignal(value) {
  return value.startsWith("<redacted") || value.startsWith("[redacted");
}
