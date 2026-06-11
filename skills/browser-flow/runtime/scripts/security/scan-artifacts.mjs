import { readFileSync } from "node:fs";
import { basename, extname, relative } from "node:path";
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
  /** @type {Array<{ file: string, reason: string, match: string, blocking?: boolean, severity?: string, category?: string, artifactPath?: string, schemaPath?: string, fieldName?: string }>} */
  const findings = [];
  for (const file of listFilesRecursive(runRoot)) {
    if (isSanitizedScreenshotArtifact(file)) {
      continue;
    }
    const contents = readFileSync(file, "utf8");
    const matchers = [
      { pattern: headerMatcher, reason: "secret header name" }
    ];
    for (const matcher of matchers) {
      const match = contents.match(matcher.pattern);
      if (match) {
        findings.push({
          file: basename(file),
          reason: matcher.reason,
          match: redactFindingMatch(matcher.reason, match[0])
        });
      }
    }
    findings.push(...scanHighEntropyValues(runRoot, file, contents));
    const semanticMatch = findArtifactSemanticSecretAssignment(file, contents);
    if (semanticMatch) {
      findings.push({
        file: basename(file),
        reason: "secret assignment text",
        match: redactFindingMatch("secret assignment text", semanticMatch)
      });
    }
  }

  const blockingFindings = findings.filter((finding) => finding.blocking !== false);
  const ok = blockingFindings.length === 0 || unmasked;
  const warningOnly = blockingFindings.length > 0 && unmasked;
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
 * @param {string} runRoot
 * @param {string} file
 * @param {string} contents
 * @returns {Array<{ file: string, reason: string, match: string, blocking?: boolean, severity?: string, category?: string, artifactPath?: string, schemaPath?: string, fieldName?: string }>}
 */
function scanHighEntropyValues(runRoot, file, contents) {
  const artifactPath = normalizeArtifactPath(runRoot, file);
  const structured = scanStructuredHighEntropyValues(file, artifactPath, contents);
  if (structured) return structured;

  const keyStrippedContents = isJsonArtifact(file) ? stripJsonObjectKeys(contents) : contents;
  const entropyContents = stripSourceSymbolLiterals(
    file,
    stripSourceIdentifiers(file, keyStrippedContents)
  );
  const match = findHighEntropyTextMatch(file, entropyContents);
  if (!match) return [];
  return [
    {
      file: basename(file),
      reason: "high entropy token candidate",
      match: redactFindingMatch("high entropy token candidate", match)
    }
  ];
}

/**
 * @param {string} file
 * @param {string} artifactPath
 * @param {string} contents
 * @returns {Array<{ file: string, reason: string, match: string, blocking?: boolean, severity?: string, category?: string, artifactPath?: string, schemaPath?: string, fieldName?: string }> | null}
 */
function scanStructuredHighEntropyValues(file, artifactPath, contents) {
  const parsed = parseStructuredArtifact(contents, artifactPath);
  if (parsed === null) return null;

  /** @type {Array<{ file: string, reason: string, match: string, blocking?: boolean, severity?: string, category?: string, artifactPath?: string, schemaPath?: string, fieldName?: string }>} */
  const findings = [];
  walkStructuredValues(parsed, [], (value, path) => {
    for (const match of highEntropyMatches(value)) {
      const schemaPath = pathToSchemaPath(path);
      const fieldName = typeof path.at(-1) === "string" ? String(path.at(-1)) : "";
      const cdpOpaqueRuntimeId = isKnownCdpOpaqueRuntimeId({
        artifactPath,
        schemaPath,
        fieldName,
        value: match
      });
      findings.push({
        file: basename(file),
        reason: "high entropy token candidate",
        match: redactFindingMatch("high entropy token candidate", match),
        artifactPath,
        schemaPath,
        fieldName,
        ...(cdpOpaqueRuntimeId
          ? {
              category: "cdp-opaque-runtime-id",
              severity: "info",
              blocking: false
            }
          : {})
      });
    }
  });
  return findings;
}

/**
 * @param {string} contents
 * @param {string} artifactPath
 * @returns {unknown | null}
 */
function parseStructuredArtifact(contents, artifactPath) {
  if (artifactPath.endsWith(".jsonl")) {
    const lines = contents.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length === 0) return [];
    try {
      return lines.map((line) => JSON.parse(line));
    } catch {
      return null;
    }
  }
  if (!artifactPath.endsWith(".json")) return null;
  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {Array<string | number>} path
 * @param {(value: string, path: Array<string | number>) => void} visit
 */
