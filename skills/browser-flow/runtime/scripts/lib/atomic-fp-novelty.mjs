/**
 * Atomic fp novelty 판정 ("처음 하는 패스" 시스템 정의).
 *
 * 사용자 framing (2026-05-19 대화, paraphrase 금지):
 *   "이것은 llm 의 역량이라는것 ... 너의 말로 치면 예를들어 100개
 *    이벤트가 잇는 1개의 패스가 있는데 2개를 바꿨을때 99개를 바꿨을때
 *    오리진과 같냐 다르냐를 따지면 어떤게 처음이지? ... 첫번째는
 *    atomic fp 에 1번도 등장하지 않은 것 즉, 페이지 a 에서 이벤트
 *    b,c,d 는 잇는데 이벤트 z가 등장했을때 혹은 새로운 페이지 단위가
 *    등장했을때 이경우는 무조건 새로 시작하는것이다."
 *
 * 시스템 정의:
 *   trigger 1 = workflow의 step 중 하나라도 atomic fp 가
 *     `knowledge/pages/<pageKey>/selectors.json` 에 1번도 등장 안 한
 *     새 selector 임.
 *   trigger 2 = workflow의 pageKey 중 하나라도 `knowledge/pages/`
 *     아래에 존재하지 않은 새 pageKey 임.
 *   둘 중 하나라도 발화 → isNewPath = true → variable-agent 무조건
 *   활성화.
 *   둘 다 발화 안 함 → isNewPath = false → variable-agent 자동 활성화
 *   안 함. 사용자가 필요하면 `bf vars --resume` 으로 수동 호출.
 *
 * fine-grained 의미적 같음/다름 판단 (100개 중 99개 같음) 은 LLM 영역.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readJson } from "./fs.mjs";
import { getPagesRoot, pagePaths } from "./config.mjs";

/**
 * @typedef {{
 *   isNewPath: boolean,
 *   newAtomicFps: Array<{ pageKey: string, selector: string }>,
 *   newPageKeys: string[]
 * }} NoveltyReport
 */

/**
 * Snapshot the current state of `knowledge/pages/` for later
 * novelty judgment. Useful when the caller wants to compare a
 * workflow against the *pre-compile* state — compile.mjs writes
 * page-nodes inside compileRun(), so by the time downstream code
 * could call judgeNovelty against the filesystem, the new
 * page-nodes already exist (false-negative for novelty).
 *
 * Walks the pages root recursively, recording every page-node dir
 * (directory containing selectors.json or meta.json) and its known
 * selector set.
 *
 * @returns {Map<string, Set<string>>}  Map<pageKey, Set<selector>>
 */
export function snapshotKnowledgePageNodes() {
  const root = getPagesRoot();
  /** @type {Map<string, Set<string>>} */
  const result = new Map();
  if (!existsSync(root)) {
    return result;
  }
  walkPageDirs(root, "", result);
  return result;
}

/**
 * @param {string} absDir
 * @param {string} relPageKey
 * @param {Map<string, Set<string>>} accumulator
 */
function walkPageDirs(absDir, relPageKey, accumulator) {
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  const selectorsPath = resolve(absDir, "selectors.json");
  const metaPath = resolve(absDir, "meta.json");
  const hasSelectors = existsSync(selectorsPath);
  const hasMeta = existsSync(metaPath);
  if (relPageKey && (hasSelectors || hasMeta)) {
    /** @type {Set<string>} */
    const selectorSet = new Set();
    if (hasSelectors) {
      try {
        const doc = /** @type {{ selectors?: Array<{ selector?: string }> }} */ (readJson(selectorsPath));
        if (doc && Array.isArray(doc.selectors)) {
          for (const entry of doc.selectors) {
            if (typeof entry?.selector === "string") {
              selectorSet.add(entry.selector);
            }
          }
        }
      } catch {
        // skip malformed selectors.json — page-node still counts as existing
      }
    }
    accumulator.set(relPageKey, selectorSet);
  }
  for (const name of entries) {
    if (name === "selectors.json" || name === "meta.json" || name === "neighbors.json" || name === "snapshots") {
      continue;
    }
    const childAbs = resolve(absDir, name);
    let childStat;
    try {
      childStat = statSync(childAbs);
    } catch {
      continue;
    }
    if (childStat.isDirectory()) {
      const childRel = relPageKey ? `${relPageKey}/${name}` : name;
      walkPageDirs(childAbs, childRel, accumulator);
    }
  }
}

