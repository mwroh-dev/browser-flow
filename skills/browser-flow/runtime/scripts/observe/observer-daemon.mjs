import { once } from "node:events";
import http from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { getFreePort } from "../lib/net.mjs";
import { getRunPaths, slugifyUrl, snapshotPath } from "../lib/config.mjs";
import { startFixtureServer } from "../fixtures/site-server.mjs";
import { readJson, writeJson } from "../lib/fs.mjs";
import { persistSanitizedArtifacts } from "../sanitize/persist.mjs";
import { appendRawEvent } from "../lib/raw-event-log.mjs";
import { appendJournalEvent, toJournalEvent } from "../lib/capture-journal.mjs";
import { sanitizeDomSnapshot } from "../sanitize/dom-sanitize.mjs";
import { assertLocalUrl } from "../security/local-only.mjs";
import { sanitizeUrl } from "../security/redact.mjs";
import { createBrowserSession } from "../cdp/browser-session.mjs";
import { installRecorderWatchdog } from "../cdp/watchdogs/recorder.mjs";
import { installNetworkWatchdog } from "../cdp/watchdogs/network.mjs";
import { installLifecycleWatchdog } from "../cdp/watchdogs/lifecycle.mjs";
import { installDomWatchdog } from "../cdp/watchdogs/dom.mjs";
import { collectPageEvidence } from "./page-evidence.mjs";
import { recorderInitScript } from "./recorder-script.mjs";
import { locatorCaptureSource } from "./locator-capture.mjs";
import { makeTabOrdinal } from "./tab-ordinal.mjs";
import { createRunActionSeqTagger } from "./action-seq.mjs";
import { selectCaptureFinalTarget } from "./capture-target.mjs";

const runId = process.argv[2];
if (!runId) {
  throw new Error("observer-daemon requires a run id argument.");
}

const runPaths = getRunPaths(runId);
/** @type {import("../cdp/browser-session.mjs").BrowserSession | null} */
let activeSession = null;
/** @type {{ close: () => Promise<void> } | null} */
let activeFixtureServer = null;
/** @type {string | null} */
let activeProfileDir = null;
/** @type {boolean} */
let activeProfilePersistent = false;

process.on("uncaughtException", (error) => {
  handleDaemonError(error);
});
process.on("unhandledRejection", (error) => {
  handleDaemonError(error instanceof Error ? error : new Error(String(error)));
});

await main();

