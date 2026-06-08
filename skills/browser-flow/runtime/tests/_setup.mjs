import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const artifactsDir = resolve(import.meta.dirname, "..", "artifacts");
rmSync(artifactsDir, { recursive: true, force: true });
mkdirSync(artifactsDir, { recursive: true });

process.env.BROWSER_FLOW_REGISTRY_PATH = resolve(artifactsDir, "test-workflows.json");
process.env.BROWSER_FLOW_PAGES_PATH = resolve(artifactsDir, "test-pages.json");
process.env.BROWSER_FLOW_SCRAPING_PATH = resolve(artifactsDir, "test-scraping.json");
process.env.BROWSER_FLOW_SCORING_PATTERNS_PATH = resolve(artifactsDir, "test-scoring-patterns.json");
