/**
 * @typedef {{
 *   status: number,
 *   code: string,
 *   description: string,
 *   recoverable: boolean
 * }} ExitCodeDefinition
 *
 * @typedef {{
 *   code: string,
 *   exitCode: number,
 *   message: string,
 *   recoverable: boolean,
 *   suggestedCommands: string[],
 *   type?: string,
 *   subtype?: string,
 *   hint?: string,
 *   param?: string,
 *   artifacts?: string[],
 *   retryable?: boolean
 * }} CliFailure
 *
 * @typedef {{
 *   command?: string
 * }} CliErrorContext
 *
 * @typedef {{
 *   type?: string,
 *   subtype?: string,
 *   hint?: string,
 *   param?: string,
 *   artifacts?: string[],
 *   retryable?: boolean
 * }} CliErrorMetadata
 */

/** @type {ExitCodeDefinition[]} */
export const EXIT_CODE_DEFINITIONS = [
  {
    status: 0,
    code: "ok",
    description: "Command completed successfully.",
    recoverable: false
  },
  {
    status: 1,
    code: "runtime_error",
    description: "Unexpected runtime or system failure.",
    recoverable: false
  },
  {
    status: 2,
    code: "invalid_usage",
    description: "Command, flag, value, or argument combination is invalid.",
    recoverable: true
  },
  {
    status: 3,
    code: "missing_required_option",
    description: "A required command option is missing.",
    recoverable: true
  },
  {
    status: 4,
    code: "missing_run_artifact",
    description: "A required run artifact is missing.",
    recoverable: true
  },
  {
    status: 5,
    code: "dependency_preflight_failure",
    description: "Runtime dependency or browser preflight failed.",
    recoverable: true
  },
  {
    status: 6,
    code: "safety_or_permission_block",
    description: "Safety policy, permission, or security gate blocked execution.",
    recoverable: true
  },
  {
    status: 7,
    code: "checkpoint_required",
    description: "A review or heal checkpoint must be resolved before continuing.",
    recoverable: true
  },
  {
    status: 8,
    code: "verification_not_green",
    description: "Replay, verification, or green-report requirement is not satisfied.",
    recoverable: true
  },
  {
    status: 9,
    code: "diagnostic_not_promotable",
    description: "Diagnostic replay completed but cannot be promoted.",
    recoverable: true
  }
];

const EXIT_CODE_BY_CODE = new Map(EXIT_CODE_DEFINITIONS.map((entry) => [entry.code, entry]));

export const ERROR_TYPE_BY_CODE = new Map([
  ["runtime_error", "runtime"],
  ["invalid_usage", "validation"],
  ["missing_required_option", "validation"],
  ["missing_run_artifact", "artifact"],
  ["dependency_preflight_failure", "dependency"],
  ["safety_or_permission_block", "safety"],
  ["checkpoint_required", "checkpoint"],
  ["verification_not_green", "verification"],
  ["diagnostic_not_promotable", "diagnostic"]
]);

/**
 * @param {string} code
 */
export function typeForCode(code) {
  return ERROR_TYPE_BY_CODE.get(code) ?? "runtime";
}

export class CliError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string[]} [suggestedCommands]
   * @param {CliErrorMetadata} [metadata]
   */
  constructor(code, message, suggestedCommands = [], metadata = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    const definition = EXIT_CODE_BY_CODE.get(code) ?? EXIT_CODE_BY_CODE.get("runtime_error");
    this.exitCode = definition?.status ?? 1;
    this.recoverable = definition?.recoverable ?? false;
    this.suggestedCommands = suggestedCommands;
    this.type = metadata.type ?? typeForCode(code);
    if (metadata.subtype !== undefined) this.subtype = metadata.subtype;
    if (metadata.hint !== undefined) this.hint = metadata.hint;
    if (metadata.param !== undefined) this.param = metadata.param;
    if (metadata.artifacts !== undefined) this.artifacts = metadata.artifacts;
    if (metadata.retryable !== undefined) this.retryable = metadata.retryable;
  }
}

export function invalidUsage(message, suggestedCommands = ["browser-flow help"], metadata = {}) {
  return new CliError("invalid_usage", message, suggestedCommands, metadata);
}

export function missingRequiredOption(message, command = "", metadata = {}) {
  return new CliError(
    "missing_required_option",
    message,
    command ? [`browser-flow ${command} --help`] : ["browser-flow help"],
    metadata
  );
}

export function missingRunArtifact(message, command = "", metadata = {}) {
  return new CliError(
    "missing_run_artifact",
    message,
    command ? [`browser-flow ${command} --help`, "browser-flow help artifacts"] : ["browser-flow help artifacts"],
    metadata
  );
}