async function main() {
  const control = /** @type {{
   *   chromePath: string,
   *   debugPort: number,
   *   fixture: string,
   *   headless: boolean,
   *   profileDir?: string,
   *   profileMode?: string,
   *   profilePersistent?: boolean,
   *   runId: string,
   *   startUrl: string,
   *   captureMode?: string,
   *   snapshotDom?: boolean,
   *   unmasked?: boolean
   * }} */ (readJson(runPaths.controlPath));
  // when the profile is a named persistent one (mkdir-once,
  // reused across captures), the daemon must NOT rmSync the directory
  // at done/cleanup — operator login state lives there.
  const profilePersistent = control.profilePersistent === true;
  activeProfilePersistent = profilePersistent;
  // opt-in DOM snapshot mode. Flat per-run storage; lifted to per-page-node
  // in committed knowledge during compile.
  const snapshotMode = control.snapshotDom === true;
  const captureMode = control.captureMode === "strict" ? "strict" : "normal";
  let snapshotCounter = 0;
  // Serialization queue: prevents out-of-order snapshot writes when multiple
  // persistDomSnapshot calls fire concurrently.
  let snapshotQueue = Promise.resolve();
  /** @type {Array<{ index: number, url: string, timestamp: number, filename: string }>} */
  const snapshotEntries = [];
  /** @type {Array<{ url: string, skeleton: Array<{ role: string, name: string, structuralKey: string }> }>} */
  const skeletonEntries = [];
  if (snapshotMode) {
    mkdirSync(runPaths.snapshotsDir, { recursive: true });
  }
  const profileDir = process.env.BROWSER_FLOW_PROFILE_DIR || control.profileDir;
  if (!profileDir) {
    throw new Error("Observer daemon requires an ephemeral profile dir.");
  }

  /** @type {import("../sanitize/event-sanitizer.mjs").RawEvent[]} */
  const rawEvents = [];
  /** @type {import("../sanitize/event-sanitizer.mjs").RawEvent[]} */
  const networkEvents = [];
  const tabOrdinal = makeTabOrdinal();
  const tagActionSeq = createRunActionSeqTagger();
  let lastUserActionTargetId = "";
  let lastUserActionTabOrdinal = 0;
  let lastRealNavigateTargetId = "";
  let lastRealNavigateUrl = "";

  const controlPort = await getFreePort();
  const debugPort = control.debugPort > 0 ? control.debugPort : await getFreePort();
  const session = await createBrowserSession({
    chromePath: control.chromePath,
    debugPort,
    profileDir,
    headless: control.headless
  });
  activeSession = session;
  activeProfileDir = profileDir;
  const fixtureServer = control.fixture === "synthetic" || control.fixture === "docs" || control.fixture === "stateful" || control.fixture === "submit" || control.fixture === "secret" || control.fixture === "noanchor" || control.fixture === "signals" || control.fixture === "samename" || control.fixture === "urlstate"
    ? await startFixtureServer()
    : null;
  activeFixtureServer = fixtureServer;
  const rawStartUrl = process.env.BROWSER_FLOW_START_URL_RAW || control.startUrl;
  const resolvedStartUrlRaw = resolveStartUrl(control.fixture, rawStartUrl, fixtureServer?.baseUrl);
  // unmasked debug mode bypasses the URL-boundary local-only check.
  // Constitutional invariant #1 is preserved at the persistence
  // (registry-write) boundary instead — see compile.mjs +
  // workflow-registry.mjs.
  if (control.unmasked !== true) {
    assertLocalUrl(resolvedStartUrlRaw, "resolvedStartUrl");
  }
  // propagate --unmasked to the sanitize layer so external
  // start URLs are preserved in real-site captures.
  const resolvedStartUrl = sanitizeUrl(resolvedStartUrlRaw, { unmasked: control.unmasked === true });

  // Install recorder watchdog — replaces context.exposeBinding + addInitScript
  await installRecorderWatchdog(session, {
    bindingName: "__browserFlowRecord",
    script: `window.__bfCaptureMode = ${JSON.stringify(captureMode)};\n${recorderInitScript}`,
    onEvent(payload, meta) {
      const ord = tabOrdinal.ordinalFor(meta && meta.targetId ? meta.targetId : "");
      const sequenced = tagActionSeq(/** @type {any} */ (payload), {
        targetId: meta?.targetId,
        tabOrdinal: ord
      });
      const tagged = { ...(/** @type {any} */ (sequenced)), tabOrdinal: ord };
      if (meta?.targetId && isUserActionEvent(tagged) && tagged.isTrusted !== false) {
        lastUserActionTargetId = meta.targetId;
        lastUserActionTabOrdinal = ord;
      }
      if (snapshotMode && meta?.targetId && isUserActionEvent(tagged)) {
        const captureTargetId = meta.targetId;
        snapshotQueue = snapshotQueue.then(() =>
          persistDomSnapshot(captureTargetId).catch((snapshotError) => {
            console.error("pre-action snapshot capture failed:", snapshotError instanceof Error ? snapshotError.message : String(snapshotError));
          })
        );
      }
      rawEvents.push(/** @type {any} */ (tagged));
      appendCaptureJournal("recorder", tagged, control.unmasked === true);
      // stream every raw event to raw-events.jsonl so the
      // capture survives done-time fail-close.
      appendRawEvent(runPaths, /** @type {any} */ (tagged));
      appendBestEffortEnrichment(tagged, meta, control.unmasked === true);
    }
  });

  // Install network watchdog — replaces page.on('request'/'response')
  await installNetworkWatchdog(session, {
    onEvent(event) {
      networkEvents.push(/** @type {any} */ (event));
      // Strip CDP-internal correlation IDs (requestId, loaderId) before
      // writing to raw-events.jsonl — they are hex UUIDs that trigger the
      // high-entropy security scanner, and they are not user-facing data.
      const { requestId: _r, loaderId: _l, ...rawEvent } = /** @type {any} */ (event);
      appendCaptureJournal("cdp", rawEvent, control.unmasked === true);
      appendRawEvent(runPaths, /** @type {any} */ (rawEvent));
    }
  });

  // Install lifecycle watchdog — replaces page.goto + page.waitForLoadState
  const lifecycle = await installLifecycleWatchdog(session);

  // Install DOM watchdog — replaces page.content() in snapshot mode
  const dom = await installDomWatchdog(session);

  /**
   * @param {string | null | undefined} targetId
   * @param {string} [sourceUrl]
   */
  async function persistDomSnapshot(targetId, sourceUrl = "") {
    if (!snapshotMode || !targetId) return;
    const html = await dom.captureOuterHtml(targetId).catch(() => "");
    if (!html) return;
    const url = sourceUrl || await dom.currentUrl(targetId).catch(() => "");
    if (!url) return;
    const sanitized = sanitizeDomSnapshot(html);
    const compressed = gzipSync(sanitized);
    const index = snapshotCounter;
    snapshotCounter += 1;
    const timestamp = Date.now();
    const slug = slugifyUrl(url);
    const destination = snapshotPath(runPaths, index, slug);
    writeFileSync(destination, compressed);
    snapshotEntries.push({
      index,
      url,
      timestamp,
      filename: destination.slice(runPaths.snapshotsDir.length + 1)
    });
  }

  /** @type {Array<() => void>} */
  const frameNavigatedUnsubs = [];

  // snapshot mode — listen for Page.frameNavigated (main frame only)
  // replacing page.on("framenavigated") from Playwright.
  if (snapshotMode) {
    frameNavigatedUnsubs.push(session.client.on("Page.frameNavigated", (params, sessionIdArg) => {
      const p = /** @type {any} */ (params);
      // Only capture main-frame navigations (parentId absent or null/undefined).
      if (p.frame?.parentId !== undefined && p.frame?.parentId !== null) {
        return;
      }
      const sid = /** @type {string | undefined} */ (sessionIdArg);
      snapshotQueue = snapshotQueue.then(async () => {
        try {
          // Brief settle wait for domcontentloaded — best-effort.
          await delay(200);
          // Resolve the targetId for this session.
          const targetId = sid ? findTargetIdBySessionId(session, sid) : null;
          await persistDomSnapshot(targetId);
        } catch (snapshotError) {
          // Best-effort. Snapshot mode is opt-in debug data; do not fail
          // the capture run if one snapshot cannot be persisted.
          console.error("snapshot capture failed:", snapshotError instanceof Error ? snapshotError.message : String(snapshotError));
        }
      });
    }));
  }

  // affordance skeleton capture — unconditional (always-on),
  // read-only enumerate only, NO clicks/navigation.
  frameNavigatedUnsubs.push(session.client.on("Page.frameNavigated", async (params, sessionIdArg) => {
    const p = /** @type {any} */ (params);
    if (p.frame?.parentId !== undefined && p.frame?.parentId !== null) return; // main frame only
    try {
      await delay(200);
      const sid = /** @type {string | undefined} */ (sessionIdArg);
      const targetId = sid ? findTargetIdBySessionId(session, sid) : null;
      const frameUrl = typeof p.frame?.url === "string" ? p.frame.url : "";
      if (targetId && frameUrl && frameUrl !== "about:blank") {
        tabOrdinal.ordinalFor(targetId);
        lastRealNavigateTargetId = targetId;
        lastRealNavigateUrl = frameUrl;
      }
      if (!targetId) return;
      const url = await dom.currentUrl(targetId).catch(() => "");
      if (!url) return;
      const expr = "(function(){ " + locatorCaptureSource + "; return (typeof __bfAffordanceSkeleton === 'function') ? __bfAffordanceSkeleton() : []; })()";
      const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
      const skeleton = r && r.result && Array.isArray(r.result.value) ? r.result.value : [];
      if (skeleton.length > 0) skeletonEntries.push({ url, skeleton });
    } catch (skeletonError) {
      console.error("skeleton capture failed:", skeletonError instanceof Error ? skeletonError.message : String(skeletonError));
    }
  }));

  // Navigate to the start URL using lifecycle watchdog.
  const pageTargets = session.sessionManager.listPageTargets();
  const initialTargetId = pageTargets[0]?.targetId;
  if (resolvedStartUrlRaw && resolvedStartUrlRaw !== "about:blank" && initialTargetId) {
    await lifecycle.navigateAndWait(initialTargetId, resolvedStartUrlRaw, { waitUntil: "domcontentloaded" });
  }

  const server = http.createServer(async (request, response) => {
    if (request.url === "/status") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, runId, status: "ready", controlPort, debugPort }));
      return;
    }

    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "POST" && requestUrl.pathname === "/done") {
      const captureScreenshotMode = requestUrl.searchParams.get("captureScreenshot");
      if (captureScreenshotMode && captureScreenshotMode !== "final") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: `invalid captureScreenshot mode ${captureScreenshotMode}` }));
        return;
      }
      await settleCapture(rawEvents, networkEvents);
      const currentTargets = await enrichCaptureTargetsWithLiveUrls(
        session.sessionManager.listPageTargets(),
        dom
      );
      const finalUrl = lastRealNavigateUrl || lastNavigateUrlFromEvents(rawEvents) || resolvedStartUrlRaw;
      const captureTarget = captureScreenshotMode === "final"
        ? selectCaptureFinalTarget({
          targets: currentTargets,
          lastUserActionTargetId,
          lastUserActionTabOrdinal,
          lastRealNavigateTargetId,
          finalUrl,
          tabOrdinalForTarget: (targetId) => tabOrdinal.lookupOrdinal(targetId)
        })
        : null;
      const captureScreenshot = captureScreenshotMode === "final"
        ? await captureFinalScreenshot(session, captureTarget)
        : null;

      const pageEvidence = [];
      for (const target of currentTargets) {
        pageEvidence.push(...(await collectPageEvidence(session, target.targetId)));
      }
      // persist raw (unsanitized) page-evidence so `bf replay <runId>`
      // can re-run sanitize without re-driving the browser. Written before
      // persistSanitizedArtifacts so the raw copy survives even if
      // sanitize/scan fail-close downstream.
      writeJson(runPaths.rawPageEvidencePath, pageEvidence);

      // persist snapshots manifest so the analyzer can lift
      // captured snapshots into knowledge/pages/<pageKey>/snapshots/.
      if (snapshotMode && snapshotEntries.length > 0) {
        writeJson(runPaths.snapshotsManifestPath, {
          schemaVersion: 1,
          entries: snapshotEntries
        });
      }

      // persist affordance skeleton manifest — unconditional.
      if (skeletonEntries.length > 0) {
        writeJson(runPaths.skeletonManifestPath, { schemaVersion: 1, entries: skeletonEntries });
      }

      const result = persistSanitizedArtifacts({
        runPaths,
        manifest: {
          ...control,
          controlPort,
          debugPort,
          fixture: control.fixture,
          profileMode: "ephemeral-temp",
          runId,
          startUrl: resolvedStartUrl,
          captureMode
        },
        rawEvents,
        pageEvidence,
        networkEvents
      });

      writeJson(runPaths.controlPath, {
        ...control,
        controlPort,
        debugPort,
        startUrl: resolvedStartUrl,
        status: "done"
      });

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: result.security.ok,
        runId,
        artifacts: {
          manifestPath: runPaths.manifestPath,
          sanitizedEventsPath: runPaths.sanitizedEventsPath,
          networkSummaryPath: runPaths.networkSummaryPath,
          selectorsPath: runPaths.selectorsPath,
          pageEvidencePath: runPaths.pageEvidencePath,
          securityPath: runPaths.securityPath
        },
        security: result.security,
        ...(captureScreenshot ? { captureScreenshot } : {})
      }));

      for (const unsub of frameNavigatedUnsubs) unsub();
      await session.dispose();
      if (fixtureServer) {
        await fixtureServer.close();
      }
      await disposeProfileDir(profileDir, session.chromeProcess, profilePersistent);
      activeSession = null;
      activeFixtureServer = null;
      activeProfileDir = null;
      server.close(() => process.exit(0));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  server.listen(controlPort, "127.0.0.1", () => {
    writeJson(runPaths.controlPath, {
      ...control,
      controlPort,
      debugPort,
      chromePid: session.chromeProcess.pid,
      startUrl: resolvedStartUrl,
      status: "ready"
    });
  });
}

