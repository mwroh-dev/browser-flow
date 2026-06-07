import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { assembleBrowserFlowPackage } from "../../scripts/publish/render-browser-flow-surfaces.mjs";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

/**
 * @typedef {{
 *   stageRoot: string,
 *   packageRoot: string
 * }} AssembledPackage
 */

/**
 * @template T
 * @param {(paths: AssembledPackage) => Promise<T> | T} callback
 * @returns {Promise<T>}
 */
export async function withAssembledPackage(callback) {
  const stageRoot = mkdtempSync(resolve(tmpdir(), "browser-flow-package-"));
  const packageRoot = resolve(stageRoot, "skills", "browser-flow");
  try {
    assembleBrowserFlowPackage(getRepoRoot(), packageRoot);
    return await callback({ stageRoot, packageRoot });
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}
