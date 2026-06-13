import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { invalidUsage } from "./cli-errors.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultChromePath = process.env.BROWSER_FLOW_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function getRepoRoot() {
  return repoRoot;
}

// runId format — conservative allowlist. Must start alphanumeric, then
// alphanumeric / dot / underscore / dash, max 80 chars total. The class
// excludes every path separator and ":" so a runId can never contain a
// traversal sequence, an absolute path, or a Windows drive letter.
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * Validate a runId. Throws on empty/overlong/separator/traversal/absolute.
 * @param {string} runId
 * @returns {string}
 */
export function validateRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw invalidUsage(
      `Invalid runId ${JSON.stringify(runId)}. Must match ${String(RUN_ID_PATTERN)} ` +
      `(start alphanumeric; only letters, digits, dot, underscore, dash; no slashes or "..", max 80 chars).`,
      ["browser-flow help"],
      {
        subtype: "invalid_run_id",
        param: "--run-id",
        hint: "Pass a --run-id that starts alphanumeric and uses only letters, digits, dot, underscore, or dash.",
        retryable: false
      }
    );
  }
  return runId;
}

/**
 * Defense-in-depth: assert a resolved path is contained within an intended
 * root. Throws otherwise. Used after path construction even when the input
 * was already validated.
 * @param {string} resolvedPath
 * @param {string} rootPath
 * @param {string} label
 * @returns {string}
 */
export function assertInsideRoot(resolvedPath, rootPath, label) {
  const root = resolve(rootPath);
  const rel = relative(root, resolvedPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} ${JSON.stringify(resolvedPath)} escapes its root ${JSON.stringify(root)}.`);
  }
  return resolvedPath;
}

/**
 * Test-isolation guard. When running under `node --test` (Node sets
 * `NODE_TEST_CONTEXT`), the corresponding `BROWSER_FLOW_*_PATH` override
 * MUST be present — `tests/_setup.mjs` sets it via `--import`. If it is
 * absent, the test was started without the setup import (e.g.
 * `node --test tests/foo.test.mjs` directly) and a write would land in
 * the committed knowledge/ tree. Fail loud instead of silently polluting.
 *
 * @param {string} envVar
 * @param {string} what
 */
function assertTestOverridePresent(envVar, what) {
  if (process.env.NODE_TEST_CONTEXT && !process.env[envVar]) {
    throw new Error(
      `Test isolation guard: ${envVar} is unset under node --test, so ${what} ` +
      `would write to the committed knowledge/ tree. Run tests via \`npm test\` ` +
      `(which sets --import=./tests/_setup.mjs), not \`node --test <file>\` directly.`
    );
  }
}

export function getDefaultChromePath() {
  return defaultChromePath;
}

export function getPaths() {
  assertTestOverridePresent("BROWSER_FLOW_REGISTRY_PATH", "the workflow registry");
  const registryOverride = process.env.BROWSER_FLOW_REGISTRY_PATH;
  return {
    repoRoot,
    runsRoot: resolve(repoRoot, "artifacts", "runs"),
    registryPath: registryOverride
      ? resolve(registryOverride)
      : resolve(repoRoot, "knowledge", "registry", "workflows.json")
  };
}

/**
 * Page-as-node root. Tests override via
 * `BROWSER_FLOW_PAGES_PATH` env var (parallels the registry pattern)
 * so that `npm test` does not pollute the committed knowledge tree.
 */
export function getPagesRoot() {
  assertTestOverridePresent("BROWSER_FLOW_PAGES_PATH", "the page-node store");
  const override = process.env.BROWSER_FLOW_PAGES_PATH;
  return override ? resolve(override) : resolve(repoRoot, "knowledge", "pages");
}

/**
 * Scraping-config store root. Separate knowledge domain from the
 * page-node graph (structure) — this holds content-extraction configs. Tests
 * override via BROWSER_FLOW_SCRAPING_PATH (same guard as the pages store).
 */
