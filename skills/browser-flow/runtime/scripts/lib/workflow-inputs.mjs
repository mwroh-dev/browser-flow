import { createHash } from "node:crypto";

/**
 * Workflow inputs[] 슬롯 + placeholder + binding.
 *
 * 사용자 framing (2026-05-19 대화, paraphrase 금지):
 *   "이 반복작업에서의 변수라고 지치하는 즉 변하는 것은 무엇인지를
 *    물어보는것이다. 그것이 결국 입력값이라고 생각한다."
 *
 * 데이터 모델:
 *   workflow.json에 inputs[] = [{ name, label, suggestedFrom, type }]
 *   각 step의 value 자리가 placeholder인 경우 step.valueRef = "{{input.X}}"
 *
 * binding 적용:
 *   bindInputs(workflow, { X: "actual value" }) → 치환된 workflow
 *   미바인딩 placeholder → throw (silent fallback 없음)
 *
 * type 셋: "text" | "path" | "secret".
 *   text — 일반 텍스트 입력
 *   path — 파일/디렉토리 경로 (시스템이 path-like validation 추가 가능, 1차에서는 hint만)
 *   secret — 비밀값 (binding 적용 시 env var 통해 받음, 평문 안 받음)
 *   확장은 사용 후 측정.
 */

/**
 * @typedef {{
 *   name: string,
 *   label: string,
 *   suggestedFrom: number,
 *   type: "text" | "path" | "secret"
 * }} WorkflowInput
 */

const PLACEHOLDER_PATTERN = /^\{\{\s*input\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

// Reserved input name validation — matches the profile/task-kind
// convention (lowercase + underscore-friendly). Allow camelCase
// for ergonomic JS-side reading.
const INPUT_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,59}$/;
const VALID_TYPES = new Set(["text", "path", "secret"]);

/**
 * Build a placeholder string for a named input.
 *
 * @param {string} name
 */
export function placeholderFor(name) {
  if (!INPUT_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid input name "${name}". Must match ${String(INPUT_NAME_PATTERN)}.`);
  }
  return `{{input.${name}}}`;
}

/**
 * Parse a placeholder string into its input name. Returns null when
 * the string is not a placeholder (caller can treat as literal value).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function parsePlaceholder(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(PLACEHOLDER_PATTERN);
  return match ? match[1] : null;
}

/**
 * Validate an inputs[] array.  Throws on shape errors (duplicate names,
 * invalid type, malformed name). Returns the validated array on success.
 *
 * @param {unknown} inputs
 * @returns {WorkflowInput[]}
 */
export function validateInputs(inputs) {
  if (!Array.isArray(inputs)) {
    throw new Error("inputs must be an array.");
  }
  /** @type {Set<string>} */
  const seenNames = new Set();
  /** @type {WorkflowInput[]} */
  const validated = [];
  for (const raw of inputs) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Each input entry must be an object.");
    }
    const entry = /** @type {Record<string, unknown>} */ (raw);
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!INPUT_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid input name "${name}". Must match ${String(INPUT_NAME_PATTERN)}.`);
    }
    if (seenNames.has(name)) {
      throw new Error(`Duplicate input name "${name}".`);
    }
    seenNames.add(name);
    const type = entry.type;
    if (typeof type !== "string" || !VALID_TYPES.has(type)) {
      throw new Error(
        `Invalid input type "${String(type)}" for "${name}". Must be one of ${Array.from(VALID_TYPES).join(" | ")}.`
      );
    }
    const label = typeof entry.label === "string" && entry.label.length > 0 ? entry.label : name;
    const suggestedFrom = typeof entry.suggestedFrom === "number" ? entry.suggestedFrom : -1;
    validated.push({
      name,
      label,
      suggestedFrom,
      type: /** @type {"text" | "path" | "secret"} */ (type)
    });
  }
  return validated;
}

/**
 * Apply bindings to a workflow object. Returns a deep-copied workflow
 * with placeholder strings replaced by their bound values. Throws
 * when a placeholder has no matching binding.
 *
 * For `type: "secret"` inputs, binding values must be supplied via the
 * env-var convention (`BROWSER_FLOW_INPUT_<NAME>`) — passing them in
 * the `bindings` object directly is allowed but discouraged.
 * Secret-only env enforcement is a future candidate.
 *
 * @param {Record<string, unknown>} workflow
 * @param {Record<string, string | number | boolean>} bindings
 */
export function bindInputs(workflow, bindings) {
  if (!workflow || typeof workflow !== "object") {
    throw new Error("bindInputs requires a workflow object.");
  }
  const rawInputs = /** @type {unknown} */ (
    /** @type {Record<string, unknown>} */ (workflow).inputs
  );
  const declaredInputs = rawInputs === undefined ? [] : validateInputs(rawInputs);
  const declaredNames = new Set(declaredInputs.map((entry) => entry.name));
  /** @type {Record<string, string>} */
  const bindingMap = {};
  for (const [key, value] of Object.entries(bindings ?? {})) {
    if (!declaredNames.has(key)) {
      throw new Error(`Binding "${key}" does not match any declared input (${Array.from(declaredNames).join(", ") || "none"}).`);
    }
    bindingMap[key] = String(value);
  }
  const cloned = JSON.parse(JSON.stringify(workflow));

  /** @param {unknown[]} stepsArr */
  function applyToSteps(stepsArr) {
    for (const step of stepsArr) {
      if (!step || typeof step !== "object") continue;
      const s = /** @type {Record<string, unknown>} */ (step);
      const valueRef = typeof s.valueRef === "string" ? s.valueRef : null;
      if (!valueRef) continue;
      const inputName = parsePlaceholder(valueRef);
      if (!inputName) {
        throw new Error(`Step ${String(s.action ?? "?")} has malformed valueRef "${valueRef}".`);
      }
      if (!(inputName in bindingMap)) {
        throw new Error(`Missing binding for input "${inputName}" referenced by step ${String(s.action ?? "?")}.`);
      }
      s.value = bindingMap[inputName];
      // valueRef 제거 — 산출 runner는 bound된 값만 본다
      delete s.valueRef;
    }
  }

  const steps = Array.isArray(cloned.steps) ? cloned.steps : [];
  applyToSteps(steps);

  // Also apply to teardown steps so the teardown delete uses
  // the same dummy value as the forward create step.
  const teardownSteps =
    cloned.teardown && Array.isArray(cloned.teardown.steps) ? cloned.teardown.steps : [];
  applyToSteps(teardownSteps);

  return cloned;
}

/**
 * Compute a deterministic short hash of a bindings map for use in new
 * runId naming (`<originalRunId>-bind-<short-hash>`). 같은 bindings →
 * 같은 hash, 다른 bindings → 다른 hash. JSON.stringify에 sorted keys
 * 적용해서 key 순서 비결정성 회피.
 *
 * @param {Record<string, string | number | boolean>} bindings
 */
export function bindingsShortHash(bindings) {
  /** @type {Record<string, string>} */
  const sorted = {};
  for (const key of Object.keys(bindings ?? {}).sort()) {
    sorted[key] = String(bindings[key]);
  }
  const serialized = JSON.stringify(sorted);
  return createHash("sha256").update(serialized).digest("hex").slice(0, 8);
}
