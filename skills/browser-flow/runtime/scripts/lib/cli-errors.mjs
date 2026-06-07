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
 *   suggestedCommands: string[]
 * }} CliFailure
 *
 * @typedef {{
 *   command?: string
 * }} CliErrorContext
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

export class CliError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string[]} [suggestedCommands]
   */
  constructor(code, message, suggestedCommands = []) {
    super(message);
    this.name = "CliError";
    this.code = code;
    const definition = EXIT_CODE_BY_CODE.get(code) ?? EXIT_CODE_BY_CODE.get("runtime_error");
    this.exitCode = definition?.status ?? 1;
    this.recoverable = definition?.recoverable ?? false;
    this.suggestedCommands = suggestedCommands;
  }
}

export function invalidUsage(message, suggestedCommands = ["browser-flow help"]) {
  return new CliError("invalid_usage", message, suggestedCommands);
}

export function missingRequiredOption(message, command = "") {
  return new CliError(
    "missing_required_option",
    message,
    command ? [`browser-flow ${command} --help`] : ["browser-flow help"]
  );
}

export function missingRunArtifact(message, command = "") {
  return new CliError(
    "missing_run_artifact",
    message,
    command ? [`browser-flow ${command} --help`, "browser-flow help artifacts"] : ["browser-flow help artifacts"]
  );
}

export function dependencyPreflightFailure(message) {
  return new CliError("dependency_preflight_failure", message, ["npm ci --omit=dev --ignore-scripts --no-audit --no-fund", "browser-flow doctor"]);
}

export function safetyOrPermissionBlock(message) {
  return new CliError("safety_or_permission_block", message, ["browser-flow help safety"]);
}

export function checkpointRequired(message, command = "") {
  return new CliError("checkpoint_required", message, checkpointSuggestions(message, command));
}

export function verificationNotGreen(message, command = "") {
  return new CliError(
    "verification_not_green",
    message,
    command ? [`browser-flow ${command} --help`, "browser-flow help safety"] : ["browser-flow help safety"]
  );
}

export function diagnosticNotPromotable(message) {
  return new CliError("diagnostic_not_promotable", message, ["browser-flow promote --help", "browser-flow help safety"]);
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
      suggestedCommands: error.suggestedCommands
    };
  }
  const message = errorMessage(error);
  const command = normalizeCommand(context.command);
  const code = classifyMessage(message);
  const definition = EXIT_CODE_BY_CODE.get(code) ?? EXIT_CODE_BY_CODE.get("runtime_error");
  if (!definition) {
    return {
      code: "runtime_error",
      exitCode: 1,
      message,
      recoverable: false,
      suggestedCommands: ["browser-flow help"]
    };
  }
  return {
    code: definition.code,
    exitCode: definition.status,
    message: normalizeErrorMessage(message, definition.code, command),
    recoverable: definition.recoverable,
    suggestedCommands: suggestedCommandsFor(definition.code, message, command)
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
  return {
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      recoverable: failure.recoverable,
      suggestedCommands: failure.suggestedCommands
    }
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
 */
function classifyMessage(message) {
  const text = message.trim();
  if (/^Unknown command\b/i.test(text) || /schema command requires a known command name/i.test(text)) {
    return "invalid_usage";
  }
  if (/Diagnostic replay succeeded|not promotable|promotion is blocked/i.test(text)) {
    return "diagnostic_not_promotable";
  }
  if (/requires a passed replay|replay did not pass|verification(?:\.json)? .*not green|verification_not_green/i.test(text)) {
    return "verification_not_green";
  }
  if (/review required|requires review|needs_review|checkpoint|required before analyze|requested recapture|drift-hold/i.test(text)) {
    return "checkpoint_required";
  }
  if (/Unable to prepare browser-flow runtime dependencies|Chrome binary not found|preflight|npm ci/i.test(text)) {
    return "dependency_preflight_failure";
  }
  if (/policy_blocked|security scan|security\.json .*not green|security ok:true|permission denied|operation not permitted|non-local|unmasked|blocked by safety/i.test(text)) {
    return "safety_or_permission_block";
  }
  if (/requires (?:both )?(?:verification\.json|security\.json|workflow\.json|data-result\.json)|requires .*\.json|no .* for run\b|no snapshots in manifest|not found|ENOENT|missing .*artifact/i.test(text)) {
    return "missing_run_artifact";
  }
  if (/requires --|requires .*--|missing required|must provide/i.test(text)) {
    return "missing_required_option";
  }
  if (/invalid --|invalid .*mode|mutually exclusive|requires either|Expected one of|Unknown compose checkpoint|completion supports bash, zsh, or fish/i.test(text)) {
    return "invalid_usage";
  }
  return "runtime_error";
}

/**
 * @param {string} message
 * @param {string} code
 * @param {string} command
 */
function normalizeErrorMessage(message, code, command) {
  const text = message.trim();
  if (code === "invalid_usage" && /^Unknown command\b/i.test(text)) {
    return text;
  }
  if (code === "invalid_usage" && /^Command "/.test(text)) {
    return text.replace(/^Command "([^"]+)".*$/s, 'Unknown command "$1".');
  }
  if (code === "missing_required_option" && command && /requires --/i.test(text)) {
    return text;
  }
  return text;
}

/**
 * @param {string | undefined} command
 */
function normalizeCommand(command) {
  if (!command || command.startsWith("-")) return "";
  return command;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string} command
 */
function suggestedCommandsFor(code, message, command) {
  if (code === "invalid_usage") {
    return command ? [`browser-flow ${command} --help`, "browser-flow help"] : ["browser-flow help"];
  }
  if (code === "missing_required_option") {
    return command ? [`browser-flow ${command} --help`] : ["browser-flow help"];
  }
  if (code === "missing_run_artifact") {
    return command ? [`browser-flow ${command} --help`, "browser-flow help artifacts"] : ["browser-flow help artifacts"];
  }
  if (code === "dependency_preflight_failure") {
    return ["npm ci --omit=dev --ignore-scripts --no-audit --no-fund", "browser-flow doctor"];
  }
  if (code === "safety_or_permission_block") {
    return ["browser-flow help safety"];
  }
  if (code === "checkpoint_required") {
    return checkpointSuggestions(message, command);
  }
  if (code === "verification_not_green") {
    return command ? [`browser-flow ${command} --help`, "browser-flow help safety"] : ["browser-flow help safety"];
  }
  if (code === "diagnostic_not_promotable") {
    return ["browser-flow promote --help", "browser-flow help safety"];
  }
  return ["browser-flow help"];
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