/**
 * @param {Array<Record<string, any>>} targets
 * @param {{ currentUrl: (targetId: string) => Promise<string> }} dom
 */
async function enrichCaptureTargetsWithLiveUrls(targets, dom) {
  return Promise.all((Array.isArray(targets) ? targets : []).map(async (target) => {
    const targetId = String(target?.targetId || "");
    if (!targetId) return target;
    const liveUrl = await dom.currentUrl(targetId).catch(() => "");
    return liveUrl ? { ...target, liveUrl } : target;
  }));
}

/**
 * @param {import("../cdp/browser-session.mjs").BrowserSession} session
 * @param {{ targetId: string, tabOrdinal: number, targetUrl: string, reason: string } | null} selection
 */
async function captureFinalScreenshot(session, selection) {
  const targetId = selection?.targetId ?? "";
  if (!targetId) {
    return { mode: "final", ok: false, error: "no page target available" };
  }
  const sid = session.sessionManager.getSessionId(targetId);
  if (!sid) {
    return { mode: "final", ok: false, error: `no sessionId for target ${targetId}` };
  }
  mkdirSync(runPaths.screenshotsDir, { recursive: true });
  const file = "capture-final.png";
  const path = `${runPaths.screenshotsDir}/${file}`;
  const restoreDom = await applyDomMaskShot(session, targetId);
  try {
    await session.client.send("Page.bringToFront", {}, sid).catch(() => {});
    const captured = /** @type {{ data?: string }} */ (await session.client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true
    }, sid));
    if (!captured || typeof captured.data !== "string" || captured.data.length === 0) {
      return { mode: "final", ok: false, error: "Screenshot capture returned no data." };
    }
    writeFileSync(path, Buffer.from(captured.data, "base64"));
    const entry = {
      kind: "capture-final",
      source: "capture",
      file,
      path,
      sanitized: true,
      verified: false,
      redaction: "dom-mask-v1",
      targetUrl: selection?.targetUrl ? sanitizeUrl(selection.targetUrl, { unmasked: true }) : "",
      tabOrdinal: typeof selection?.tabOrdinal === "number" ? selection.tabOrdinal : 0,
      targetSelectionReason: selection?.reason ?? ""
    };
    writeScreenshotManifest(entry);
    return {
      mode: "final",
      ok: true,
      path,
      manifestPath: runPaths.screenshotsManifestPath,
      targetUrl: entry.targetUrl,
      tabOrdinal: entry.tabOrdinal
    };
  } finally {
    await restoreDom();
  }
}

