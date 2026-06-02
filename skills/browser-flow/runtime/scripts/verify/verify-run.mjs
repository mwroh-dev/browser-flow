import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createBrowserSession } from "../cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../cdp/watchdogs/lifecycle.mjs";
import { getRunPaths, getReplayProfileDir } from "../lib/config.mjs";
import { generateDummyName } from "../lib/dummy-naming.mjs";
import { affectedByHold } from "../lib/dependency-graph.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { saveSession as keychainSaveSession, readSession as keychainReadSession } from "../lib/keychain.mjs";
import { getFreePort } from "../lib/net.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";
import { parseWorkflowArtifact, parseVerificationArtifact } from "../lib/schemas.mjs";
import { buildVerificationSummary } from "../lib/report-summary.mjs";
import { captureSessionState as captureSessionStateReal } from "../lib/session-state.mjs";
import { createReadlineAsk } from "../lib/variable-agent-interaction.mjs";
import { bindInputs } from "../lib/workflow-inputs.mjs";
import { deriveVerificationOutcomes } from "../lib/verification-outcomes.mjs";
import { upsertRegistryEntry } from "../registry/workflow-registry.mjs";
import { buildPublicReadPromotion } from "../registry/external-promotion.mjs";
import { assertLocalWorkflow } from "../security/local-only.mjs";
import { sanitizeEvidenceText, sanitizeUrl } from "../security/redact.mjs";
import { scanArtifacts, isSecurityClean } from "../security/scan-artifacts.mjs";

/**
 * @typedef {{
 *   success: boolean,
 *   pathComplete: boolean,
 *   executedSteps: string[],
 *   stepCount: number,
 *   transitionChecks: unknown[],
 *   proofChecks?: unknown[],
 *   resultEvidence?: { passed: boolean, selector: string, actualText: string, expectedText: string },
 *   failureReason?: string,
 *   error?: string
 * }} VerificationReport
 */

/**
 * @typedef {(ref: string) => string | null} ReadSessionFn
 */

/**
 * Injectable seam for launching a browser session in first mode.
 * Returns a minimal CDP session shape (client + sessionManager + dispose).
 * The loose shape allows test fakes without needing to satisfy the full CdpClient interface.
 * @typedef {(opts: { profileDir: string, debugPort: number, headless: boolean }) => Promise<{
 *   client: unknown,
 *   sessionManager: {
 *     listPageTargets: () => Array<{ targetId: string }>,
 *     getSessionId: (targetId: string) => string | undefined
 *   },
 *   dispose: () => Promise<void>
 * }>} LaunchSessionFn
 */

/**
 * @param {string} runId
 * @param {{
 *   headless: boolean,
 *   mode?: "first" | "repeat",
 *   attachPort?: number,
 *   readSession?: ReadSessionFn,
 *   launchSession?: LaunchSessionFn,
 *   ask?: (prompt: string) => Promise<string>,
 *   captureSessionState?: (client: unknown, sessionId: string) => Promise<{ cookies: Array<Record<string, unknown>> }>,
 *   saveSession?: (ref: string, value: string) => void
 * }} options
 */