function walkStructuredValues(value, path, visit) {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStructuredValues(entry, [...path, index], visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    walkStructuredValues(entry, [...path, key], visit);
  }
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function highEntropyMatches(value) {
  const matcher = new RegExp(HIGH_ENTROPY_PATTERN.source, "g");
  return [...value.matchAll(matcher)].map((match) => match[0]);
}

/**
 * @param {Array<string | number>} path
 * @returns {string}
 */
function pathToSchemaPath(path) {
  return path.reduce((acc, part) => {
    if (typeof part === "number") return `${acc}[${part}]`;
    return acc ? `${acc}.${part}` : part;
  }, "");
}

/**
 * @param {string} runRoot
 * @param {string} file
 */
function normalizeArtifactPath(runRoot, file) {
  return relative(runRoot, file).split(/[/\\]+/).join("/");
}

/**
 * @param {{ artifactPath: string, schemaPath: string, fieldName: string, value: string }} input
 */
function isKnownCdpOpaqueRuntimeId(input) {
  if (!/^[A-Fa-f0-9]{24,64}$/.test(input.value)) return false;
  if (input.fieldName === "frameId") {
    if (
      input.artifactPath === "analysis/step-ledger.json" &&
      /^steps\[\d+\]\.(before|after)\.enrichment\[\d+\]\.frameId$/.test(input.schemaPath)
    ) {
      return true;
    }
    if (
      input.artifactPath === "events/journal.jsonl" &&
      /^\[\d+\]\.frameId$/.test(input.schemaPath)
    ) {
      return true;
    }
  }
  // CDP session ids recorded for multi-tab request attribution. Same opaque
  // runtime-id class as frameId: random per launch, no authority, useless
  // off-machine.
  if (
    input.fieldName === "sessionId" &&
    (input.artifactPath === "network-summary.json" ||
      input.artifactPath === "events/journal.jsonl" ||
      input.artifactPath === "raw-events.jsonl") &&
    /^\[\d+\]\.sessionId$/.test(input.schemaPath)
  ) {
    return true;
  }
  return input.fieldName === "targetId" &&
    input.artifactPath === "reports/verification.json" &&
    /^replayViewport\.appliedTargets\[\d+\]\.targetId$/.test(input.schemaPath);
}

/**
 * JSON artifact property names are schema labels, not captured values. Some
 * descriptive camelCase keys exceed the entropy regex length threshold.
 * @param {string} contents
 */
function stripJsonObjectKeys(contents) {
  return contents.replace(
    /"([^"\\]|\\.)+"\s*:/g,
    "\"<json-key>\":"
  );
}

/**
 * @param {string} file
 */
function isJsonArtifact(file) {
  return file.endsWith(".json") || file.endsWith(".jsonl");
}

/**
 * Generated JavaScript contains long internal identifiers and local variable
 * names such as `token` that are source code, not captured page data. Preserve
 * string/template literals so an actual embedded secret value is still scanned.
 *
 * @param {string} file
 * @param {string} contents
 */
function stripSourceIdentifiers(file, contents) {
  if (!isJsSourceArtifact(file)) {
    return contents;
  }
  let output = "";
  let index = 0;
  /** @type {null | "'" | '"' | "`"} */
  let quote = null;
  let escaped = false;
  while (index < contents.length) {
    const ch = contents[index];
    const next = contents[index + 1];
    if (quote) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      const commentEnd = contents.indexOf("\n", index);
      const end = commentEnd === -1 ? contents.length : commentEnd;
      output += contents.slice(index, end);
      index = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const commentEnd = contents.indexOf("*/", index + 2);
      const end = commentEnd === -1 ? contents.length : commentEnd + 2;
      output += contents.slice(index, end);
      index = end;
      continue;
    }
    if (ch === "/" && startsRegexLiteral(contents, index)) {
      const end = readRegexLiteralEnd(contents, index);
      if (end !== -1) {
        output += contents.slice(index, end);
        index = end;
        continue;
      }
    }
    if (ch === "'" || ch === "\"" || ch === "`") {
      quote = ch;
      output += ch;
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = index;
      index += 1;
      while (index < contents.length && /[A-Za-z0-9_$]/.test(contents[index])) {
        index += 1;
      }
      output += " ".repeat(index - start);
      continue;
    }
    output += ch;
    index += 1;
  }
  return output;
}

/**
 * @param {string} contents
 * @param {number} slashIndex
 */
function startsRegexLiteral(contents, slashIndex) {
  let index = slashIndex - 1;
  while (index >= 0 && /\s/.test(contents[index])) {
    index -= 1;
  }
  if (index < 0) return true;
  const prev = contents[index];
  if ("([{=,:;!?&|+-*~^<>".includes(prev)) return true;

  const before = contents.slice(0, index + 1);
  const keyword = before.match(/\b(return|case|throw|yield|await|typeof|delete|void|in|of|instanceof|new)$/);
  return Boolean(keyword);
}

/**
 * @param {string} contents
 * @param {number} slashIndex
 */