export function getScrapingRoot() {
  assertTestOverridePresent("BROWSER_FLOW_SCRAPING_PATH", "the scraping-config store");
  const override = process.env.BROWSER_FLOW_SCRAPING_PATH;
  return override ? resolve(override) : resolve(repoRoot, "knowledge", "scraping");
}

/**
 * Mutable scoring-pattern learning store. Static seed patterns live in the
 * analyzer playbook; runtime-learned generalizable patterns belong in
 * committed knowledge, not in private playbook contracts.
 */
export function getScoringPatternsPath() {
  assertTestOverridePresent("BROWSER_FLOW_SCORING_PATTERNS_PATH", "the scoring-pattern learning store");
  const override = process.env.BROWSER_FLOW_SCORING_PATTERNS_PATH;
  return override ? resolve(override) : resolve(repoRoot, "knowledge", "analyzer", "semantic", "scoring-patterns.json");
}

/**
 * Validate a pageKey / scraping key. Unlike a runId these legitimately
 * contain "/" segments (e.g. "manual/example.com/post/:id"), so validation
 * is segment-based: reject backslashes, URL-like strings, drive letters,
 * absolute (leading "/"), and any empty / "." / ".." segment. Valid derived
 * keys with ":" (":id", "about:blank") and "<invalid-url>" are preserved.
 * @param {string} pageKey
 * @returns {string}
 */
export function validatePageKey(pageKey) {
  if (typeof pageKey !== "string" || pageKey.trim() === "") {
    throw new Error("pageKey must be a non-empty string.");
  }
  if (pageKey.includes("\0")) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: null bytes are not allowed.`);
  }
  if (pageKey.includes("\\")) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: backslashes are not allowed.`);
  }
  if (pageKey.includes("://")) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: must be a relative key, not a URL.`);
  }
  if (/^[A-Za-z]:/.test(pageKey)) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: drive-letter / absolute paths are not allowed.`);
  }
  if (pageKey.startsWith("/")) {
    throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: must be relative, not absolute.`);
  }
  for (const segment of pageKey.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Invalid pageKey ${JSON.stringify(pageKey)}: empty or relative path segment ${JSON.stringify(segment)}.`);
    }
  }
  return pageKey;
}

/**
 * Per-page extractor-config + golden paths. pageKey may contain `/`
 * segments — the directory layout mirrors that structure (same as pagePaths).
 * @param {string} pageKey
 */
export function scrapingPaths(pageKey) {
  validatePageKey(pageKey);
  const scrapingDir = resolve(getScrapingRoot(), pageKey);
  assertInsideRoot(scrapingDir, getScrapingRoot(), "scrapingDir");
  return {
    pageKey,
    scrapingDir,
    configPath: resolve(scrapingDir, "config.json"),
    goldenPath: resolve(scrapingDir, "golden.json")
  };
}

/**
 * Per-page-node file paths. The pageKey may contain `/`
 * segments — the directory layout mirrors that structure.
 *
 * @param {string} pageKey
 */
export function pagePaths(pageKey) {
  validatePageKey(pageKey);
  const pageDir = resolve(getPagesRoot(), pageKey);
  assertInsideRoot(pageDir, getPagesRoot(), "pageDir");
  return {
    pageKey,
    pageDir,
    selectorsPath: resolve(pageDir, "selectors.json"),
    neighborsPath: resolve(pageDir, "neighbors.json"),
    metaPath: resolve(pageDir, "meta.json"),
    moldPath: resolve(pageDir, "mold.json"),
    snapshotsDir: resolve(pageDir, "snapshots"),
    exploredEdgesPath: resolve(pageDir, "explored-edges.json")
  };
}