export async function verifyRun(runId, options) {
  const runPaths = getRunPaths(runId);
  const workflowDoc = parseWorkflowArtifact(
    readJson(runPaths.workflowJsonPath),
    runPaths.workflowJsonPath
  );
  // unmasked debug captures emit workflow.security.localOnly=false.
  // Skip the local-only structural assertion (URLs are external by design);
  // the persistence-boundary block in workflow-registry.mjs preserves
  // constitutional invariant #1.
  const workflowUnmasked = workflowDoc.security?.localOnly === false;
  if (!workflowUnmasked) {
    assertLocalWorkflow(workflowDoc);
  }

  // first/repeat auth modes.
  // Resolve the sessionState (if any) from the workflow preconditions.
  // The value is passed to the runner subprocess via an env var — it never
  // appears in any artifact, report, or returned object (agent-blind invariant).
  /** @type {string | null} */
  let sessionStateEnv = null;

  const preconditions = /** @type {Array<{kind: string, sessionRef: string, site: string}> | undefined} */ (
    workflowDoc.preconditions
  );
  const loginPrecondition = preconditions?.find((p) => p.kind === "login");

  // attach mode — auth is provided by the attached (already logged-in)
  // browser, so skip the keychain/cookie-injection/--first bootstrap entirely.
  if (loginPrecondition && !options.attachPort) {
    const resolvedReadSession = options.readSession ?? keychainReadSession;
    const mode = options.mode ?? "repeat";

    if (mode === "repeat") {
      const raw = resolvedReadSession(loginPrecondition.sessionRef);
      if (raw === null) {
        // Session absent — report needs-first-bootstrap, do NOT silently proceed.
        /** @type {VerificationReport} */
        const bootstrapReport = {
          success: false,
          pathComplete: false,
          executedSteps: [],
          stepCount: 0,
          transitionChecks: [],
          failureReason: "needs-first-bootstrap: session absent for " + loginPrecondition.sessionRef +
            " — run verify with --first to complete the human login bootstrap"
        };
        const verifiedAt = new Date().toISOString();
        const finalReport = parseVerificationArtifact(
          {
            schemaVersion: SCHEMA_VERSIONS.verification,
            ...bootstrapReport,
            securityOk: false,
            verifiedAt
          },
          runPaths.verificationPath
        );
        writeJson(runPaths.verificationPath, finalReport);
        const scanOpts = { unmasked: workflowDoc.security?.localOnly === false };
        const security = scanArtifacts(runPaths.runRoot, runPaths.securityPath, scanOpts);
        upsertRegistryEntry({
          id: runId,
          fixture: workflowDoc.fixture ?? "manual",
          runId,
          pathYamlPath: runPaths.pathYamlPath,
          recipeYamlPath: runPaths.recipeYamlPath,
          runnerPath: runPaths.runnerPath,
          verificationPath: runPaths.verificationPath,
          securityPath: runPaths.securityPath,
          status: "failed",
          security: workflowDoc.security
        });
        return { ok: false, report: finalReport, security };
      }
      // Session present — pass it to the runner subprocess via env var (never logged).
      sessionStateEnv = raw;
    } else {
      // mode === "first": interactive human login bootstrap.
      // Launch a VISIBLE Chrome, navigate to the login site, wait for the human to
      // log in (Enter), capture the authenticated session, save it to the keychain.
      // Agent-blind: session value goes ONLY to the keychain — never in report/stdout.
      // Return early without spawning the runner.

      const resolvedLaunchSession = options.launchSession ??
        /** @type {LaunchSessionFn} */ (/** @type {unknown} */ (createBrowserSession));
      const resolvedAsk = options.ask ?? createReadlineAsk().ask;
      const resolvedCaptureSessionState = /** @type {(client: unknown, sessionId: string) => Promise<{ cookies: Array<Record<string, unknown>> }>} */ (
        options.captureSessionState ?? captureSessionStateReal
      );
      const resolvedSaveSession = options.saveSession ?? keychainSaveSession;

      const profileDir = getReplayProfileDir(runId);
      const debugPort = await getFreePort();

      const session = await resolvedLaunchSession({ profileDir, debugPort, headless: false });

      // Navigate to the login site best-effort (catch navigation errors gracefully).
      const [target] = session.sessionManager.listPageTargets();
      if (target) {
        try {
          const lifecycle = await installLifecycleWatchdog(
            /** @type {import("../cdp/browser-session.mjs").CdpSession} */ (/** @type {unknown} */ (session))
          );
          const rawSite = loginPrecondition.site;
          const siteUrl = rawSite.startsWith("http://") || rawSite.startsWith("https://")
            ? rawSite
            : "https://" + rawSite;
          await lifecycle.navigateAndWait(target.targetId, siteUrl, { waitUntil: "load", timeoutMs: 30_000 });
          await lifecycle.dispose();
        } catch (_navErr) {
          // Navigation failure is non-fatal — the browser is open, human can navigate manually.
        }
      }

      // Wait for human to complete login (2FA included).
      await resolvedAsk("브라우저에서 로그인을 완료한 뒤 Enter를 누르세요 ");

      // Capture the authenticated session (cookies) — agent-blind.
      const captureTarget = target ?? session.sessionManager.listPageTargets()[0];
      const sid = captureTarget
        ? session.sessionManager.getSessionId(captureTarget.targetId)
        : undefined;
      const state = sid
        ? await resolvedCaptureSessionState(/** @type {unknown} */ (session.client), sid)
        : { cookies: [] };

      // Save to keychain only — NEVER log or include in report.
      resolvedSaveSession(loginPrecondition.sessionRef, JSON.stringify(state));

      await session.dispose();

      // Build a first-mode verification report (schema-compatible, no session value).
      const verifiedAt = new Date().toISOString();
      // Run a real security scan over the run artifacts — first mode no longer
      // claims green unconditionally.
      const firstScanOpts = { unmasked: workflowDoc.security?.localOnly === false };
      const firstSecurity = scanArtifacts(runPaths.runRoot, runPaths.securityPath, firstScanOpts);
      const firstModeReport = parseVerificationArtifact(
        {
          schemaVersion: SCHEMA_VERSIONS.verification,
          success: true,
          pathComplete: false,
          executedSteps: [],
          stepCount: 0,
          transitionChecks: [],
          securityOk: isSecurityClean(firstSecurity),
          verifiedAt,
          // First-mode metadata — bootstrap, NOT a verified replay.
          mode: "first",
          bootstrapped: loginPrecondition.sessionRef,
          diagnosticMode: firstScanOpts.unmasked,
          note: "세션 저장됨 — --repeat로 재실행 (bootstrap only; not replay-verified)"
        },
        runPaths.verificationPath
      );
      writeJson(runPaths.verificationPath, firstModeReport);

      upsertRegistryEntry({
        id: runId,
        fixture: workflowDoc.fixture ?? "manual",
        runId,
        pathYamlPath: runPaths.pathYamlPath,
        recipeYamlPath: runPaths.recipeYamlPath,
        runnerPath: runPaths.runnerPath,
        verificationPath: runPaths.verificationPath,
        securityPath: runPaths.securityPath,
        // bootstrap is NOT verified — a human login was captured, but no
        // truthful replay + security gate has run.
        status: "bootstrapped",
        security: workflowDoc.security
      });

      return { ok: true, report: firstModeReport };
    }
  }

  // dummy-substitute text inputs when no sandbox is available.
  // When sandbox.available !== true and the workflow declares text-type inputs,
  // generate dummy binding values (prefix+hash) so the runner never touches
  // real user data. Pass bindings to the runner via BROWSER_FLOW_DUMMY_BINDINGS
  // (mirrors the BROWSER_FLOW_SESSION_STATE agent-blind channel).
  // When sandbox.available === true, the operator's sandbox absorbs real values
  // — no substitution needed.
  /** @type {string | null} */
  let dummyBindingsJson = null;
  /** @type {string[]} */
  let dummyBindingNames = [];

  const safety = /** @type {{ sandbox?: { available?: boolean }, irreversibleStepIndexes?: number[], consentRequired?: boolean } | undefined} */ (
    workflowDoc.safety
  );
  const workflowInputs = /** @type {Array<{ name: string, type: string }> | undefined} */ (
    /** @type {any} */ (workflowDoc).inputs
  );

  if (safety?.sandbox?.available !== true && Array.isArray(workflowInputs) && workflowInputs.length > 0) {
    const teardownNaming = /** @type {{ dummyNaming?: { prefix?: string, hashLen?: number } } | undefined} */ (
      /** @type {any} */ (workflowDoc).teardown
    );
    const prefix = teardownNaming?.dummyNaming?.prefix ?? "__bf_test__";
    const hashLen = teardownNaming?.dummyNaming?.hashLen ?? 8;

    /** @type {Record<string, string>} */
    const bindings = {};
    for (const input of workflowInputs) {
      if (input.type === "text") {
        bindings[input.name] = generateDummyName(prefix, hashLen);
        dummyBindingNames.push(input.name);
      }
    }

    if (Object.keys(bindings).length > 0) {
      dummyBindingsJson = JSON.stringify(bindings);
    }
  }

  /** @type {VerificationReport} */
  let report;
  try {
    report = await spawnRunner(runPaths.runnerPath, options.headless, sessionStateEnv, dummyBindingsJson, options.attachPort);
  } catch (error) {
    report = {
      success: false,
      pathComplete: false,
      executedSteps: [],
      stepCount: 0,
      transitionChecks: [],
      resultEvidence: {
        passed: false,
        selector: "",
        actualText: "",
        expectedText: ""
      },
      error: error instanceof Error ? error.message : String(error)
    };
  }

  // If the runner wrote a verification artifact to disk, prefer it as the
  // base report (it has already been sanitized by the runner's own
  // sanitizeReport pass).  Fall back to the in-memory report on failure.
  if (existsSync(runPaths.verificationPath)) {
    try {
      const onDisk = /** @type {VerificationReport} */ (readJson(runPaths.verificationPath));
      // Merge: keep runner-written fields, overlay the in-memory error if
      // the subprocess crashed before writing a meaningful report.
      report = { ...onDisk, ...(report.error ? { error: report.error } : {}) };
    } catch (_) {
      // Disk artifact corrupt — keep in-memory report.
    }
  }

  report = sanitizeVerificationReport(report);
  if (existsSync(runPaths.screenshotsManifestPath)) {
    try {
      const screenshotManifest = /** @type {{ mode?: string, entries?: unknown[] }} */ (readJson(runPaths.screenshotsManifestPath));
      /** @type {any} */ (report).screenshotArtifacts = {
        mode: typeof screenshotManifest.mode === "string" ? screenshotManifest.mode : "off",
        count: Array.isArray(screenshotManifest.entries) ? screenshotManifest.entries.length : 0,
        manifestPath: runPaths.screenshotsManifestPath
      };
    } catch {
      // Ignore malformed screenshot manifests — verification stays truthful based
      // on route/evidence/security, and S2 tests cover well-formed emission.
    }
  }
  if (!report.resultEvidence || report.resultEvidence.passed !== true) {
    report.success = false;
  }

  // on a drift-hold, compute which segments are invalidated — the held
  // segment + downstream segments data-dependent on it (variable-binding cascade).
  // Independent downstream is NOT listed (partial degradation: "뒷 연결고리는 작동").
  if (typeof (/** @type {any} */ (report).heldAtSegment) === "number") {
    /** @type {any} */ (report).affectedSegments = affectedByHold(
      /** @type {any} */ (workflowDoc),
      /** @type {any} */ (report).heldAtSegment
    );
  }

  // propagate safety surface into verification report so the
  // operator can see what was skipped and that consent is required.
  // excludedSteps comes from the runner report (runner records the skips).
  // consentRequired comes from workflow.safety (compile-time classification).
  // Note: `safety` was extracted above in the dummy-substitute block (reused here).
  if (safety?.consentRequired === true) {
    /** @type {any} */ (report).consentRequired = true;
  }
  // excludedSteps is already in the report from the runner; keep it as-is
  // (runner writes it, verify preserves it via the spread-merge above).

  // record dummy binding NAMES (not values — names are not secret)
  // in the report so teardown/orphan-sweep can find them.
  if (dummyBindingNames.length > 0) {
    /** @type {any} */ (report).dummyBindingNames = dummyBindingNames;
  }

  // derive teardownComplete from the runner's teardownSteps.
  // teardownSteps is already in the report (passed through via on-disk spread).
  // teardownComplete = true when teardownSteps is absent/empty OR every entry ok===true.
  {
    const steps = /** @type {Array<{action: string, ok: boolean, error?: string}> | undefined} */ (
      /** @type {any} */ (report).teardownSteps
    );
    /** @type {any} */ (report).teardownComplete =
      steps === undefined || steps.length === 0 || steps.every((s) => s.ok === true);
  }

  const verifiedAt = new Date().toISOString();
  let finalReport = parseVerificationArtifact(
    {
      schemaVersion: SCHEMA_VERSIONS.verification,
      ...report,
      securityOk: false,
      verifiedAt
    },
    runPaths.verificationPath
  );
  writeJson(runPaths.verificationPath, finalReport);
  // under --unmasked captures, verify-time security scan
  // becomes warn-not-block (mirroring persist-time behavior).
  // Persistence boundary (registry upsert) remains the constitutional
  // invariant #1 enforcement point.
  const scanOpts = { unmasked: workflowUnmasked };
  let security = scanArtifacts(runPaths.runRoot, runPaths.securityPath, scanOpts);
  finalReport = parseVerificationArtifact(
    {
      ...finalReport,
      securityOk: isSecurityClean(security)
    },
    runPaths.verificationPath
  );
  writeJson(runPaths.verificationPath, finalReport);
  security = scanArtifacts(runPaths.runRoot, runPaths.securityPath, scanOpts);
  const securityClean = isSecurityClean(security);
  const proofFailed = Array.isArray(report.proofChecks) &&
    report.proofChecks.some((check) =>
      check && typeof check === "object" && /** @type {{ passed?: unknown }} */ (check).passed === false
    );
  const replayPassed =
    report.success === true &&
    report.pathComplete === true &&
    report.resultEvidence?.passed !== false &&
    !proofFailed;
  const externalPublicReadPromotion = workflowUnmasked && replayPassed
    ? buildPublicReadPromotion(workflowDoc, security, { dataMode: "route" })
    : null;
  const clearOutcomes = deriveVerificationOutcomes({
    report,
    security,
    workflowUnmasked,
    securityClean,
    externalPublicReadPromoted: externalPublicReadPromotion !== null
  });
  finalReport = parseVerificationArtifact(
    {
      ...finalReport,
      ...classifyVerificationOutcome(report, securityClean, workflowDoc),
      ...clearOutcomes,
      securityOk: clearOutcomes.securityPromotionClean,
      diagnosticMode: workflowUnmasked
    },
    runPaths.verificationPath
  );
  writeJson(runPaths.verificationPath, finalReport);
  const summary = buildVerificationSummary({
    runId,
    verificationPath: runPaths.verificationPath,
    securityPath: runPaths.securityPath,
    report: finalReport
  });
  writeJson(resolve(runPaths.reportsDir, "verification-summary.json"), summary);
  // Pipeline-proceed uses raw security.ok (true under --unmasked even with
  // findings). The report's securityOk above uses isSecurityClean (false when
  // warningOnly). This split is intentional: "pipeline proceeded" ≠ a
  // user-facing green/clean claim, and registry promotion gates independently
  // block unapproved external entries from being persisted.
  const ok = Boolean(report.success) && security.ok;

  upsertRegistryEntry({
    id: runId,
    fixture: workflowDoc.fixture ?? "manual",
    runId,
    startUrl: workflowDoc.startUrl,
    finalUrl: workflowDoc.finalUrl,
    pathYamlPath: runPaths.pathYamlPath,
    recipeYamlPath: runPaths.recipeYamlPath,
    runnerPath: runPaths.runnerPath,
    verificationPath: runPaths.verificationPath,
    securityPath: runPaths.securityPath,
    status: ok && externalPublicReadPromotion ? "replay_verified" : ok ? "verified" : "failed",
    // propagate security claim so the registry upsert
    // refuses unmasked debug captures at the persistence boundary.
    security: workflowDoc.security,
    ...(externalPublicReadPromotion ? { promotion: externalPublicReadPromotion } : {})
  });

  return {
    ok,
    summary,
    report: finalReport,
    security
  };
}