/**
 * @param {Record<string, unknown>} entry
 */
function writeScreenshotManifest(entry) {
  /** @type {Array<Record<string, unknown>>} */
  let entries = [];
  try {
    const existing = /** @type {{ entries?: Array<Record<string, unknown>> }} */ (readJson(runPaths.screenshotsManifestPath));
    entries = Array.isArray(existing.entries) ? existing.entries.filter((item) => item.kind !== entry.kind) : [];
  } catch {
    entries = [];
  }
  entries.push(entry);
  writeJson(runPaths.screenshotsManifestPath, {
    schemaVersion: 1,
    runId,
    mode: "capture-final",
    entries
  });
}

/**
 * @param {import("../cdp/browser-session.mjs").BrowserSession} session
 * @param {string} targetId
 * @returns {Promise<() => Promise<void>>}
 */
async function applyDomMaskShot(session, targetId) {
  const sid = session.sessionManager.getSessionId(targetId);
  if (!sid) return async () => {};
  const expression = "(" + function() {
    const selector = "input, textarea, [contenteditable]";
    const nonTextInputTypes = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);
    /** @type {Array<any>} */
    const records = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!(el instanceof HTMLElement)) continue;
      if (el instanceof HTMLInputElement && nonTextInputTypes.has((el.type || "").toLowerCase())) continue;
      const record = {
        el,
        value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : undefined,
        textContent: el.isContentEditable ? el.textContent : undefined,
        attrs: {
          value: el.getAttribute("value"),
          placeholder: el.getAttribute("placeholder"),
          "aria-label": el.getAttribute("aria-label")
        }
      };
      records.push(record);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = "";
        el.setAttribute("value", "");
        el.setAttribute("placeholder", "");
      } else if (el.isContentEditable) {
        el.textContent = "";
      }
      el.setAttribute("data-browser-flow-redaction", "dom-mask-v1");
    }
    const store = /** @type {any} */ (window);
    store.__bfCaptureShotMaskV1 = records;
    return { masked: records.length };
  }.toString() + ")()";
  await session.client.send("Runtime.evaluate", { expression, returnByValue: true }, sid).catch(() => {});
  return async () => {
    const restoreExpression = "(" + function() {
      const store = /** @type {any} */ (window);
      const records = Array.isArray(store.__bfCaptureShotMaskV1) ? store.__bfCaptureShotMaskV1 : [];
      for (const record of records) {
        const el = record && record.el;
        if (!(el instanceof HTMLElement)) continue;
        if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && typeof record.value === "string") {
          el.value = record.value;
        } else if (el.isContentEditable && typeof record.textContent === "string") {
          el.textContent = record.textContent;
        }
        for (const [name, value] of Object.entries(record.attrs || {})) {
          if (value === null) el.removeAttribute(name);
          else el.setAttribute(name, String(value));
        }
        el.removeAttribute("data-browser-flow-redaction");
      }
      delete store.__bfCaptureShotMaskV1;
      return { restored: records.length };
    }.toString() + ")()";
    await session.client.send("Runtime.evaluate", { expression: restoreExpression, returnByValue: true }, sid).catch(() => {});
  };
}