/**
 * Destination path for a snapshot lifted into a page-node's
 * time-series. Filename is the capture-time epoch in ms — monotonic
 * ordering when directory listed; cross-run uniqueness because
 * timestamps differ. Same-ms collision within a single run is
 * possible only when two framenavigated events fire in the same
 * millisecond — overwrites the prior file, which is acceptable for
 * a debug-time time-series.
 *
 * @param {string} pageKey
 * @param {number} timestampMs
 */
export function pageSnapshotPath(pageKey, timestampMs) {
  const paths = pagePaths(pageKey);
  return resolve(paths.snapshotsDir, `${timestampMs}.html.gz`);
}

/**
 * Named persistent capture profiles root.
 * `BROWSER_FLOW_PROFILES_PATH` overrides for tests (same pattern as
 * the registry + pages overrides). Default is `<repoRoot>/profiles`
 * which is gitignored.
 */
export function getProfilesRoot() {
  const override = process.env.BROWSER_FLOW_PROFILES_PATH;
  return override ? resolve(override) : resolve(repoRoot, "profiles");
}

// Profile name format — lowercase alphanumeric + dash,
// 1-60 chars, must start with alphanumeric. Strict on purpose:
// (a) lowercase avoids macOS case-insensitive filesystem collisions,
// (b) dash-separated keeps the name shell-safe without escaping,
// (c) 60-char cap defends against Windows path-length issues.
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

/**
 * Validate a profile name and return its on-disk directory.
 * Throws when the name violates the strict format.
 *
 * @param {string} profileName
 */
export function profilePath(profileName) {
  if (typeof profileName !== "string" || !PROFILE_NAME_PATTERN.test(profileName)) {
    throw invalidUsage(
      `Invalid profile name "${profileName}". Must match ${String(PROFILE_NAME_PATTERN)} (lowercase alphanumeric + dash, 1-60 chars, must start with alphanumeric).`,
      ["browser-flow prepare --help"],
      {
        subtype: "invalid_profile_name",
        param: "--profile-name",
        hint: "Pass a --profile-name that is lowercase alphanumeric plus dash, 1-60 chars, starting alphanumeric.",
        retryable: false
      }
    );
  }
  return resolve(getProfilesRoot(), profileName);
}

/**
 * Verify-spec paths for a given run.
 * - basePath: committed canonical question set
 * - overridePath: per-user override (gitignored); BROWSER_FLOW_VERIFY_SPEC_PATH env overrides
 * - perRunPath: per-run captured answers
 *
 * @param {string} runId
 */
export function getVerifySpecPaths(runId) {
  validateRunId(runId);
  const overrideEnv = process.env.BROWSER_FLOW_VERIFY_SPEC_PATH;
  const perRunPath = resolve(getPaths().runsRoot, runId, "verify-spec.json");
  assertInsideRoot(perRunPath, getPaths().runsRoot, "perRunPath");
  return {
    basePath: resolve(repoRoot, "knowledge", "verify-spec", "questions.base.json"),
    overridePath: overrideEnv
      ? resolve(overrideEnv)
      : resolve(repoRoot, "verify-spec", "override.json"),
    perRunPath
  };
}

/**
 * @param {string} runId
 */