/**
 * Spawn the generated runner.mjs as a subprocess and resolve with the
 * VerificationReport it returns via stdout JSON.  The runner also writes the
 * report to verificationPath on disk; callers can prefer the disk artifact.
 *
 * sessionStateJson is passed via the BROWSER_FLOW_SESSION_STATE
 * environment variable (process-local, never written to any artifact).
 * This keeps the session value agent-blind: it exists only in the live
 * subprocess environment and is consumed at runtime by runWorkflow().
 *
 * dummyBindingsJson is passed via BROWSER_FLOW_DUMMY_BINDINGS
 * (JSON object: { [inputName]: dummyValue }). The runner applies these
 * bindings at runtime if the env var is present. Names are not secret.
 *
 * @param {string} runnerPath  absolute path to the generated runner.mjs
 * @param {boolean} headless
 * @param {string | null} [sessionStateJson]  raw JSON string from keychain (agent-blind)
 * @param {string | null} [dummyBindingsJson]  JSON object mapping input names → dummy values
 * @param {number} [attachPort]  connect to a user-logged-in Chrome at this port instead of spawning one
 * @returns {Promise<VerificationReport>}
 */
function spawnRunner(runnerPath, headless, sessionStateJson, dummyBindingsJson, attachPort) {
  return new Promise((resolve, reject) => {
    const args = [runnerPath];
    if (headless) {
      args.push("--headless");
    }
    // Build env for subprocess. process.env values may be undefined (Node typings),
    // so filter them out to satisfy the spawn env contract.
    /** @type {Record<string, string>} */
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined).map(([k, v]) => [k, /** @type {string} */ (v)])
    );
    if (sessionStateJson) {
      // Agent-blind channel: env var is process-local, not written to disk.
      // The subprocess runner reads this in its CLI entry and passes it to
      // runWorkflow({ sessionState }) — never logs or returns it.
      env.BROWSER_FLOW_SESSION_STATE = sessionStateJson;
    }
    if (dummyBindingsJson) {
      // dummy binding channel. Names are not secret — they are
      // identifiable test-dummy values (prefix+hash). The runner applies
      // bindInputs at runtime if this env var is present.
      env.BROWSER_FLOW_DUMMY_BINDINGS = dummyBindingsJson;
    }
    if (attachPort) {
      // attach channel — the runner connects to the user's logged-in
      // Chrome at this port (no spawn, no cookie injection).
      env.BROWSER_FLOW_ATTACH_PORT = String(attachPort);
    }
    const proc = spawn(process.execPath, args, { stdio: "pipe", env });

    const stdoutChunks = /** @type {Buffer[]} */ ([]);
    const stderrChunks = /** @type {Buffer[]} */ ([]);

    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    proc.on("close", (code) => {
      const stdoutText = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code !== 0) {
        const errorMessage = stderrText || `runner exited with code ${code}`;
        return reject(new Error(errorMessage));
      }

      if (!stdoutText) {
        // Runner wrote to disk but produced no stdout — treat as success
        // with a minimal report; caller will read from disk.
        return resolve({
          success: true,
          pathComplete: true,
          executedSteps: [],
          stepCount: 0,
          transitionChecks: [],
        });
      }

      try {
        const parsed = /** @type {VerificationReport} */ (JSON.parse(stdoutText));
        resolve(parsed);
      } catch (_) {
        reject(new Error(`runner stdout was not valid JSON: ${stdoutText.slice(0, 200)}`));
      }
    });

    proc.on("error", reject);
  });
}

