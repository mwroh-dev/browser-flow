import { constants, accessSync } from "node:fs";

/**
 * @param {string} runtimeRoot
 * @param {{ accessSync?: typeof accessSync }} deps
 */
export function checkRuntimeDependencyPreflight(runtimeRoot, deps = { accessSync }) {
  const access = deps.accessSync ?? accessSync;
  try {
    access(runtimeRoot, constants.W_OK);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: "runtime_not_writable",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {string} runtimeRoot
 * @param {{ ok: boolean, reason?: string, detail?: string }} result
 */
export function formatRuntimePreflightError(runtimeRoot, result) {
  const detail = result.detail ? `\n${result.detail}` : "";

  return [
    `Unable to prepare browser-flow runtime dependencies inside ${runtimeRoot}.`,
    "Permission preflight failed: runtime directory is not writable.",
    "Run from a writable project-local install, repair ownership, or approve an elevated dependency install.",
    detail.trim()
  ]
    .filter(Boolean)
    .join("\n");
}
