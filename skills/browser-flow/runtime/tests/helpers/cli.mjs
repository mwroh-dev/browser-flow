import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

/**
 * @param {string[]} args
 */
export function runCli(args) {
  const result = spawnSync(process.execPath, ["scripts/cli.mjs", ...args], {
    cwd: getRepoRoot(),
    encoding: "utf8",
    // Propagate the test-runner env so BROWSER_FLOW_REGISTRY_PATH /
    // BROWSER_FLOW_PAGES_PATH overrides reach the CLI subprocess and it
    // writes to the temp fixture, not the committed knowledge/ tree.
    env: { ...process.env }
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `CLI failed with status ${result.status}.`);
  }
  return JSON.parse(result.stdout);
}