/**
 * @param {VerificationReport} report
 */
function sanitizeVerificationReport(report) {
  return {
    ...report,
    transitionChecks: report.transitionChecks.map((check) => {
      if (check && typeof check === "object" && "name" in check) {
        const typed = /** @type {{ name: string, expected?: unknown, actual?: unknown }} */ (check);
        if (typed.name === "final-url") {
          return {
            ...typed,
            expected: typeof typed.expected === "string" ? sanitizeUrl(typed.expected) : typed.expected,
            actual: typeof typed.actual === "string" ? sanitizeUrl(typed.actual) : typed.actual
          };
        }
        if (typed.name === "network") {
          return {
            ...typed,
            expected: sanitizeNetworkValue(typed.expected),
            actual: sanitizeNetworkValue(typed.actual)
          };
        }
      }
      return check;
    }),
    proofChecks: Array.isArray(report.proofChecks)
      ? report.proofChecks.map((check) => sanitizeProofCheck(check))
      : report.proofChecks,
    providerDiagnostics: sanitizeProofValue(/** @type {any} */ (report).providerDiagnostics),
    resultEvidence: report.resultEvidence
      ? {
          ...report.resultEvidence,
          actualText: sanitizeEvidenceText(report.resultEvidence.actualText),
          expectedText: sanitizeEvidenceText(report.resultEvidence.expectedText)
        }
      : report.resultEvidence,
    error: report.error ? sanitizeEvidenceText(report.error) : report.error
  };
}

