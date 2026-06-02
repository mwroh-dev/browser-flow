/**
 * Pure BFS graph explorer. All side effects are injected via deps.
 *
 * @param {{
 *   seedPageKey: string,
 *   enumerate: (node: {pageKey: string, clickPrefix: object[], depth: number}) => Promise<Array<{role?:string,name?:string,structuralKey?:string}>>,
 *   clickObserve: (clickPrefix: Array<object>, aff: object) => Promise<string>,
 *   classify: (aff: {role?:string,name?:string}) => "navigate"|"cud"|"skip"
 * }} deps
 * @param {{ depth?: number, navCapPerNode?: number, totalBudget?: number }} [options]
 * @returns {Promise<{ nodes: Set<string>, edges: Array<{from:string,to:string|null,via:object,kind:"navigate"|"cud"}> }>}
 */
export async function exploreGraph(deps, options = {}) {
  const depth = options.depth ?? 2;
  const navCapPerNode = options.navCapPerNode ?? 20;
  const totalBudget = options.totalBudget ?? 60;
  const visited = new Set();
  const nodes = new Set();
  /** @type {Array<{from:string,to:string|null,via:object,kind:"navigate"|"cud"}>} */
  const edges = [];
  let clicks = 0;
  /** @type {Array<{pageKey:string, clickPrefix:object[], depth:number}>} */
  const frontier = [{ pageKey: deps.seedPageKey, clickPrefix: [], depth: 0 }];

  while (frontier.length > 0) {
    const node = frontier.shift();
    if (!node || visited.has(node.pageKey)) continue;
    visited.add(node.pageKey);
    nodes.add(node.pageKey);
    const affs = await deps.enumerate(node);
    let navsThisNode = 0;
    for (const aff of affs) {
      const c = deps.classify(aff);
      if (c === "cud") {
        edges.push({ from: node.pageKey, to: null, via: aff, kind: "cud" }); // recorded, NOT clicked
        continue;
      }
      if (c === "navigate") {
        if (node.depth >= depth) continue;          // depth boundary: do not expand further
        if (navsThisNode >= navCapPerNode) continue;
        if (clicks >= totalBudget) continue;
        navsThisNode += 1;
        clicks += 1;
        const dest = await deps.clickObserve(node.clickPrefix, aff);
        edges.push({ from: node.pageKey, to: dest, via: aff, kind: "navigate" });
        nodes.add(dest);
        if (!visited.has(dest) && node.depth + 1 < depth) {
          frontier.push({ pageKey: dest, clickPrefix: [...node.clickPrefix, aff], depth: node.depth + 1 });
        }
      }
      // "skip" → ignore
    }
  }
  return { nodes, edges };
}