export function getRunPaths(runId) {
  validateRunId(runId);
  const paths = getPaths();
  const runRoot = resolve(paths.runsRoot, runId);
  assertInsideRoot(runRoot, paths.runsRoot, "runRoot");
  return {
    runId,
    runRoot,
    manifestPath: resolve(runRoot, "manifest.json"),
    controlPath: resolve(runRoot, "control.json"),
    daemonLogPath: resolve(runRoot, "daemon.log"),
    sanitizedEventsPath: resolve(runRoot, "sanitized-events.json"),
    networkSummaryPath: resolve(runRoot, "network-summary.json"),
    selectorsPath: resolve(runRoot, "selectors.json"),
    pageEvidencePath: resolve(runRoot, "page-evidence.json"),
    tracePath: resolve(runRoot, "trace.jsonl"),
    rawEventsPath: resolve(runRoot, "raw-events.jsonl"),
    rawPageEvidencePath: resolve(runRoot, "raw-page-evidence.json"),
    workflowJsonPath: resolve(runRoot, "analysis", "workflow.json"),
    pathYamlPath: resolve(runRoot, "analysis", "path.yaml"),
    recipeYamlPath: resolve(runRoot, "analysis", "recipe.yaml"),
    ignoredEventsPath: resolve(runRoot, "analysis", "ignored-events.json"),
    captureNoisePreviewPath: resolve(runRoot, "analysis", "capture-noise-preview.json"),
    captureNoiseResultPath: resolve(runRoot, "analysis", "capture-noise-result.json"),
    locatorIntentPreviewPath: resolve(runRoot, "analysis", "locator-intent-preview.json"),
    locatorIntentResultPath: resolve(runRoot, "analysis", "locator-intent-result.json"),
    routeIntentPreviewPath: resolve(runRoot, "analysis", "route-intent-preview.json"),
    routeIntentResultPath: resolve(runRoot, "analysis", "route-intent-result.json"),
    runnerPath: resolve(runRoot, "generated", "runner.mjs"),
    generationMetaPath: resolve(runRoot, "generated", "generation.json"),
    verificationPath: resolve(runRoot, "reports", "verification.json"),
    securityPath: resolve(runRoot, "reports", "security.json"),
    screenshotsDir: resolve(runRoot, "reports", "screenshots"),
    screenshotsManifestPath: resolve(runRoot, "reports", "screenshots-manifest.json"),
    analysisDir: resolve(runRoot, "analysis"),
    eventsDir: resolve(runRoot, "events"),
    generatedDir: resolve(runRoot, "generated"),
    reportsDir: resolve(runRoot, "reports"),
    snapshotsDir: resolve(runRoot, "snapshots"),
    composeDir: resolve(runRoot, "compose"),
    composeRequestPath: resolve(runRoot, "compose", "compose-request.json"),
    composePlanPath: resolve(runRoot, "compose", "compose-plan.json"),
    composeSessionPath: resolve(runRoot, "compose", "compose-session.json"),
    composeJournalPath: resolve(runRoot, "compose", "compose-journal.jsonl"),
    composeSummaryPath: resolve(runRoot, "reports", "compose-summary.json"),
    captureJournalPath: resolve(runRoot, "events", "journal.jsonl"),
    stepLedgerPath: resolve(runRoot, "analysis", "step-ledger.json"),
    snapshotsManifestPath: resolve(runRoot, "snapshots-manifest.json"),
    skeletonManifestPath: resolve(runRoot, "skeleton-manifest.json"),
    // Task-unit state framework — each task unit
    // (variable-extraction, future composition request, etc.) is
    // stored as `<kind>.json` under this directory. See
    // scripts/lib/workflow-status.mjs for the state machine.
    tasksDir: resolve(runRoot, "tasks"),
    // Write-ahead state journal — append-only JSONL per run.
    journalPath: resolve(runRoot, "state-journal.jsonl"),
    // Heal-request artifact — emitted on drift-hold for the heal sub-agent.
    healRequestPath: resolve(runRoot, "heal-request.json"),
    // Scoring-request artifact — emitted on drift-hold for the scoring loop.
    scoringRequestPath: resolve(runRoot, "scoring-request.json"),
    // Scope-agent request/result — emitted at analyze for signal-poor steps.
    scopeRequestPath: resolve(runRoot, "scope-request.json"),
    scopeResultPath: resolve(runRoot, "scope-result.json"),
    // Reveal-agent request/result — emitted at analyze for ambiguous
    // stateful-affordance controls and applied before runner regeneration.
    revealRequestPath: resolve(runRoot, "reveal-request.json"),
    revealResultPath: resolve(runRoot, "reveal-result.json"),
    // Scraping extractor — request/result + run-scoped config + extracted data.
    scrapeRequestPath: resolve(runRoot, "scrape-request.json"),
    scrapeResultPath: resolve(runRoot, "scrape-result.json"),
    extractorConfigPath: resolve(runRoot, "extractor-config.json"),
    extractResultPath: resolve(runRoot, "extract-result.json"),
    dataResultPath: resolve(runRoot, "reports", "data-result.json"),
    extractHealRequestPath: resolve(runRoot, "extract-heal-request.json"),
    extractHealResultPath: resolve(runRoot, "extract-heal-result.json")
  };
}