/**
 * @param {unknown} check
 * @returns {unknown}
 */
function sanitizeProofCheck(check) {
  if (!check || typeof check !== "object") {
    return check;
  }
  const typed = /** @type {Record<string, unknown>} */ ({ ...check });
  typed.expected = sanitizeProofValue(typed.expected);
  typed.actual = sanitizeProofValue(typed.actual);
  return typed;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeProofValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeProofValue(entry));
  }
  if (value && typeof value === "object") {
    const typed = /** @type {Record<string, unknown>} */ ({ ...value });
    for (const key of ["url", "expectedUrl", "actualUrl"]) {
      if (typeof typed[key] === "string") {
        typed[key] = sanitizeUrl(/** @type {string} */ (typed[key]));
      }
    }
    if (typeof typed.text === "string") {
      typed.text = sanitizeEvidenceText(typed.text);
    }
    if (typeof typed.textIncludes === "string") {
      typed.textIncludes = sanitizeEvidenceText(typed.textIncludes);
    }
    if (typeof typed.actualText === "string") {
      typed.actualText = sanitizeEvidenceText(typed.actualText);
    }
    if (typeof typed.expectedText === "string") {
      typed.expectedText = sanitizeEvidenceText(typed.expectedText);
    }
    if (Array.isArray(typed.params)) {
      typed.params = typed.params.map((entry) => sanitizeProofValue(entry));
    }
    return typed;
  }
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return sanitizeUrl(value);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeNetworkValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeNetworkValue(entry));
  }
  if (value && typeof value === "object") {
    const entry = /** @type {Record<string, unknown>} */ (value);
    return {
      ...entry,
      url: typeof entry.url === "string" ? sanitizeUrl(entry.url) : entry.url
    };
  }
  return value;
}

