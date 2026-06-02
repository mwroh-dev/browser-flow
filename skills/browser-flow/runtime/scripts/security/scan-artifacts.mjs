import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { listFilesRecursive, writeJson } from "../lib/fs.mjs";
import { SCHEMA_VERSIONS } from "../lib/schema-versions.mjs";
import { parseSecurityArtifact } from "../lib/schemas.mjs";
import { HIGH_ENTROPY_PATTERN, SECRET_FIELD_PATTERN, SENSITIVE_HEADER_NAMES } from "./patterns.mjs";
import { findSemanticSecretAssignment } from "./redact.mjs";

/**
 * `options.unmasked` makes findings warn-not-block.
 * Constitutional invariant #1 is preserved at the persistence
 * boundary (workflow.security.localOnly=false → registry upsert refuses).
 * Capture-time security scan becomes advisory under --unmasked rather
 * than load-bearing.
 *
 * @param {string} runRoot
 * @param {string} outputPath
 * @param {{ unmasked?: boolean }} [options]
 */
export function scanArtifacts(runRoot, outputPath, options = {}) {
  const unmasked = options.unmasked === true;
  const headerMatcher = new RegExp(
    `(^|[\\s{,])"?(${SENSITIVE_HEADER_NAMES.join("|")})"?\\s*[:=]`,
    "im"
  );
  /** @type {{ file: string, reason: string, match: string }[]} */
  const findings = [];
  for (const file of listFilesRecursive(runRoot)) {
    if (isSanitizedScreenshotArtifact(file)) {
      continue;
    }
    const contents = readFileSync(file, "utf8");
    const entropyContents = stripJsonObjectKeys(contents);
    const matchers = [
      { pattern: headerMatcher, reason: "secret header name" },
      { pattern: HIGH_ENTROPY_PATTERN, reason: "high entropy token candidate" }
    ];
    for (const matcher of matchers) {
      const match = (matcher.reason === "high entropy token candidate" ? entropyContents : contents).match(matcher.pattern);
      if (match) {
        findings.push({
          file: basename(file),
          reason: matcher.reason,
          match: redactFindingMatch(matcher.reason, match[0])
        });
      }
    }
    const semanticMatch = findSemanticSecretAssignment(contents);
    if (semanticMatch) {
      findings.push({
        file: basename(file),
        reason: "secret assignment text",
        match: redactFindingMatch("secret assignment text", semanticMatch)
      });
    }
  }

  const ok = findings.length === 0 || unmasked;
  const warningOnly = findings.length > 0 && unmasked;
  const result = parseSecurityArtifact(
    {
      schemaVersion: SCHEMA_VERSIONS.security,
      ok,
      findings,
      warningOnly
    },
    outputPath
  );
  writeJson(outputPath, result);
  return result;
}

/**
 * JSON artifact property names are schema labels, not captured values. Some
 * descriptive camelCase keys exceed the entropy regex length threshold.
 * @param {string} contents
 */
function stripJsonObjectKeys(contents) {
  return contents.replace(
    /"(visibleActionableAncestor|viewportIntersectionRatio)"\s*:/g,
    "\"<json-key>\":"
  );
}

/**
 * Sanitized screenshot artifacts are written only under reports/screenshots/.
 * They are binary PNG outputs that already passed the DOM-mask capture path, so
 * the text-oriented artifact scanner should skip them rather than misreading
 * binary bytes as high-entropy text.
 *
 * @param {string} file
 * @returns {boolean}
 */
function isSanitizedScreenshotArtifact(file) {
  return /\/reports\/screenshots\/.+\.png$/i.test(file);
}

/**
 * Truthful "green" predicate. A scan is clean only when it passed AND was
 * not merely downgraded to warn-not-block under --unmasked. Use this for any
 * user-facing "green" claim and for the registry verified-gate — never read
 * raw `ok` as "green" (under --unmasked `ok` is true despite findings).
 * @param {{ ok?: boolean, warningOnly?: boolean } | undefined | null} security
 * @returns {boolean}
 */
export function isSecurityClean(security) {
  return !!security && security.ok === true && security.warningOnly !== true;
}

/**
 * @param {string} name
 */
export function fieldNameIsForbidden(name) {
  return SECRET_FIELD_PATTERN.test(name);
}

/**
 * @param {string} reason
 * @param {string} rawMatch
 */
function redactFindingMatch(reason, rawMatch) {
  if (reason === "secret header name") {
    const header = rawMatch.match(/(cookie|set-cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token|x-api-key|x-auth-token|api-key)/i)?.[0];
    return header ? `<redacted:${header.toLowerCase()}>` : "<redacted:header>";
  }
  if (reason === "high entropy token candidate") {
    return "<redacted:high-entropy>";
  }
  return "<redacted:secret-text>";
}
