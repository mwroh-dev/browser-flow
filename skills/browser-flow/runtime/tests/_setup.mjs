import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "browser-flow-test-"));

process.env.BROWSER_FLOW_REGISTRY_PATH ??= resolve(root, "knowledge", "registry", "workflows.json");
process.env.BROWSER_FLOW_PAGES_PATH ??= resolve(root, "knowledge", "pages");
process.env.BROWSER_FLOW_SCRAPING_PATH ??= resolve(root, "knowledge", "scraping");
process.env.BROWSER_FLOW_SCORING_PATTERNS_PATH ??= resolve(root, "knowledge", "scoring-patterns.json");
process.env.BROWSER_FLOW_VERIFY_SPEC_PATH ??= resolve(root, "knowledge", "verify-spec", "override.json");

for (const value of [
  process.env.BROWSER_FLOW_REGISTRY_PATH,
  process.env.BROWSER_FLOW_PAGES_PATH,
  process.env.BROWSER_FLOW_SCRAPING_PATH,
  process.env.BROWSER_FLOW_SCORING_PATTERNS_PATH,
  process.env.BROWSER_FLOW_VERIFY_SPEC_PATH
]) {
  if (!value) continue;
  mkdirSync(value.endsWith(".json") ? dirname(value) : value, { recursive: true });
}
