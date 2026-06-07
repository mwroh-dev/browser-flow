import { readFileSync } from "node:fs";

const HISTORY_START = "<!-- browser-flow-history:start -->";
const HISTORY_END = "<!-- browser-flow-history:end -->";
const LATEST_START = "<!-- browser-flow-latest:start -->";
const LATEST_END = "<!-- browser-flow-latest:end -->";

const REQUIRED_NOTE_FIELDS = [
  "title",
  "status",
  "userRequest",
  "whyItMattered",
  "modelConclusion",
  "changesMade",
  "expectedResolution",
  "validation",
  "publicationNotes"
];

/**
 * @typedef {{
 *   workItemId?: string,
 *   continuationOf?: string,
 *   title: string,
 *   status: "active" | "resolved" | "superseded",
 *   userRequest: string,
 *   whyItMattered: string,
 *   modelConclusion: string,
 *   changesMade: string,
 *   expectedResolution: string,
 *   validation: string,
 *   publicationNotes: string,
 *   relatedSourceCommits?: string[]
 * }} ReleaseNote
 *
 * @typedef {{
 *   updateDate: string,
 *   sourceBranch: string,
 *   sourceSha: string,
 *   bundleFileCount?: number
 * }} ReleaseMetadata
 */

/**
 * @param {string} path
 * @returns {ReleaseNote}
 */
export function readReleaseNote(path) {
  return validateReleaseNote(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * @param {unknown} raw
 * @returns {ReleaseNote}
 */
export function validateReleaseNote(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("release note must be a JSON object");
  }
  const note = /** @type {Record<string, unknown>} */ (raw);
  const hasWorkItemId = typeof note.workItemId === "string" && note.workItemId.trim() !== "";
  const hasContinuationOf = typeof note.continuationOf === "string" && note.continuationOf.trim() !== "";
  if (hasWorkItemId && hasContinuationOf) {
    throw new Error("release note must provide either workItemId or continuationOf, not both");
  }
  if (!hasWorkItemId && !hasContinuationOf) {
    throw new Error("release note requires workItemId or continuationOf");
  }
  const id = String(hasContinuationOf ? note.continuationOf : note.workItemId).trim();
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(id)) {
    throw new Error(`release note has invalid work item id: ${id}`);
  }
  for (const field of REQUIRED_NOTE_FIELDS) {
    if (typeof note[field] !== "string" || String(note[field]).trim() === "") {
      throw new Error(`release note missing required field: ${field}`);
    }
  }
  if (!["active", "resolved", "superseded"].includes(String(note.status))) {
    throw new Error("release note status must be active, resolved, or superseded");
  }
  return {
    workItemId: hasWorkItemId ? id : undefined,
    continuationOf: hasContinuationOf ? id : undefined,
    title: String(note.title).trim(),
    status: /** @type {"active" | "resolved" | "superseded"} */ (String(note.status).trim()),
    userRequest: String(note.userRequest).trim(),
    whyItMattered: String(note.whyItMattered).trim(),
    modelConclusion: String(note.modelConclusion).trim(),
    changesMade: String(note.changesMade).trim(),
    expectedResolution: String(note.expectedResolution).trim(),
    validation: String(note.validation).trim(),
    publicationNotes: String(note.publicationNotes).trim(),
    relatedSourceCommits: Array.isArray(note.relatedSourceCommits)
      ? note.relatedSourceCommits.map((entry) => String(entry).trim()).filter(Boolean)
      : undefined
  };
}

/**
 * @param {{
 *   historyMarkdown: string,
 *   readmeMarkdown: string,
 *   note: ReleaseNote,
 *   metadata: ReleaseMetadata
 * }} input
 */
export function applyReleaseNote(input) {
  const note = validateReleaseNote(input.note);
  const workItemId = note.continuationOf || note.workItemId || "";
  const existing = findWorkItem(input.historyMarkdown, workItemId);
  if (note.continuationOf && !existing) {
    throw new Error(`release note continuation target not found in HISTORY.md: ${workItemId}`);
  }
  const historyMarkdown = existing
    ? appendWorkItemUpdate(input.historyMarkdown, existing, note, input.metadata)
    : prependWorkItem(input.historyMarkdown, note, input.metadata);
  const readmeMarkdown = updateReadmeLatest(input.readmeMarkdown, [
    { workItemId, title: note.title, status: note.status }
  ], input.metadata);
  return { historyMarkdown, readmeMarkdown, workItemId };
}

/**
 * @param {string} history
 * @param {string} workItemId
 * @returns {{ start: number, end: number, body: string } | null}
 */
function findWorkItem(history, workItemId) {
  const escaped = escapeRegExp(workItemId);
  const pattern = new RegExp(`^## Work Item: ${escaped}\\b.*$`, "m");
  const match = pattern.exec(history);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const rest = history.slice(start + match[0].length);
  const next = /\n## Work Item: /m.exec(rest);
  const end = next && next.index !== undefined ? start + match[0].length + next.index : history.indexOf(HISTORY_END, start);
  return { start, end: end === -1 ? history.length : end, body: history.slice(start, end === -1 ? history.length : end) };
}