/**
 * Judge whether the given workflow constitutes a new path.
 *
 * @param {{ steps?: Array<{ pageKey?: string, selector?: string, action?: string }> }} workflow
 * @param {Map<string, Set<string>> | null} [knownPageNodes]
 *   Optional pre-computed snapshot (from snapshotKnowledgePageNodes()).
 *   When null/omitted: filesystem-checked against current state of
 *   knowledge/pages/. When provided: compared against the snapshot
 *   (caller-supplied baseline, e.g. captured before compile wrote
 *   new page-nodes).
 * @returns {NoveltyReport}
 */
export function judgeNovelty(workflow, knownPageNodes = null) {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  /** @type {Set<string>} */
  const seenNewPageKeys = new Set();
  /** @type {string[]} */
  const newPageKeys = [];
  /** @type {Array<{ pageKey: string, selector: string }>} */
  const newAtomicFps = [];

  /** @type {(pageKey: string) => boolean} */
  const pageNodeExistsCheck = knownPageNodes
    ? (pageKey) => knownPageNodes.has(pageKey)
    : pageNodeExists;
  /** @type {(pageKey: string, selector: string) => boolean} */
  const selectorExistsCheck = knownPageNodes
    ? (pageKey, selector) => Boolean(knownPageNodes.get(pageKey)?.has(selector))
    : selectorExistsInPageNode;

  for (const step of steps) {
    const pageKey = typeof step?.pageKey === "string" ? step.pageKey : "";
    const selector = typeof step?.selector === "string" ? step.selector : "";
    const action = typeof step?.action === "string" ? step.action : "";
    if (!pageKey) {
      continue;
    }
    // Skip `goto` — it is a navigation pseudo-step (no element to fingerprint).
    if (action === "goto") {
      // still consider the pageKey for new-page detection
      if (!pageNodeExistsCheck(pageKey) && !seenNewPageKeys.has(pageKey)) {
        seenNewPageKeys.add(pageKey);
        newPageKeys.push(pageKey);
      }
      continue;
    }
    if (!pageNodeExistsCheck(pageKey)) {
      if (!seenNewPageKeys.has(pageKey)) {
        seenNewPageKeys.add(pageKey);
        newPageKeys.push(pageKey);
      }
      // also count the selector as new (no selectors.json exists yet)
      if (selector) {
        newAtomicFps.push({ pageKey, selector });
      }
      continue;
    }
    if (selector && !selectorExistsCheck(pageKey, selector)) {
      newAtomicFps.push({ pageKey, selector });
    }
  }

  return {
    isNewPath: newAtomicFps.length > 0 || newPageKeys.length > 0,
    newAtomicFps,
    newPageKeys
  };
}

/**
 * @param {string} pageKey
 */
function pageNodeExists(pageKey) {
  try {
    return existsSync(pagePaths(pageKey).pageDir);
  } catch {
    return false;
  }
}

/**
 * @param {string} pageKey
 * @param {string} selector
 */
function selectorExistsInPageNode(pageKey, selector) {
  try {
    const { selectorsPath } = pagePaths(pageKey);
    if (!existsSync(selectorsPath)) {
      return false;
    }
    const doc = /** @type {{ selectors?: Array<{ selector?: string }> }} */ (readJson(selectorsPath));
    if (!doc || !Array.isArray(doc.selectors)) {
      return false;
    }
    return doc.selectors.some((entry) => entry?.selector === selector);
  } catch {
    return false;
  }
}