function readRegexLiteralEnd(contents, slashIndex) {
  let index = slashIndex + 1;
  let escaped = false;
  let inCharClass = false;
  while (index < contents.length) {
    const ch = contents[index];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === "[") {
      inCharClass = true;
    } else if (ch === "]") {
      inCharClass = false;
    } else if (ch === "/" && !inCharClass) {
      index += 1;
      while (index < contents.length && /[A-Za-z]/.test(contents[index])) {
        index += 1;
      }
      return index;
    } else if (ch === "\n" || ch === "\r") {
      return -1;
    }
    index += 1;
  }
  return -1;
}

/**
 * CDP and DOM protocol method names are persisted in generated source as dotted
 * symbols, for example "Emulation.setDeviceMetricsOverride". They are not
 * captured page data, but their camelCase segments can exceed the entropy
 * threshold. This is narrower than stripping all string literals.
 *
 * @param {string} file
 * @param {string} contents
 */
function stripSourceSymbolLiterals(file, contents) {
  if (!isJsSourceArtifact(file)) {
    return contents;
  }
  return contents.replace(
    /(["'`])(?:[A-Za-z_$][A-Za-z0-9_$]{0,29}\.)+[A-Za-z_$][A-Za-z0-9_$]{0,29}\1/g,
    (match, quote, offset) => isEscapedAt(contents, offset) ? match : `${quote}<source-symbol>${quote}`
  );
}

/**
 * @param {string} file
 * @param {string} contents
 */
function findHighEntropyTextMatch(file, contents) {
  const matcher = new RegExp(HIGH_ENTROPY_PATTERN.source, "g");
  for (const match of contents.matchAll(matcher)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (isGeneratedSourceSymbolToken(file, contents, index, token)) {
      continue;
    }
    return token;
  }
  return null;
}

/**
 * @param {string} file
 * @param {string} contents
 * @param {number} index
 * @param {string} token
 */
function isGeneratedSourceSymbolToken(file, contents, index, token) {
  if (!isJsSourceArtifact(file)) {
    return false;
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) {
    return false;
  }
  if (!/[a-z]/.test(token) || !/[A-Z]/.test(token)) {
    return false;
  }
  const stringLiteral = enclosingLineStringLiteral(contents, index, token.length);
  if (stringLiteral) {
    return /^(?:[A-Za-z_$][A-Za-z0-9_$]{0,29}\.)+[A-Za-z_$][A-Za-z0-9_$]{0,29}$/.test(stringLiteral);
  }
  return false;
}

/**
 * @param {string} file
 * @param {string} contents
 */
function findArtifactSemanticSecretAssignment(file, contents) {
  if (!isJsSourceArtifact(file)) {
    return findSemanticSecretAssignment(contents);
  }
  const literalAssignment = /["']?(password|passcode|secret|token|session|csrf|auth(?:orization)?|api[-_ ]?key)["']?\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/ig;
  for (const match of contents.matchAll(literalAssignment)) {
    const semanticMatch = findSemanticSecretAssignment(match[0]);
    if (semanticMatch) return semanticMatch;
  }
  return null;
}

/**
 * @param {string} file
 */
function isJsSourceArtifact(file) {
  return [".js", ".mjs", ".cjs"].includes(extname(file));
}

/**
 * @param {string} contents
 * @param {number} index
 * @param {number} length
 */
function enclosingLineStringLiteral(contents, index, length) {
  const lineStart = contents.lastIndexOf("\n", index) + 1;
  const lineEndIndex = contents.indexOf("\n", index);
  const lineEnd = lineEndIndex === -1 ? contents.length : lineEndIndex;
  const line = contents.slice(lineStart, lineEnd);
  const localIndex = index - lineStart;
  for (const quote of ["\"", "'", "`"]) {
    const before = line.slice(0, localIndex);
    const after = line.slice(localIndex + length);
    const quoteStart = getOpenQuoteStart(before, quote);
    const quoteEnd = findUnescapedQuote(after, quote);
    if (quoteStart !== -1 && quoteEnd !== -1) {
      return line.slice(quoteStart + 1, localIndex + length + quoteEnd);
    }
  }
  return null;
}

/**
 * @param {string} contents
 * @param {string} quote
 */
function getOpenQuoteStart(contents, quote) {
  let lastIndex = -1;
  let count = 0;
  let escaped = false;
  for (let index = 0; index < contents.length; index += 1) {
    const ch = contents[index];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === quote) {
      count += 1;
      lastIndex = index;
    }
  }
  return count % 2 === 1 ? lastIndex : -1;
}

/**
 * @param {string} contents
 * @param {string} quote
 */
function findUnescapedQuote(contents, quote) {
  let escaped = false;
  for (let index = 0; index < contents.length; index += 1) {
    const ch = contents[index];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === quote) {
      return index;
    }
  }
  return -1;
}

/**
 * @param {string} contents
 * @param {number} index
 */
function isEscapedAt(contents, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && contents[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
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