/**
 * @param {VerificationReport} report
 * @param {boolean} securityClean
 * @param {{ steps?: Array<Record<string, any>> }} workflowDoc
 */
function classifyVerificationOutcome(report, securityClean, workflowDoc) {
  if (report.success === true && securityClean) {
    return {
      verificationOutcome: "verified",
      reasonCategory: "none",
      blockingGate: "none",
      userFault: false
    };
  }

  const failureReason = String(report.failureReason ?? "");
  const errorMessage = String(report.error ?? "");
  const message = `${failureReason}\n${errorMessage}`;
  const normalizedMessage = message.toLowerCase();
  const hasFailureDetail = failureReason.length > 0 || errorMessage.length > 0;

  if (
    failureReason === "provider-postcondition-failed" ||
    normalizedMessage.includes("provider postcondition failed")
  ) {
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "state_drift",
      blockingGate: "proof",
      userFault: false
    };
  }

  if (
    failureReason === "action-path-mismatch" ||
    normalizedMessage.includes("action-path mismatch")
  ) {
    const captureNoiseHint = deriveCaptureNoiseReviewHint(report, workflowDoc);
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "dynamic_content_drift",
      blockingGate: "action_path",
      userFault: false,
      ...captureNoiseHint
    };
  }

  if (
    normalizedMessage.includes("ambiguous locator") ||
    normalizedMessage.includes("no candidates on page") ||
    normalizedMessage.includes("method-b transition mismatch")
  ) {
    const captureNoiseHint = deriveCaptureNoiseReviewHint(report, workflowDoc);
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "locator_drift",
      blockingGate: "locator",
      userFault: false,
      ...captureNoiseHint
    };
  }

  const failedTransitionCheck = Array.isArray(report.transitionChecks) &&
    report.transitionChecks.some((check) =>
      check && typeof check === "object" && /** @type {{ passed?: unknown }} */ (check).passed === false
    );
  const proofChecks = Array.isArray(report.proofChecks) ? report.proofChecks : [];
  const failedProofCheck = proofChecks.some((check) =>
    check && typeof check === "object" && /** @type {{ passed?: unknown }} */ (check).passed === false
  );
  if (!hasFailureDetail && failedProofCheck) {
    const failedStateProof = proofChecks.some((check) =>
      check &&
      typeof check === "object" &&
      /** @type {{ kind?: unknown, passed?: unknown }} */ (check).kind === "state-control" &&
      /** @type {{ kind?: unknown, passed?: unknown }} */ (check).passed === false
    );
    return {
      verificationOutcome: "not_verified",
      reasonCategory: failedStateProof ? "state_drift" : "dynamic_content_drift",
      blockingGate: "proof",
      userFault: false
    };
  }
  if (
    failureReason === "expected-url-timeout" ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("transition mismatch") ||
    failedTransitionCheck
  ) {
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "transition_timeout",
      blockingGate: "transition",
      userFault: false
    };
  }

  if (!hasFailureDetail && report.resultEvidence?.passed === false) {
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "evidence_mismatch",
      blockingGate: "evidence",
      userFault: false
    };
  }

  if (!securityClean) {
    return {
      verificationOutcome: "not_verified",
      reasonCategory: "security_not_clean",
      blockingGate: "security",
      userFault: false
    };
  }

  return {
    verificationOutcome: "not_verified",
    reasonCategory: "replay_error",
    blockingGate: "runner",
    userFault: false
  };
}

