/**
 * Variable-agent interaction module.
 *
 * 사용자 framing (2026-05-19 대화, paraphrase 금지):
 *   "0개 일수잇지만 그거에 대해선 사용자와 합의가 되어야함. 그러니
 *    무조건 처음 하는 패스라면 물어봐야함."
 *
 * 책임: 사용자에게 *각* 제안 후보에 대해 yes / no / 새 이름 받기.
 * answers 를 workflow 에 적용 (수락한 후보만 inputs[] 유지, 거부한
 * 후보는 valueRef 제거 → literal value 그대로 사용, 이름 변경하면
 * inputs[] entry + 모든 참조 valueRef 갱신).
 *
 * Ask source 는 injectable — 기본은 readline (TTY), 테스트는 scripted
 * answers 배열 주입.
 */

import { createInterface } from "node:readline";

/**
 * @typedef {(prompt: string) => Promise<string>} AskFn
 */

/**
 * @typedef {{
 *   originalName: string,
 *   decision: "accept" | "reject" | "rename",
 *   newName?: string
 * }} Decision
 */

/**
 * Build a readline-backed AskFn. Output goes to stderr so that
 * stdout JSON of `bf vars` stays parseable.
 *
 * @returns {{ ask: AskFn, close: () => void }}
 */
export function createReadlineAsk() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return {
    ask(prompt) {
      return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer)));
    },
    close() { rl.close(); }
  };
}

/**
 * Build a scripted AskFn that returns pre-queued answers in order.
 * Throws if the question count exceeds the queue. Used by tests.
 *
 * @param {string[]} answers
 * @returns {AskFn}
 */
export function createScriptedAsk(answers) {
  const queue = [...answers];
  let index = 0;
  return async function ask(_prompt) {
    if (index >= queue.length) {
      throw new Error(`Scripted ask exhausted at question #${index + 1} (queue length ${queue.length}).`);
    }
    const answer = queue[index];
    index += 1;
    return answer;
  };
}

/**
 * Walk workflow.inputs[] (proposals) + ask user about each.
 *
 * @param {{ workflow: { inputs?: Array<{ name: string, label?: string, suggestedFrom?: number, type: string }>, steps?: Array<{ value?: string, secret?: boolean }> }, ask: AskFn }} params
 * @returns {Promise<Decision[]>}
 */
export async function interactiveConfirm({ workflow, ask }) {
  const proposals = Array.isArray(workflow.inputs) ? workflow.inputs : [];
  /** @type {Decision[]} */
  const decisions = [];

  if (proposals.length === 0) {
    // "변수 후보 0개 — 합의 필요" — 사용자에게 0개 확인 받기.
    const answer = (await ask(
      "변수 후보 0개로 추론됨. (y) 0개로 확정 / (n) 다시 검토 필요 표시 / (a) 사용자가 명시적으로 추가할 변수 있음: "
    )).trim().toLowerCase();
    if (answer === "n") {
      // 사용자가 0개 결과 부정 → broken-state로 마킹 (재검토 필요)
      throw new ZeroProposalRejectedError();
    }
    // y / a / 빈 입력 → 0개 확정 (a 의 경우 후속 manual add는 향후 phase)
    return decisions;
  }

  for (let i = 0; i < proposals.length; i += 1) {
    const proposal = proposals[i];
    const stepIdx = typeof proposal.suggestedFrom === "number" ? proposal.suggestedFrom : -1;
    const step = stepIdx >= 0 ? workflow.steps?.[stepIdx] : null;
    const sample = step?.secret ? "(secret)" : (typeof step?.value === "string" ? step.value : "(unknown)");
    const prompt =
      `[${i + 1}/${proposals.length}] 변수 후보 "${proposal.name}" ` +
      `(type=${proposal.type}, step ${stepIdx}, sample="${sample}")\n` +
      `  사용하시겠습니까? (y=수락 / n=거부 / <새 이름>=이름 변경, default y): `;
    const raw = (await ask(prompt)).trim();
    if (raw === "" || raw.toLowerCase() === "y") {
      decisions.push({ originalName: proposal.name, decision: "accept" });
    } else if (raw.toLowerCase() === "n") {
      decisions.push({ originalName: proposal.name, decision: "reject" });
    } else {
      // 이름 변경 — 입력값을 새 이름으로
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,59}$/.test(raw)) {
        throw new Error(`Invalid rename "${raw}" for input "${proposal.name}". Must match /^[a-zA-Z_][a-zA-Z0-9_]{0,59}$/.`);
      }
      decisions.push({ originalName: proposal.name, decision: "rename", newName: raw });
    }
  }
  return decisions;
}

export class ZeroProposalRejectedError extends Error {
  constructor() {
    super("User rejected the 0-proposal verdict; manual variable specification required.");
    this.name = "ZeroProposalRejectedError";
  }
}

/**
 * Apply user decisions to workflow object (mutates in place).
 * - accept: input stays, step.valueRef stays
 * - reject: input removed, step.valueRef stripped (literal value preserved)
 * - rename: input.name + step.valueRef both updated to new name
 *
 * @param {{ inputs?: Array<{ name: string }>, steps?: Array<{ valueRef?: string }> }} workflow
 * @param {Decision[]} decisions
 * @returns {{ inputs?: Array<{ name: string }>, steps?: Array<{ valueRef?: string }> }}
 */
export function applyDecisions(workflow, decisions) {
  /** @type {Map<string, Decision>} */
  const byName = new Map();
  for (const d of decisions) {
    byName.set(d.originalName, d);
  }

  // Update inputs[] — keep accepted (possibly renamed), drop rejected.
  const inputs = Array.isArray(workflow.inputs) ? workflow.inputs : [];
  const newInputs = [];
  for (const input of inputs) {
    const d = byName.get(input.name);
    if (!d || d.decision === "reject") continue;
    if (d.decision === "rename" && d.newName) {
      newInputs.push({ ...input, name: d.newName });
    } else {
      newInputs.push(input);
    }
  }
  workflow.inputs = newInputs;

  // Update step.valueRef — rename or strip.
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  for (const step of steps) {
    if (!step || typeof step.valueRef !== "string") continue;
    const match = step.valueRef.match(/^\{\{\s*input\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/);
    if (!match) continue;
    const currentName = match[1];
    const d = byName.get(currentName);
    if (!d || d.decision === "reject") {
      delete step.valueRef;
    } else if (d.decision === "rename" && d.newName) {
      step.valueRef = `{{input.${d.newName}}}`;
    }
    // accept: leave as-is
  }

  return workflow;
}
