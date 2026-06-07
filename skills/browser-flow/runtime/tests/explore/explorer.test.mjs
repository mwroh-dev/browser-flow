import test from "node:test";
import assert from "node:assert/strict";
import { exploreGraph } from "../../scripts/explore/explorer.mjs";
import { classifyAffordance } from "../../scripts/lib/affordance-classifier.mjs";

/** @type {Record<string, Array<{role:string,name:string,structuralKey:string}>>} */
const SITE = {
  hub: [{ role: "link", name: "A", structuralKey: "ka" }, { role: "link", name: "B", structuralKey: "kb" }, { role: "button", name: "Delete", structuralKey: "kd" }],
  a:   [{ role: "link", name: "X", structuralKey: "kx" }],
  ax:  [],
  b:   [{ role: "link", name: "Hub", structuralKey: "kh" }]
};
/** @type {Record<string, string>} */
const DEST = { ka: "a", kb: "b", kx: "ax", kh: "hub" };

test("exploreGraph: depth-2 BFS, cud recorded-not-clicked, cycle skip", async () => {
  /** @type {string[]} */
  const clicked = [];
  const graph = await exploreGraph({
    seedPageKey: "hub",
    enumerate: async (node) => SITE[node.pageKey] || [],
    clickObserve: async (_prefix, aff) => {
      const a = /** @type {{structuralKey:string}} */ (aff);
      clicked.push(a.structuralKey);
      return DEST[a.structuralKey] || "hub";
    },
    classify: classifyAffordance
  }, { depth: 2, navCapPerNode: 20, totalBudget: 60 });

  /**
   * @param {string} from
   * @param {string} key
   */
  const e = (from, key) => graph.edges.find((x) => x.from === from && /** @type {{structuralKey:string}} */ (x.via).structuralKey === key);
  assert.ok(e("hub", "ka"), "hub->ka edge must exist");
  assert.equal(e("hub", "ka")?.to, "a");
  assert.equal(e("hub", "ka")?.kind, "navigate");
  assert.equal(e("hub", "kb")?.to, "b");
  assert.equal(e("hub", "kd")?.kind, "cud");
  assert.equal(e("hub", "kd")?.to, null);
  assert.ok(!clicked.includes("kd"), "CUD must NEVER be clicked");
  assert.equal(e("a", "kx")?.to, "ax");                      // depth 2 reached
  assert.ok(!graph.edges.some((x) => x.from === "ax"), "leaf ax not expanded");
  assert.deepEqual([...graph.nodes].sort(), ["a", "ax", "b", "hub"]);
});

test("exploreGraph: totalBudget caps clicks", async () => {
  /** @type {string[]} */
  const clicked = [];
  await exploreGraph({
    seedPageKey: "hub",
    enumerate: async (node) => SITE[node.pageKey] || [],
    clickObserve: async (_p, aff) => {
      const a = /** @type {{structuralKey:string}} */ (aff);
      clicked.push(a.structuralKey);
      return DEST[a.structuralKey] || "hub";
    },
    classify: classifyAffordance
  }, { depth: 2, navCapPerNode: 20, totalBudget: 1 });
  assert.equal(clicked.length, 1, "totalBudget=1 must stop after one click");
});