/**
 * Resolve a targetId for a given CDP sessionId.
 *
 * @param {import("../cdp/browser-session.mjs").BrowserSession} session
 * @param {string} sessionId
 * @returns {string | null}
 */
function findTargetIdBySessionId(session, sessionId) {
  for (const target of session.sessionManager.listPageTargets()) {
    if (session.sessionManager.getSessionId(target.targetId) === sessionId) {
      return target.targetId;
    }
  }
  return null;
}

/**
 * @param {Record<string, any>} event
 */
function isUserActionEvent(event) {
  return event?.type === "click" || event?.type === "input" || event?.type === "submit";
}

/**
 * Snapshot/enrichment lane. This deliberately stays best-effort and derives
 * metadata from recorder facts that are already available on the hot path; it
 * never blocks user input for a full DOM or screenshot capture.
 *
 * @param {Record<string, any>} event
 * @param {{ sessionId?: string, targetId?: string } | undefined} meta
 * @param {boolean} unmasked
 */
function appendBestEffortEnrichment(event, meta, unmasked) {
  if (isUserActionEvent(event)) {
    appendCaptureJournal("daemon", {
      type: "action-enrichment",
      lane: "snapshot-enrichment",
      stage: "before",
      captureWindowId: event.captureWindowId,
      actionSeq: event.actionSeq,
      actionId: event.actionId,
      documentId: event.documentId,
      frameId: meta?.sessionId || meta?.targetId || undefined,
      tabOrdinal: event.tabOrdinal,
      timestamp: Date.now(),
      timestampMonotonic: event.timestampMonotonic,
      url: event.url,
      affordances: Array.isArray(event.pageSkeleton) ? event.pageSkeleton : undefined,
      screenshotCrop: cropMetadataForEvent(event)
    }, unmasked);
    return;
  }
  if (event?.type === "action-diff") {
    appendCaptureJournal("daemon", {
      type: "action-enrichment",
      lane: "snapshot-enrichment",
      stage: "after",
      captureWindowId: event.captureWindowId,
      actionSeq: event.actionSeq,
      actionId: event.actionId,
      documentId: event.documentId,
      frameId: meta?.sessionId || meta?.targetId || undefined,
      tabOrdinal: event.tabOrdinal,
      timestamp: Date.now(),
      timestampMonotonic: event.timestampMonotonic,
      url: event.url,
      affordances: Array.isArray(event.afterSkeleton) ? event.afterSkeleton : undefined,
      mutationBatch: mutationBatchForActionDiff(event)
    }, unmasked);
  }
}

