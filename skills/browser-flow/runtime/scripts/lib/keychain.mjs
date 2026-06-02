import { execFileSync } from "node:child_process";

const ACCOUNT = "browser-flow";

/** @typedef {(file: string, args: string[]) => string} ExecFn */

/** @param {{ exec?: ExecFn }} [opts] */
function resolveExec(opts) {
  return opts?.exec ?? (/** @type {ExecFn} */ (file, args) => execFileSync(file, args, { encoding: "utf8" }));
}

/**
 * Store a session value in the OS keychain (base64-encoded so the raw
 * secret is not a plaintext CLI arg). Value never returned in errors/logs.
 * @param {string} ref
 * @param {string} value
 * @param {{ exec?: ExecFn }} [opts]
 */
export function saveSession(ref, value, opts) {
  const exec = resolveExec(opts);
  const encoded = Buffer.from(value, "utf8").toString("base64");
  exec("security", ["add-generic-password", "-a", ACCOUNT, "-s", ref, "-w", encoded, "-U"]);
}

/**
 * Read a session value. Returns null if absent. Never logs the value.
 * @param {string} ref
 * @param {{ exec?: ExecFn }} [opts]
 * @returns {string | null}
 */
export function readSession(ref, opts) {
  const exec = resolveExec(opts);
  /** @type {string} */
  let out;
  try {
    out = exec("security", ["find-generic-password", "-a", ACCOUNT, "-s", ref, "-w"]);
  } catch {
    return null;
  }
  return Buffer.from(out.trim(), "base64").toString("utf8");
}

/**
 * Delete a session value from the OS keychain. No-ops if absent.
 * @param {string} ref
 * @param {{ exec?: ExecFn }} [opts]
 */
export function deleteSession(ref, opts) {
  const exec = resolveExec(opts);
  try {
    exec("security", ["delete-generic-password", "-a", ACCOUNT, "-s", ref]);
  } catch {
    /* absent — ignore */
  }
}