/**
 * @param {VerificationReport} report
 * @param {{ steps?: Array<Record<string, any>> }} workflowDoc
 */
function deriveCaptureNoiseReviewHint(report, workflowDoc) {
  const steps = Array.isArray(workflowDoc?.steps) ? workflowDoc.steps : [];
  const executedCount = Array.isArray(report.executedSteps) ? report.executedSteps.length : 0;
  const candidateStep = steps[executedCount];
  if (!candidateStep || candidateStep.action !== "click") {
    return {};
  }
  const locator = candidateStep.locator && typeof candidateStep.locator === "object" ? candidateStep.locator : {};
  const transition = candidateStep.transition && typeof candidateStep.transition === "object" ? candidateStep.transition : {};
  const captureNoise = candidateStep.captureNoise && typeof candidateStep.captureNoise === "object" ? candidateStep.captureNoise : {};
  const role = typeof locator.role === "string" ? locator.role : typeof candidateStep.role === "string" ? candidateStep.role : "";
  const href = typeof candidateStep.href === "string" ? candidateStep.href : typeof locator.href === "string" ? locator.href : "";
  const reviewCandidateId = typeof captureNoise.reviewCandidateId === "string" ? captureNoise.reviewCandidateId : "";
  const reviewStatus = typeof captureNoise.reviewStatus === "string" ? captureNoise.reviewStatus : "";
  const hasTransitionEvidence = transition.settleStatus === "interrupted" ||
    nonEmptyArray(transition.appeared) ||
    nonEmptyArray(transition.disappeared) ||
    nonEmptyArray(transition.changed);
  if (reviewCandidateId && reviewStatus === "needs_review") {
    return {
      captureNoiseReviewRequired: true,
      checkpointHint: "capture_noise_review",
      captureNoiseCandidateId: reviewCandidateId
    };
  }
  const replayRisk = candidateStep.replayRisk && typeof candidateStep.replayRisk === "object"
    ? candidateStep.replayRisk
    : {};
  if (
    replayRisk.kind === "reviewed-implementation-layer" ||
    candidateStep.actionKind === "implementation-layer" ||
    candidateStep.isTrusted === false
  ) {
    return {
      captureNoiseReviewRequired: true,
      checkpointHint: "capture_noise_review",
      candidateKind: "ambiguous-implementation-layer-click"
    };
  }
  const visibilityRisk = candidateStep.visibilityRisk && typeof candidateStep.visibilityRisk === "object"
    ? candidateStep.visibilityRisk
    : {};
  if (visibilityRisk.kind === "hidden-or-layered-target") {
    return {
      captureNoiseReviewRequired: true,
      checkpointHint: "capture_noise_review",
      candidateKind: "ambiguous-hidden-control-burst"
    };
  }
  const box = locator.box && typeof locator.box === "object" ? locator.box : {};
  const zeroBox = (/** @type {any} */ (box).w <= 0 || /** @type {any} */ (box).h <= 0);
  if (zeroBox && (transition.settleStatus === "interrupted" || !hasTransitionEvidence)) {
    return {
      captureNoiseReviewRequired: true,
      checkpointHint: "capture_noise_review",
      candidateKind: "ambiguous-hidden-control-burst"
    };
  }
  if (isObservationNoopStep(candidateStep, locator, transition, hasTransitionEvidence)) {
    return {
      captureNoiseReviewRequired: true,
      checkpointHint: "capture_noise_review",
      candidateKind: "ambiguous-observation-click"
    };
  }
  if (role !== "button" || !href) {
    return {};
  }
  if (!hasTransitionEvidence) {
    return {};
  }
  return {
    captureNoiseReviewRequired: true,
    checkpointHint: "capture_noise_review",
    candidateKind: "ambiguous-prefix-toggle"
  };
}