/**
 * @param {Record<string, any>} event
 */
function cropMetadataForEvent(event) {
  const locator = event.locator && typeof event.locator === "object" ? event.locator : {};
  const box = locator.box && typeof locator.box === "object" ? locator.box : null;
  if (!box) return undefined;
  return {
    source: "action-window",
    box
  };
}

/**
 * @param {Record<string, any>} event
 */
function mutationBatchForActionDiff(event) {
  const before = Array.isArray(event.beforeSkeleton) ? event.beforeSkeleton : [];
  const after = Array.isArray(event.afterSkeleton) ? event.afterSkeleton : [];
  return [{
    kind: "affordance-diff",
    target: "visible-affordances",
    added: Math.max(after.length - before.length, 0),
    removed: Math.max(before.length - after.length, 0)
  }];
}

/**
 * @param {"recorder" | "cdp" | "daemon"} source
 * @param {Record<string, any>} event
 * @param {boolean} unmasked
 */
function appendCaptureJournal(source, event, unmasked) {
  appendJournalEvent(runPaths.captureJournalPath, toJournalEvent({
    source,
    phase: "capture",
    event,
    unmasked
  }));
}

/**
 * @param {Array<Record<string, any>>} events
 */
function lastNavigateUrlFromEvents(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "navigate" && typeof event.url === "string" && event.url && event.url !== "about:blank") {
      return event.url;
    }
  }
  return "";
}

