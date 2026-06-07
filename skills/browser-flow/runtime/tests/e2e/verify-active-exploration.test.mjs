import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pagePaths } from "../../scripts/lib/config.mjs";
import { readJson } from "../../scripts/lib/fs.mjs";
import { runExploreCommand } from "../../scripts/commands/explore.mjs";

/**
 * Active-exploration e2e (real Chrome).
 *
 * The `explore` fixture is a known 2-depth graph:
 *   hub(/explore) --to-a--> /explore/a --to-ax--> /explore/a/x (leaf)
 *               \--to-b--> /explore/b --back--> hub (cycle)
 *               \--[Delete everything] (CUD trap — must NEVER be clicked)
 *               \--<input> (skip)
 * The read-only BFS must discover the navigate edges, record the CUD affordance
 * WITHOUT clicking it (cud-count stays 0), skip the cycle, and stop at depth 2.
 */
test("verify-active-exploration: read-only BFS discovers the graph and never clicks the CUD button", { timeout: 120000 }, async () => {
  const result = /** @type {any} */ (await runExploreCommand({ fixture: "explore", depth: 2, headless: true }));

  const nodes = /** @type {string[]} */ (result.nodes);
  const edges = /** @type {Array<{from:string,to:string|null,via:any,kind:string}>} */ (result.edges);

  const hub = "explore/explore";
  const a = "explore/explore/a";
  const b = "explore/explore/b";
  const ax = "explore/explore/a/x";

  // 1. All four reachable page-nodes were discovered.
  for (const pk of [hub, a, b, ax]) {
    assert.ok(nodes.includes(pk), `node ${pk} must be discovered — got ${JSON.stringify(nodes)}`);
  }

  // 2. Navigate edges: hub->a, hub->b, a->a/x.
  const navEdge = (/** @type {string} */ from, /** @type {string} */ to) => edges.find((e) => e.from === from && e.to === to && e.kind === "navigate");
  assert.ok(navEdge(hub, a), `expected navigate edge ${hub} -> ${a} — got ${JSON.stringify(edges)}`);
  assert.ok(navEdge(hub, b), `expected navigate edge ${hub} -> ${b}`);
  assert.ok(navEdge(a, ax), `expected depth-2 navigate edge ${a} -> ${ax}`);

  // 3. The "Delete everything" button is recorded as a CUD edge with no destination,
  //    and was NEVER navigated/clicked.
  const cudEdge = edges.find((e) => e.from === hub && e.kind === "cud");
  assert.ok(cudEdge, `expected a cud edge from the hub — got ${JSON.stringify(edges)}`);
  assert.equal(cudEdge.to, null, "cud edge must have no destination (not clicked)");
  assert.ok(String(cudEdge.via?.name || "").toLowerCase().includes("delete"), "cud edge should be the Delete button");

  // 4. THE safety assertion: the CUD button's server-side click counter stayed 0.
  assert.equal(result.cudClicks, 0, `the CUD button must never be clicked — cudClicks=${result.cudClicks}`);

  // 5. Depth bound: the leaf a/x was reached but not expanded (no outgoing edge).
  assert.ok(!edges.some((e) => e.from === ax), "leaf a/x must not be expanded (depth 2)");

  // 6. Discovered edges were persisted for the hub page-node.
  const hubEdgesPath = pagePaths(hub).exploredEdgesPath;
  assert.ok(existsSync(hubEdgesPath), `explored-edges.json must be written for the hub — ${hubEdgesPath}`);
  const persisted = /** @type {any} */ (readJson(hubEdgesPath));
  assert.ok(Array.isArray(persisted.edges) && persisted.edges.length >= 3, "persisted hub edges must include the nav + cud edges");
});