export function dependencyPreflightFailure(message, metadata = {}) {
  return new CliError(
    "dependency_preflight_failure",
    message,
    ["npm ci --omit=dev --ignore-scripts --no-audit --no-fund", "browser-flow doctor"],
    metadata
  );
}

export function safetyOrPermissionBlock(message, metadata = {}) {
  return new CliError("safety_or_permission_block", message, ["browser-flow help safety"], metadata);
}

export function checkpointRequired(message, command = "", metadata = {}) {
  return new CliError("checkpoint_required", message, checkpointSuggestions(message, command), metadata);
}

export function verificationNotGreen(message, command = "", metadata = {}) {
  return new CliError(
    "verification_not_green",
    message,
    command ? [`browser-flow ${command} --help`, "browser-flow help safety"] : ["browser-flow help safety"],
    metadata
  );
}

export function diagnosticNotPromotable(message, metadata = {}) {
  return new CliError("diagnostic_not_promotable", message, ["browser-flow promote --help", "browser-flow help safety"], metadata);
}

/**
 * @param {unknown} error
 * @param {CliErrorContext} [context]
 * @returns {CliFailure}
 */
export function classifyCliError(error, context = {}) {
  if (error instanceof CliError) {
    return {
      code: error.code,
      exitCode: error.exitCode,
      message: error.message,
      recoverable: error.recoverable,
      suggestedCommands: error.suggestedCommands,
      type: error.type ?? typeForCode(error.code),
      subtype: error.subtype,
      hint: error.hint,
      param: error.param,
      artifacts: error.artifacts,
      retryable: error.retryable
    };
  }
  const message = errorMessage(error);
  const definition = EXIT_CODE_BY_CODE.get("runtime_error");
  const code = definition?.code ?? "runtime_error";
  return {
    code,
    exitCode: definition?.status ?? 1,
    message,
    recoverable: definition?.recoverable ?? false,
    suggestedCommands: ["browser-flow help"],
    type: typeForCode(code)
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error) return String(error.message ?? "");
  if (error && typeof error === "object" && "message" in error) {
    const message = /** @type {{ message?: unknown }} */ (error).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * @param {CliFailure} failure
 */
export function formatHumanCliError(failure) {
  const lines = [
    `browser-flow error: ${failure.code}`,
    "",
    `What failed: ${failure.message}`,
    `Recoverable: ${failure.recoverable ? "yes" : "no"}`
  ];
  if (failure.type) lines.push(`Type: ${failure.type}`);
  if (failure.subtype) lines.push(`Subtype: ${failure.subtype}`);
  if (failure.param) lines.push(`Param: ${failure.param}`);
  if (failure.retryable !== undefined) lines.push(`Retryable: ${failure.retryable ? "yes" : "no"}`);
  if (failure.artifacts?.length) lines.push(`Artifacts: ${failure.artifacts.join(", ")}`);
  if (failure.hint) lines.push(`Hint: ${failure.hint}`);
  if (failure.suggestedCommands.length > 0) {
    lines.push("", "Suggested next commands:");
    for (const command of failure.suggestedCommands) {
      lines.push(`  ${command}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * @param {CliFailure} failure
 */
export function formatJsonCliError(failure) {
  /** @type {Omit<CliFailure, 'exitCode'>} */
  const error = {
    code: failure.code,
    message: failure.message,
    recoverable: failure.recoverable,
    suggestedCommands: failure.suggestedCommands
  };
  if (failure.type) error.type = failure.type;
  if (failure.subtype !== undefined) error.subtype = failure.subtype;
  if (failure.hint !== undefined) error.hint = failure.hint;
  if (failure.param !== undefined) error.param = failure.param;
  if (failure.artifacts !== undefined) error.artifacts = failure.artifacts;
  if (failure.retryable !== undefined) error.retryable = failure.retryable;
  return {
    ok: false,
    error
  };
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | boolean>} [options]
 */
export function isJsonErrorMode(argv, options = {}) {
  return options.json === true || argv.includes("--json");
}

/**
 * @param {string} message
 * @param {string} command
 */
function checkpointSuggestions(message, command) {
  const text = message.toLowerCase();
  if (text.includes("capture noise")) return ["browser-flow review-noise --help"];
  if (text.includes("locator intent")) return ["browser-flow review-locator-intent --help"];
  if (text.includes("route intent")) return ["browser-flow review-route-intent --help"];
  if (text.includes("heal-request") || text.includes("drift-hold")) return ["browser-flow heal --help"];
  return command ? [`browser-flow ${command} --help`, "browser-flow help workflows"] : ["browser-flow help workflows"];
}