/**
 * Returns the count of requestIds that have been sent but not yet completed
 * (no responseReceived or loadingFinished event).
 * @param {import("../sanitize/event-sanitizer.mjs").RawEvent[]} networkEvents
 */
function countPendingRequests(networkEvents) {
  /** @type {Set<string>} */
  const sent = new Set();
  /** @type {Set<string>} */
  const completed = new Set();
  for (const ev of networkEvents) {
    const e = /** @type {any} */ (ev);
    if (e.type === "network.request" && typeof e.requestId === "string") {
      sent.add(e.requestId);
    } else if (
      (e.type === "network.response" || e.type === "network.loadingFinished") &&
      typeof e.requestId === "string"
    ) {
      completed.add(e.requestId);
    }
  }
  let pending = 0;
  for (const id of sent) {
    if (!completed.has(id)) pending += 1;
  }
  return pending;
}

/**
 * @param {import("../sanitize/event-sanitizer.mjs").RawEvent[]} rawEvents
 * @param {import("../sanitize/event-sanitizer.mjs").RawEvent[]} networkEvents
 */
async function settleCapture(rawEvents, networkEvents) {
  let lastSignature = "";
  let stableMs = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const signature = JSON.stringify({
      rawCount: rawEvents.length,
      networkCount: networkEvents.length,
      lastRawTs: rawEvents.at(-1)?.timestamp ?? 0,
      lastNetworkTs: networkEvents.at(-1)?.timestamp ?? 0
    });

    if (signature === lastSignature) {
      stableMs += 50;
      if (stableMs >= 150) {
        return;
      }
    } else {
      lastSignature = signature;
      stableMs = 0;
    }

    await delay(50);
  }

  // After the stability loop, extend settle if there are pending network requests.
  // Cap extension at 5 seconds to avoid infinite wait.
  const PENDING_POLL_INTERVAL_MS = 100;
  const PENDING_MAX_WAIT_MS = 5_000;
  let pendingWaitMs = 0;
  while (pendingWaitMs < PENDING_MAX_WAIT_MS) {
    if (countPendingRequests(networkEvents) === 0) break;
    await delay(PENDING_POLL_INTERVAL_MS);
    pendingWaitMs += PENDING_POLL_INTERVAL_MS;
  }
}