/**
 * @param {Record<string, any>} step
 * @param {Record<string, any>} locator
 * @param {Record<string, any>} transition
 * @param {boolean} hasTransitionEvidence
 */
function isObservationNoopStep(step, locator, transition, hasTransitionEvidence) {
  if (hasTransitionEvidence && transition.settleStatus !== "settled") return false;
  const role = String(locator.role || step.role || "").toLowerCase();
  const actionKind = String(step.actionKind || "");
  const href = String(step.href || locator.href || "");
  let score = 0;
  if (actionKind === "observation") score += 3;
  if (["main", "banner", "region", "article", "section", "contentinfo", "navigation", "complementary", "search"].includes(role)) {
    score += 2;
  }
  if (!href) score += 1;
  if (isLargeBox(locator.box)) score += 1;
  if (String(step.observedTextSummary || "").trim()) score += 1;
  return score >= 3;
}

/**
 * @param {unknown} box
 */
function isLargeBox(box) {
  if (!box || typeof box !== "object") return false;
  const b = /** @type {Record<string, unknown>} */ (box);
  const w = typeof b.w === "number" ? b.w : 0;
  const h = typeof b.h === "number" ? b.h : 0;
  return w >= 240 && h >= 120;
}

/**
 * @param {unknown} value
 */
function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}
