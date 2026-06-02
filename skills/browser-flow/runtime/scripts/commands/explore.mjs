// @ts-check
/**
 * bf explore command — read-only BFS discovery of navigable graph
 * from a fixture page via CDP. Persists discovered edges to per-page-node
 * explored-edges.json files.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStringOption } from "../lib/args.mjs";
import { pagePaths } from "../lib/config.mjs";
import { writeJson } from "../lib/fs.mjs";
import { getFreePort } from "../lib/net.mjs";
import { derivePageKey } from "../lib/page-key.mjs";
import { startFixtureServer } from "../fixtures/site-server.mjs";
import { createBrowserSession } from "../cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../cdp/watchdogs/lifecycle.mjs";
import { installActionWatchdog } from "../cdp/watchdogs/action.mjs";
import { buildExplorerDeps } from "../explore/cdp-explorer.mjs";
import { exploreGraph } from "../explore/explorer.mjs";

/**
 * Wait for a child process to exit. Resolves when the process emits 'exit' or 'close',
 * or after a short timeout to avoid hanging if the process is already dead.
 * @param {import("node:child_process").ChildProcess} proc
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForProcessExit(proc, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.killed) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    proc.once("exit", () => { clearTimeout(timer); resolve(); });
    proc.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

/**
 * @param {{ fixture: string, depth?: number, headless?: boolean }} opts
 * @returns {Promise<{
 *   fixture: string,
 *   depth: number,
 *   baseUrl: string,
 *   nodes: string[],
 *   edges: Array<{from:string,to:string|null,via:object,kind:string}>,
 *   cudClicks: number | null
 * }>}
 */
export async function runExploreCommand(opts) {
  const { fixture } = opts;
  const depth = opts.depth ?? 2;
  const headless = opts.headless !== false;

  const server = await startFixtureServer();
  const seedPath = "/" + fixture;
  const seedUrl = server.baseUrl + seedPath;
  const seedPageKey = derivePageKey(seedUrl, fixture);

  const profileDir = mkdtempSync(join(tmpdir(), "bf-explore-"));
  const debugPort = await getFreePort();

  const session = await createBrowserSession({ profileDir, debugPort, headless });
  const lifecycle = await installLifecycleWatchdog(session);
  const action = await installActionWatchdog(session);

  // Capture the chrome process reference before dispose() so we can wait for exit.
  const chromeProc = /** @type {any} */ (session).chromeProcess;

  // Navigate to the seed page to ensure the tab is open and ready.
  const targets = session.sessionManager.listPageTargets();
  if (targets.length === 0) {
    throw new Error("bf explore: no page targets found after browser launch");
  }
  const targetId = targets[0].targetId;

  let cudCount = null;
  let graph;
  try {
    const deps = buildExplorerDeps({
      session,
      targetId,
      lifecycle,
      action,
      seedUrl,
      seedPageKey,
      fixture
    });

    graph = await exploreGraph(deps, {
      depth,
      navCapPerNode: 20,
      totalBudget: 60
    });
  } finally {
    // Fetch CUD click count before closing server — only meaningful for explore fixture.
    try {
      const res = await fetch(server.baseUrl + "/" + fixture + "/cud-count");
      if (res.ok) {
        const json = /** @type {any} */ (await res.json());
        cudCount = typeof json.clicks === "number" ? json.clicks : null;
      }
    } catch (_) { /* harmless for fixtures without cud-count */ }

    await lifecycle.dispose().catch(() => {});
    await action.dispose().catch(() => {});
    await session.dispose().catch(() => {});

    // Wait for Chrome to exit before cleaning up its profile directory.
    if (chromeProc) await waitForProcessExit(chromeProc, 3000);

    // Best-effort temp-profile cleanup: under suite load Chrome may still be
    // releasing files when we remove the dir, yielding ENOTEMPTY. The dir is a
    // mkdtemp temp — never fail the command over it (the OS reaps /var/folders).
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    await server.close().catch(() => {});
  }

  // Persist edges grouped by from-pageKey.
  /** @type {Map<string, Array<{from:string,to:string|null,via:object,kind:string}>>} */
  const byFrom = new Map();
  if (graph) {
    for (const edge of graph.edges) {
      const list = byFrom.get(edge.from) ?? [];
      list.push(edge);
      byFrom.set(edge.from, list);
    }
    for (const [from, edges] of byFrom) {
      const paths = pagePaths(from);
      writeJson(paths.exploredEdgesPath, {
        schemaVersion: 1,
        pageKey: from,
        edges
      });
    }
  }

  return {
    fixture,
    depth,
    baseUrl: server.baseUrl,
    nodes: graph ? [...graph.nodes] : [],
    edges: graph ? graph.edges : [],
    cudClicks: cudCount
  };
}

/**
 * @param {Record<string, string | boolean>} options
 */
export function exploreCommand(options) {
  const fixture = getStringOption(options, "fixture", undefined);
  if (!fixture) throw new Error("bf explore requires --fixture");
  const depthStr = getStringOption(options, "depth", "2");
  const depth = Number(depthStr);
  return runExploreCommand({ fixture, depth, headless: options.headless !== false });
}
