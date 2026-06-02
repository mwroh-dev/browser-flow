import { writeJson } from "../lib/fs.mjs";
import { scanArtifacts } from "../security/scan-artifacts.mjs";
import { buildSelectorInventory, sanitizeEvent } from "./event-sanitizer.mjs";

/**
 * @param {{
 *   runPaths: ReturnType<import("../lib/config.mjs").getRunPaths>,
 *   manifest: Record<string, unknown>,
 *   rawEvents: import("./event-sanitizer.mjs").RawEvent[],
 *   pageEvidence: import("./event-sanitizer.mjs").RawEvent[],
 *   networkEvents: import("./event-sanitizer.mjs").RawEvent[]
 * }} input
 */
export function persistSanitizedArtifacts(input) {
  // thread the --unmasked capture mode through the sanitize chain.
  // When unmasked, sanitizeUrl preserves external URLs (still redacting
  // credentials + secret-named query params) so compile.mjs receives real
  // URLs as input for derivePageKey + transition-gate derivation.
  // Constitutional invariant #1 remains enforced at the persistence
  // boundary (registry upsert block on localOnly=false).
  const unmasked = input.manifest && input.manifest.unmasked === true;
  const sanitizeOpts = { unmasked };
  // Partition predicate: every CDP network subtype (network.request /
  // network.response / network.loadingFinished, and any future network.*)
  // is routed to networkSummary, not sanitizedEvents. `startsWith` is
  // intentional here — a new network.* subtype should follow its siblings.
  const sanitizedEvents = input.rawEvents
    .filter((event) => !event.type.startsWith("network") && event.type !== "page-evidence")
    .map((event) => sanitizeEvent(event, sanitizeOpts));
  const networkSummary = input.networkEvents.map((event) => sanitizeEvent(event, sanitizeOpts));
  const evidence = input.pageEvidence.map((event) => sanitizeEvent(event, sanitizeOpts));
  const selectorItems = [...sanitizedEvents, ...evidence].flatMap((event) => {
    if ("selector" in event && typeof event.selector === "string") {
      return [{ selector: event.selector }];
    }
    return [];
  });
  const selectors = buildSelectorInventory(selectorItems);

  writeJson(input.runPaths.manifestPath, {
    ...input.manifest,
    status: "captured",
    capturedAt: new Date().toISOString()
  });
  writeJson(input.runPaths.sanitizedEventsPath, sanitizedEvents);
  writeJson(input.runPaths.networkSummaryPath, networkSummary);
  writeJson(input.runPaths.selectorsPath, selectors);
  writeJson(input.runPaths.pageEvidencePath, evidence);
  // --unmasked makes scan findings warn-not-block.
  // Constitutional invariant #1 still enforced at persistence
  // boundary (workflow.security.localOnly + registry upsert).
  const security = scanArtifacts(input.runPaths.runRoot, input.runPaths.securityPath, { unmasked });

  return {
    sanitizedEvents,
    networkSummary,
    evidence,
    selectors,
    security
  };
}
