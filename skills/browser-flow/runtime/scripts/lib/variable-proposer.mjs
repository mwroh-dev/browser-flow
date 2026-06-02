/**
 * Deterministic variable proposer.
 *
 * LLM 기반 의미 추론 (variable-agent sub-skill) 이 wired in되기 전
 * 같은 입력/출력 인터페이스로 결정적 휴리스틱을 제공해서
 * (i) 분석 시점에 즉시 동작 가능 + (ii) LLM 추론 결과의 baseline 비교 가능.
 *
 * 휴리스틱:
 *   - 각 fill step (action === "fill") 마다 1개 후보 input 제안
 *   - 빈 value 이고 secret 도 아니면 skip (변수화할 의미 없음)
 *   - name 우선순위: step.fieldName (sanitized) > "input<idx>"
 *   - type:
 *       step.secret === true → "secret"
 *       value 가 path-like (/, \\, ./, ../, .pdf 등) → "path"
 *       그 외 → "text"
 *   - 중복 name 자동 -1, -2 ... suffix
 */

/**
 * @typedef {{
 *   proposals: Array<{ name: string, label: string, suggestedFrom: number, type: "text" | "path" | "secret" }>,
 *   stepValueRefs: Array<{ stepIndex: number, valueRef: string }>
 * }} ProposerResult
 */

/**
 * @param {{ steps?: Array<{ action?: string, selector?: string, value?: string, secret?: boolean, fieldName?: string }> }} workflow
 * @returns {ProposerResult}
 */
export function proposeInputs(workflow) {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  /** @type {Array<{ name: string, label: string, suggestedFrom: number, type: "text" | "path" | "secret" }>} */
  const proposals = [];
  /** @type {Array<{ stepIndex: number, valueRef: string }>} */
  const stepValueRefs = [];
  /** @type {Set<string>} */
  const usedNames = new Set();
  let counter = 0;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || step.action !== "fill") continue;
    const hasValue = typeof step.value === "string" && step.value.length > 0;
    const isSecret = step.secret === true;
    if (!hasValue && !isSecret) continue;

    const base = sanitizeName(step.fieldName) || `input${counter}`;
    counter += 1;
    const name = uniquifyName(base, usedNames);
    usedNames.add(name);

    const type = isSecret ? "secret" : (looksLikePath(step.value ?? "") ? "path" : "text");
    proposals.push({
      name,
      label: typeof step.fieldName === "string" && step.fieldName.length > 0 ? step.fieldName : name,
      suggestedFrom: i,
      type
    });
    stepValueRefs.push({ stepIndex: i, valueRef: `{{input.${name}}}` });
  }

  return { proposals, stepValueRefs };
}

/**
 * Apply a ProposerResult to a workflow (mutates in place: workflow.inputs
 * + per-step valueRef). Returns the same workflow for chaining.
 *
 * @template {{ steps: Array<Record<string, unknown>>, inputs?: unknown }} T
 * @param {T} workflow
 * @param {ProposerResult} result
 * @returns {T}
 */
export function applyProposalToWorkflow(workflow, result) {
  /** @type {Record<string, unknown>} */ (workflow).inputs = result.proposals;
  for (const { stepIndex, valueRef } of result.stepValueRefs) {
    const step = workflow.steps[stepIndex];
    if (step && typeof step === "object") {
      /** @type {Record<string, unknown>} */ (step).valueRef = valueRef;
    }
  }
  return workflow;
}

/**
 * @param {string | undefined} fieldName
 */
function sanitizeName(fieldName) {
  if (typeof fieldName !== "string" || fieldName.length === 0) return "";
  // Strip everything that isn't [a-zA-Z0-9_]. Leading digit gets an
  // `i` prefix so the result matches placeholderFor's pattern.
  const cleaned = fieldName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return "";
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `i_${cleaned}`;
}

/**
 * @param {string} base
 * @param {Set<string>} used
 */
function uniquifyName(base, used) {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

/**
 * @param {string} value
 */
function looksLikePath(value) {
  if (!value) return false;
  if (value.startsWith("/")) return true;
  if (value.startsWith("./") || value.startsWith("../")) return true;
  if (/^[A-Za-z]:\\/.test(value)) return true;
  if (/\.(pdf|docx?|txt|md|csv|json|ya?ml|html?|png|jpe?g|gif|svg|mp[34]|zip|gz|tar)$/i.test(value)) return true;
  return false;
}
