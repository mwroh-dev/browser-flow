#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShippingFiles } from "../lib/shipping-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = resolve(repoRoot, "scripts/publish/bundle-allowlist.json");

const TEXT_EXT = /\.(mjs|js|cjs|ts|json|md|ya?ml|txt|html|css)$/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_WHITELIST_EXACT = new Set(["x@y.com"]);
const EMAIL_WHITELIST_DOMAIN = /@(example\.(com|org|net)|[^@]+\.(test|example|invalid|localhost))$/i;
const HOME_PATH_RE = /\/(?:Users|home)\/([A-Za-z0-9][\w.-]*)\//g;
const HOME_NAME_WHITELIST = new Set(["x", "user", "username", "you", "me", "name", "runner", "ci"]);

/**
 * @param {string} addr
 * @returns {boolean}
 */
function isWhitelistedEmail(addr) {
  return EMAIL_WHITELIST_EXACT.has(addr) || EMAIL_WHITELIST_DOMAIN.test(addr);
}

/**
 * @param {string} content
 * @param {string[]} [identities] real-identity terms (loaded at runtime from a non-shipped local file)
 * @returns {{type: string, value: string}[]}
 */
export function findPii(content, identities = []) {
  /** @type {{type: string, value: string}[]} */
  const hits = [];
  for (const m of content.matchAll(EMAIL_RE)) {
    if (!isWhitelistedEmail(m[0])) hits.push({ type: "email", value: m[0] });
  }
  for (const m of content.matchAll(HOME_PATH_RE)) {
    if (!HOME_NAME_WHITELIST.has(m[1])) hits.push({ type: "home-path", value: m[0] });
  }
  for (const id of identities) {
    if (id && content.includes(id)) hits.push({ type: "identity", value: id });
  }
  return hits;
}

/**
 * Load identity terms from a gitignored local file.
 * Returns [] if the file is absent (CI / fresh clone with no .pii-identities).
 * @returns {string[]}
 */
function loadIdentities() {
  try {
    return readFileSync(resolve(repoRoot, ".pii-identities"), "utf8")
      .split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  } catch { return []; }
}

function main() {
  const selfPaths = new Set([
    "scripts/security/pii-scan.mjs",
    "tests/security/pii-scan.test.mjs"
  ]);
  const identities = loadIdentities();
  const files = resolveShippingFiles(repoRoot, manifestPath)
    .filter((f) => TEXT_EXT.test(f) && !selfPaths.has(f));
  /** @type {{rel: string, type: string, value: string}[]} */
  const findings = [];
  for (const rel of files) {
    const content = readFileSync(resolve(repoRoot, rel), "utf8");
    for (const hit of findPii(content, identities)) findings.push({ rel, ...hit });
  }
  if (findings.length > 0) {
    for (const f of findings) process.stderr.write(`PII ${f.rel} [${f.type}] ${f.value}\n`);
    process.stderr.write(`\npii-scan FAILED: ${findings.length} finding(s) in shipping surface.\n`);
    process.exit(1);
  }
  process.stdout.write(`pii-scan OK (${files.length} files)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
