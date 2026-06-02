/**
 * @param {string | undefined} provided
 */
export function resolveRunId(provided) {
  if (provided && provided.trim()) {
    return provided.trim();
  }
  return `run-${new Date().toISOString().replaceAll(":", "-")}`;
}
