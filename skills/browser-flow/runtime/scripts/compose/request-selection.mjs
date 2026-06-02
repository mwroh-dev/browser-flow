/**
 * @typedef {{
 *   range: [number, number],
 *   startPageKey?: string,
 *   endPageKey?: string
 * }} ComposeSegment
 */

import { derivePageKey } from "../lib/page-key.mjs";

function effectiveSegments(sourceWorkflow) {
  const steps = Array.isArray(sourceWorkflow?.steps) ? sourceWorkflow.steps : [];
  if (Array.isArray(sourceWorkflow?.segments) && sourceWorkflow.segments.length > 0) {
    return /** @type {ComposeSegment[]} */ (sourceWorkflow.segments);
  }
  return steps.map((step, index) => ({
    range: [index, index],
    startPageKey: typeof step?.pageKey === "string" ? step.pageKey : "",
    endPageKey: typeof step?.pageKey === "string" ? step.pageKey : ""
  }));
}

function deriveStepTargetUrl(step, fixture) {
  if (!step || typeof step !== "object") return null;
  if (typeof step.expectUrl === "string" && /^https?:\/\//.test(step.expectUrl)) return step.expectUrl;
  if (typeof step.href === "string" && /^https?:\/\//.test(step.href)) return step.href;
  if (
    typeof step.href === "string" &&
    step.href.startsWith("/") &&
    fixture === "manual" &&
    typeof step.pageKey === "string" &&
    step.pageKey.startsWith("manual/")
  ) {
    const [, host] = step.pageKey.split("/");
    if (host) return `https://${host}${step.href}`;
  }
  if (typeof step.url === "string" && /^https?:\/\//.test(step.url)) return step.url;
  return null;
}

function deriveStepTargetPageKey(step, fixture) {
  const url = deriveStepTargetUrl(step, fixture);
  return url ? derivePageKey(url, fixture) : null;
}

function parseCountToken(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  if (/^\d+$/.test(token)) return Number(token);
  if (token === "한" || token === "하나" || token === "one") return 1;
  if (token === "두" || token === "둘" || token === "two") return 2;
  if (token === "세" || token === "셋" || token === "three") return 3;
  if (token === "네" || token === "넷" || token === "four") return 4;
  return null;
}

function parseOmitLastCount(request) {
  if (typeof request !== "string") return null;
  const text = request.trim().toLowerCase();
  let match = text.match(/마지막\s*(\d+|한|하나|두|둘|세|셋|네|넷)\s*개?(?:를)?\s*빼/);
  if (match) return parseCountToken(match[1]);
  match = text.match(/last\s+(\d+|one|two|three|four)\s+(?:step|steps|segment|segments|item|items).*(?:omit|drop|remove|exclude|without)/);
  if (match) return parseCountToken(match[1]);
  match = text.match(/(?:omit|drop|remove|exclude)\s+the\s+last\s+(\d+|one|two|three|four)/);
  if (match) return parseCountToken(match[1]);
  return null;
}

function parseKeepFirstCount(request) {
  if (typeof request !== "string") return null;
  const text = request.trim().toLowerCase();
  let match = text.match(/(\d+)\s*개만/);
  if (match) return parseCountToken(match[1]);
  match = text.match(/keep\s+(?:only\s+)?the\s+first\s+(\d+|one|two|three|four)/);
  if (match) return parseCountToken(match[1]);
  return null;
}

export function deriveDeterministicComposeDecision({ request, sourceWorkflow }) {
  const segments = effectiveSegments(sourceWorkflow);
  const segmentCount = segments.length;
  /** @type {number[] | undefined} */
  let preferredSegments;

  const omitLastCount = parseOmitLastCount(request);
  if (omitLastCount !== null && omitLastCount > 0 && segmentCount > omitLastCount) {
    preferredSegments = Array.from({ length: segmentCount - omitLastCount }, (_, index) => index);
  }

  const keepFirstCount = parseKeepFirstCount(request);
  if (
    preferredSegments === undefined &&
    keepFirstCount !== null &&
    keepFirstCount > 0 &&
    segmentCount > keepFirstCount
  ) {
    preferredSegments = Array.from({ length: keepFirstCount }, (_, index) => index);
  }

  return {
    schemaVersion: 1,
    requestIntent: {
      targetState: request,
      mustKeep: [],
      maySkip: [],
      requiresData: /(데이터|헤드라인|목록|list|extract|scrape|가져와|확인해)/i.test(request)
    },
    candidateHints: preferredSegments ? { preferredSegments } : {},
    notes: preferredSegments ? ["deterministic-selection"] : []
  };
}

export function selectComposeSteps(sourceWorkflow, decision) {
  const steps = Array.isArray(sourceWorkflow?.steps) ? sourceWorkflow.steps : [];
  const segments = effectiveSegments(sourceWorkflow);
  const preferredSegments = Array.isArray(decision?.candidateHints?.preferredSegments)
    ? [...new Set(
      decision.candidateHints.preferredSegments
        .filter((index) => Number.isInteger(index))
        .filter((index) => index >= 0 && index < segments.length)
    )].sort((a, b) => a - b)
    : [];

  if (preferredSegments.length === 0) {
    return {
      selectedSteps: steps,
      selectedSegmentIndexes: segments.map((_, index) => index),
      blockedReason: null
    };
  }

  /** @type {Array<Record<string, unknown>>} */
  const selectedSteps = [];
  let previousEndPageKey = null;
  let previousSegmentIndex = null;

  for (const segmentIndex of preferredSegments) {
    const segment = segments[segmentIndex];
    if (!segment) continue;
    const startPageKey = typeof segment.startPageKey === "string" ? segment.startPageKey : "";
    const previousSegment = previousSegmentIndex !== null ? segments[previousSegmentIndex] : null;
    const previousLastStep = previousSegment
      ? steps[previousSegment.range[1]]
      : null;
    const transitionTargetPageKey = deriveStepTargetPageKey(previousLastStep, sourceWorkflow?.fixture ?? "manual");
    const naturallyContinues = transitionTargetPageKey === startPageKey;
    if (selectedSteps.length > 0 && previousEndPageKey !== startPageKey && !naturallyContinues) {
      const bridgeStep = steps.find(
        (step) =>
          step &&
          typeof step === "object" &&
          step.action === "goto" &&
          typeof step.pageKey === "string" &&
          step.pageKey === startPageKey
      );
      if (!bridgeStep) {
        return {
          selectedSteps: [],
          selectedSegmentIndexes: preferredSegments,
          blockedReason: "graph_disconnect"
        };
      }
      selectedSteps.push(structuredClone(bridgeStep));
    }
    const [start, end] = segment.range;
    for (let stepIndex = start; stepIndex <= end; stepIndex += 1) {
      if (stepIndex >= 0 && stepIndex < steps.length) {
        selectedSteps.push(structuredClone(steps[stepIndex]));
      }
    }
    previousEndPageKey = typeof segment.endPageKey === "string" ? segment.endPageKey : startPageKey;
    previousSegmentIndex = segmentIndex;
  }

  return {
    selectedSteps,
    selectedSegmentIndexes: preferredSegments,
    blockedReason: null
  };
}