/**
 * @param {string} history
 * @param {ReleaseNote} note
 * @param {ReleaseMetadata} metadata
 */
function prependWorkItem(history, note, metadata) {
  const id = note.workItemId || "";
  const block = [
    `## Work Item: ${id} - ${note.title}`,
    "",
    `- Status: ${note.status}`,
    `- First recorded: ${metadata.updateDate}`,
    `- Last updated: ${metadata.updateDate}`,
    "",
    "### User Request",
    note.userRequest,
    "",
    "### Why It Mattered",
    note.whyItMattered,
    "",
    "### Model Conclusion",
    note.modelConclusion,
    "",
    "### Changes Made",
    note.changesMade,
    "",
    "### Expected Resolution",
    note.expectedResolution,
    "",
    "### Validation",
    note.validation,
    "",
    "### Publication Notes",
    note.publicationNotes,
    "",
    "### Updates",
    "",
    renderUpdateBlock(note, metadata),
    ""
  ].join("\n");
  return insertAfterHistoryStart(history, block);
}

/**
 * @param {string} history
 * @param {{ start: number, end: number, body: string }} existing
 * @param {ReleaseNote} note
 * @param {ReleaseMetadata} metadata
 */
function appendWorkItemUpdate(history, existing, note, metadata) {
  const updatedBody = existing.body
    .replace(/- Status: .*/, `- Status: ${note.status}`)
    .replace(/- Last updated: .*/, `- Last updated: ${metadata.updateDate}`);
  const marker = "\n### Updates\n";
  const update = `\n${renderUpdateBlock(note, metadata)}\n`;
  const nextBody = updatedBody.includes(marker)
    ? updatedBody.replace(marker, `${marker}${update}`)
    : `${updatedBody.trimEnd()}\n\n### Updates\n${update}`;
  return `${history.slice(0, existing.start)}${nextBody}${history.slice(existing.end)}`;
}

/**
 * @param {ReleaseNote} note
 * @param {ReleaseMetadata} metadata
 */
function renderUpdateBlock(note, metadata) {
  const commits = note.relatedSourceCommits && note.relatedSourceCommits.length > 0
    ? note.relatedSourceCommits.map((entry) => `  - ${entry}`).join("\n")
    : "  - not specified";
  const bundle = typeof metadata.bundleFileCount === "number" ? String(metadata.bundleFileCount) : "unknown";
  return [
    `#### ${metadata.updateDate} - ${metadata.sourceSha}`,
    "",
    `- Source branch: ${metadata.sourceBranch}`,
    `- Source SHA: ${metadata.sourceSha}`,
    "- Release SHA: pending-this-commit",
    `- Bundle file count: ${bundle}`,
    "- Related source commits:",
    commits,
    "",
    "##### User Request",
    note.userRequest,
    "",
    "##### Why It Mattered",
    note.whyItMattered,
    "",
    "##### Model Conclusion",
    note.modelConclusion,
    "",
    "##### Changes Made",
    note.changesMade,
    "",
    "##### Expected Resolution",
    note.expectedResolution,
    "",
    "##### Validation",
    note.validation,
    "",
    "##### Publication Notes",
    note.publicationNotes
  ].join("\n");
}

/**
 * @param {string} history
 * @param {string} block
 */
function insertAfterHistoryStart(history, block) {
  const start = history.indexOf(HISTORY_START);
  const end = history.indexOf(HISTORY_END);
  if (start === -1 || end === -1 || start > end) {
    throw new Error("HISTORY.md is missing browser-flow history markers");
  }
  const before = history.slice(0, start + HISTORY_START.length);
  const between = history.slice(start + HISTORY_START.length, end).trim();
  const after = history.slice(end);
  const retained = between && !between.startsWith("No work-item releases") ? `\n\n${between}` : "";
  return `${before}\n${block}${retained}\n${after}`;
}

/**
 * @param {string} readme
 * @param {Array<{ workItemId: string, title: string, status: string }>} items
 * @param {ReleaseMetadata} metadata
 */
function updateReadmeLatest(readme, items, metadata) {
  const start = readme.indexOf(LATEST_START);
  const end = readme.indexOf(LATEST_END);
  if (start === -1 || end === -1 || start > end) {
    throw new Error("README.md is missing browser-flow latest markers");
  }
  const itemLines = items.map((item) => `- \`${item.workItemId}\`: ${item.title} (${item.status})`).join("\n");
  const bundle = typeof metadata.bundleFileCount === "number" ? String(metadata.bundleFileCount) : "unknown";
  const block = [
    `- Source branch: \`${metadata.sourceBranch}\``,
    `- Source SHA: \`${metadata.sourceSha}\``,
    `- Updated: ${metadata.updateDate}`,
    `- Bundle file count: ${bundle}`,
    "- Updated work items:",
    itemLines || "- none"
  ].join("\n");
  return `${readme.slice(0, start + LATEST_START.length)}\n${block}\n${readme.slice(end)}`;
}

export { updateReadmeLatest };

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