/**
 * Task-unit file path for a given runId + kind.
 *
 * @param {string} runId
 * @param {string} kind
 */
export function getTaskPath(runId, kind) {
  if (!kind || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(kind)) {
    throw new Error(`Invalid task kind "${kind}". Must match /^[a-z0-9][a-z0-9-]{0,59}$/.`);
  }
  return resolve(getRunPaths(runId).tasksDir, `${kind}.json`);
}

/**
 * Snapshot file path. Flat per-run; index is zero-padded for chronological sort.
 *
 * @param {ReturnType<typeof getRunPaths>} runPaths
 * @param {number} index
 * @param {string} urlSlug
 */
export function snapshotPath(runPaths, index, urlSlug) {
  const paddedIndex = String(index).padStart(3, "0");
  const cleanSlug = String(urlSlug || "page").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "page";
  return resolve(runPaths.snapshotsDir, `${paddedIndex}-${cleanSlug}.html.gz`);
}

/**
 * URL → filesystem-safe slug. Uses URL.pathname; query string
 * dropped (would balloon the path; URL itself is recorded in the
 * manifest sibling file).
 *
 * @param {string} rawUrl
 */
export function slugifyUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname || "/";
    return path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/[^A-Za-z0-9._-]/g, "_") || "root";
  } catch (urlError) {
    return "invalid-url";
  }
}

/**
 * @param {string} prefix
 */
function createEphemeralDir(prefix) {
  const root = resolve(tmpdir(), "browser-flow-runtime");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `${prefix}-`));
}

/**
 * @param {string} runId
 */
export function createCaptureProfileDir(runId) {
  validateRunId(runId);
  return createEphemeralDir(`capture-${runId}`);
}

/**
 * @param {string} runId
 */
export function getReplayProfileDir(runId) {
  validateRunId(runId);
  return createEphemeralDir(`replay-${runId}`);
}

/**
 * Stable (non-ephemeral) profile dir for the attach workflow. Unlike
 * createEphemeralDir (mkdtemp random suffix, abandoned per call), this returns
 * a FIXED path so a human login persists across `bf serve-browser` restarts —
 * the user logs into the real site once and the profile keeps the session.
 * @param {string} runId
 */
export function getAttachProfileDir(runId) {
  validateRunId(runId);
  const root = resolve(tmpdir(), "browser-flow-runtime");
  const dir = join(root, `attach-${runId}`);
  assertInsideRoot(dir, root, "attach profile dir");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureBootstrapDirs() {
  const paths = getPaths();
  for (const value of Object.values(paths)) {
    if (!value.endsWith(".json") && !value.endsWith(".md")) {
      mkdirSync(value, { recursive: true });
    }
  }
  mkdirSync(dirname(paths.registryPath), { recursive: true });
  return paths;
}

/**
 * @param {string} runId
 */
export function ensureRunDirs(runId) {
  ensureBootstrapDirs();
  const paths = getRunPaths(runId);
  mkdirSync(paths.runRoot, { recursive: true });
  mkdirSync(paths.analysisDir, { recursive: true });
  mkdirSync(paths.eventsDir, { recursive: true });
  mkdirSync(paths.generatedDir, { recursive: true });
  mkdirSync(paths.reportsDir, { recursive: true });
  mkdirSync(paths.composeDir, { recursive: true });
  return paths;
}
