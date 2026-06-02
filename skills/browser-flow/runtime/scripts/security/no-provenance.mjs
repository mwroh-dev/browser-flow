#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShippingFiles } from "../lib/shipping-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = resolve(repoRoot, "scripts/publish/bundle-allowlist.json");

// Development-archaeology markers: capital-P "Phase <n>" and lesson markers "(#<n>".
// The word "phase" and semver are NOT matched. Exempts the product's pipeline-stage
// header form "Phase <n> — <Name>" (em-dash), e.g. "### Phase 1 — Capture" — those are
// product vocabulary (the Capture→Analyze→Generate→Verify→Extract stages), not archaeology.
const PROVENANCE_RE = /\bPhase \d+(?! — )|\(#\d+\b/g;
const TEXT_EXT = /\.(mjs|js|cjs|ts|md|ya?ml)$/;

// Narrative/citation docs (dev-arc references are their content) + the gate's own files.
const EXEMPT = new Set([
  "docs/ENGINEERING-LOG.md",
  "docs/research-applied.md",
  "docs/patterns-applied.md",
  "scripts/security/no-provenance.mjs",
  "tests/security/no-provenance.test.mjs"
]);
/** @type {string[]} */
const EXEMPT_PREFIX = [];

/** @param {string} content @returns {string[]} */
export function findProvenance(content) {
  return [...content.matchAll(PROVENANCE_RE)].map((m) => m[0]);
}

function main() {
  const files = resolveShippingFiles(repoRoot, manifestPath).filter(
    (f) => TEXT_EXT.test(f) && !EXEMPT.has(f) && !EXEMPT_PREFIX.some((p) => f.startsWith(p))
  );
  /** @type {{rel: string, marker: string}[]} */
  const findings = [];
  for (const rel of files) {
    for (const marker of findProvenance(readFileSync(resolve(repoRoot, rel), "utf8"))) {
      findings.push({ rel, marker });
    }
  }
  if (findings.length > 0) {
    /** @type {Map<string, number>} */
    const byFile = new Map();
    for (const f of findings) byFile.set(f.rel, (byFile.get(f.rel) ?? 0) + 1);
    for (const [rel, n] of [...byFile].sort()) process.stderr.write(`PROV ${rel} (${n})\n`);
    process.stderr.write(
      `\nno-provenance FAILED: ${findings.length} marker(s) across ${byFile.size} file(s).\n`
    );
    process.exit(1);
  }
  process.stdout.write(`no-provenance OK (${files.length} files)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
