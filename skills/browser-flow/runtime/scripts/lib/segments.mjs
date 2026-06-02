/**
 * Workflow segments[] 자동 분할.
 *
 * 사용자 결정 (2026-05-19 대화):
 *   segment 1차 경계 = page-node.
 *   middle layer (component/domain 통합) 는 1단계에서 코드 구조로
 *   박지 않음 — 한 page 안의 step 묶음은 평평한 list로.
 *
 * 알고리즘: workflow.steps[]를 순회하며 pageKey 가 변하는 지점에서
 * segment를 끊는다. 첫 step (goto)부터 시작, 같은 pageKey의 연속
 * step들은 한 segment.
 *
 * 산출 segments[] = [{ name?, range: [startIdx, endIdx], startPageKey, endPageKey }]
 *   - name 은 variable-agent가 부여 가능 (초기에는 빈 채로 시작)
 *   - range 는 [start, end] inclusive index
 *   - startPageKey === endPageKey (page-node 경계로만 자르므로)
 */

/**
 * @typedef {{
 *   name?: string,
 *   range: [number, number],
 *   startPageKey: string,
 *   endPageKey: string
 * }} WorkflowSegment
 */

/**
 * Split a workflow's steps[] into page-node-bounded segments.
 *
 * @param {{ steps?: Array<{ pageKey?: string, action?: string }> }} workflow
 * @returns {WorkflowSegment[]}
 */
export function segmentByPageNode(workflow) {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  if (steps.length === 0) {
    return [];
  }
  /** @type {WorkflowSegment[]} */
  const segments = [];
  let segmentStart = 0;
  let currentPageKey = stepPageKey(steps[0]);
  for (let i = 1; i < steps.length; i += 1) {
    const pageKey = stepPageKey(steps[i]);
    if (pageKey !== currentPageKey) {
      segments.push({
        range: [segmentStart, i - 1],
        startPageKey: currentPageKey,
        endPageKey: currentPageKey
      });
      segmentStart = i;
      currentPageKey = pageKey;
    }
  }
  segments.push({
    range: [segmentStart, steps.length - 1],
    startPageKey: currentPageKey,
    endPageKey: currentPageKey
  });
  return segments;
}

/**
 * @param {{ pageKey?: string } | null | undefined} step
 */
function stepPageKey(step) {
  if (!step || typeof step.pageKey !== "string") {
    return "";
  }
  return step.pageKey;
}
