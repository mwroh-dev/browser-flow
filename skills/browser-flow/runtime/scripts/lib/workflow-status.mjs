/**
 * 작업 단위 state framework.
 *
 * 사용자 framing (2026-05-19 대화, paraphrase 금지):
 *   "lane 이든 phase 이든 결국은 각 과정마다 현재 state 을 보는것이
 *    잇어야한다 몇일 몇시에 요청한 작업에 대한 정보가 잇고 그안에는
 *    상태가 잇을테니까."
 *   "결국은 실패상태임에도 홀드가 된다는 상황등이라면 broken 상황으로
 *    해야지. 각 단계별로 우리는 정의를 해둘거니까"
 *
 * 4-state machine: pending → in-progress → (complete | broken),
 * broken → in-progress (resume).  complete은 terminal.  failed는
 * broken으로 통합 — 사용자 framing이 "실패 상태에서도 사용자가 액션
 * 가능하면 broken" 이라 별도 terminal failure state 두지 않음.
 *
 * Storage: 각 작업은 `artifacts/runs/<runId>/tasks/<kind>.json`.
 * `variable-extraction` 외 단계는 필요에 따라 추가 등록 (additive).
 */

export const TASK_STATUS = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in-progress",
  COMPLETE: "complete",
  BROKEN: "broken"
});

/** @type {Map<string, Set<string>>} */
const VALID_TRANSITIONS = new Map([
  [TASK_STATUS.PENDING, new Set([TASK_STATUS.IN_PROGRESS, TASK_STATUS.BROKEN])],
  [TASK_STATUS.IN_PROGRESS, new Set([TASK_STATUS.COMPLETE, TASK_STATUS.BROKEN])],
  [TASK_STATUS.BROKEN, new Set([TASK_STATUS.IN_PROGRESS])],
  [TASK_STATUS.COMPLETE, new Set()]
]);

/** @type {Set<string>} */
const VALID_STATUSES = new Set(Object.values(TASK_STATUS));

// Mirror the profile name pattern — same filesystem + shell
// safety constraints apply to task kind tokens.
const TASK_KIND_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

/**
 * @typedef {{
 *   kind: string,
 *   id: string,
 *   runId: string,
 *   requestedAt: string,
 *   updatedAt: string,
 *   status: string,
 *   context: Record<string, unknown>
 * }} TaskUnit
 */

/**
 * Create a new task unit in `pending` state.
 *
 * @param {{ kind: string, runId: string, context?: Record<string, unknown> }} options
 * @returns {TaskUnit}
 */
export function createTask({ kind, runId, context = {} }) {
  if (typeof kind !== "string" || !TASK_KIND_PATTERN.test(kind)) {
    throw new Error(`Invalid task kind "${kind}". Must match ${String(TASK_KIND_PATTERN)}.`);
  }
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("createTask requires a non-empty runId.");
  }
  const now = new Date().toISOString();
  return {
    kind,
    id: `${runId}-${kind}`,
    runId,
    requestedAt: now,
    updatedAt: now,
    status: TASK_STATUS.PENDING,
    context: { ...context }
  };
}

/**
 * @param {string} from
 * @param {string} to
 */
export function isValidTransition(from, to) {
  if (!VALID_STATUSES.has(from) || !VALID_STATUSES.has(to)) {
    return false;
  }
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? allowed.has(to) : false;
}

/**
 * Apply a state transition + optional context merge. Returns a new
 * task object (immutable input). Throws when the transition is
 * disallowed (callers must handle: invalid transition = programmer
 * bug, not user error).
 *
 * @param {TaskUnit} task
 * @param {string} newStatus
 * @param {Record<string, unknown> | null} [contextUpdate]
 * @returns {TaskUnit}
 */
export function transitionTask(task, newStatus, contextUpdate = null) {
  if (!isValidTransition(task.status, newStatus)) {
    throw new Error(
      `Invalid task status transition: "${task.status}" → "${newStatus}" (task ${task.id} kind ${task.kind}).`
    );
  }
  return {
    ...task,
    status: newStatus,
    updatedAt: new Date().toISOString(),
    context: contextUpdate ? { ...task.context, ...contextUpdate } : { ...task.context }
  };
}

/**
 * @param {TaskUnit | null | undefined} task
 */
export function isResumable(task) {
  return task != null && task.status === TASK_STATUS.BROKEN;
}

/**
 * @param {TaskUnit | null | undefined} task
 */
export function isTerminal(task) {
  return task != null && task.status === TASK_STATUS.COMPLETE;
}

/**
 * @param {TaskUnit | null | undefined} task
 */
export function isActive(task) {
  return task != null && task.status === TASK_STATUS.IN_PROGRESS;
}