/**
 * @param {Error} error
 */
function handleDaemonError(error) {
  cleanup()
    .catch(() => {
      // Best effort only.
    })
    .finally(() => {
      try {
        const control = /** @type {Record<string, unknown>} */ (readJson(runPaths.controlPath));
        writeJson(runPaths.controlPath, {
          ...control,
          status: "error",
          error: error.message
        });
      } catch {
        // Best effort only.
      }
      console.error(error);
      process.exit(1);
    });
}

async function cleanup() {
  if (activeSession) {
    await activeSession.dispose().catch(() => {
      // Best effort.
    });
    await disposeProfileDir(activeProfileDir, activeSession.chromeProcess, activeProfilePersistent).catch(() => {
      // Best effort.
    });
    activeSession = null;
  }
  if (activeFixtureServer) {
    await activeFixtureServer.close().catch(() => {
      // Best effort.
    });
    activeFixtureServer = null;
  }
  if (activeProfileDir) {
    await disposeProfileDir(activeProfileDir, undefined, activeProfilePersistent).catch(() => {
      // Best effort.
    });
    activeProfileDir = null;
  }
}

/**
 * When `persistent` is true (the profile is a named persistent one set
 * via `--profile-name`), terminate Chrome but skip the rmSync — operator
 * login state must survive across captures.
 *
 * @param {string | null} profileDir
 * @param {import("node:child_process").ChildProcess | undefined} chromeProcess
 * @param {boolean} persistent
 */
async function disposeProfileDir(profileDir, chromeProcess = undefined, persistent = false) {
  if (!profileDir) {
    return;
  }
  if (chromeProcess && chromeProcess.exitCode === null) {
    chromeProcess.kill("SIGTERM");
    await Promise.race([
      once(chromeProcess, "exit"),
      delay(2_000)
    ]).catch(() => {
      // Best effort.
    });
  }
  if (persistent) {
    // persistent profiles keep their directory across runs.
    // Chrome should have removed its SingletonLock on graceful
    // shutdown; if not, the next prepare will surface a lock error.
    return;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) {
        throw error;
      }
      await delay(100);
    }
  }
}

/**
 * @param {string} fixture
 * @param {string | undefined} configuredStartUrl
 * @param {string | undefined} fixtureBaseUrl
 */
function resolveStartUrl(fixture, configuredStartUrl, fixtureBaseUrl) {
  if (configuredStartUrl) {
    return configuredStartUrl;
  }
  if (!fixtureBaseUrl) {
    return "about:blank";
  }
  if (fixture === "synthetic") {
    return `${fixtureBaseUrl}/synthetic`;
  }
  if (fixture === "urlstate") {
    return `${fixtureBaseUrl}/urlstate/map?id=abc&mode=rain`;
  }
  if (fixture === "docs") {
    return `${fixtureBaseUrl}/docs`;
  }
  if (fixture === "stateful") {
    return `${fixtureBaseUrl}/stateful`;
  }
  if (fixture === "submit") {
    return `${fixtureBaseUrl}/submit`;
  }
  if (fixture === "secret") {
    return `${fixtureBaseUrl}/secret`;
  }
  if (fixture === "noanchor") {
    return `${fixtureBaseUrl}/noanchor`;
  }
  if (fixture === "signals") {
    return `${fixtureBaseUrl}/signals`;
  }
  if (fixture === "samename") {
    return `${fixtureBaseUrl}/samename`;
  }
  return "about:blank";
}
