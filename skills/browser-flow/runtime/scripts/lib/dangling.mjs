/**
 * Collect the "dangling" artifact names a held/aborted run created.
 *
 * A run that holds (drift) or aborts mid-flow never ran its own teardown, so every
 * artifact recorded in the state journal's `created[]` is potentially orphaned. This
 * pure function flattens those names (deduped, in order) so `bf cleanup` can delete
 * them via the workflow's teardown recipe.
 *
 * Agent-blind: the journal records artifact NAMES only (never secret values), so the
 * output is a list of names safe to surface and act on.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} journal
 * @returns {string[]}
 */
export function collectDangling(journal) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const entry of Array.isArray(journal) ? journal : []) {
    const created = entry && Array.isArray(entry.created) ? entry.created : [];
    for (const name of created) {
      if (typeof name === "string" && name.length > 0 && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}
