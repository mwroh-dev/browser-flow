import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve(import.meta.dirname, "..", "artifacts"), { recursive: true, force: true });
process.env.BROWSER_FLOW_REGISTRY_PATH = resolve(import.meta.dirname, "..", "artifacts", "test-workflows.json");
process.env.BROWSER_FLOW_PAGES_PATH = resolve(import.meta.dirname, "..", "artifacts", "test-pages.json");
process.env.BROWSER_FLOW_SCRAPING_PATH = resolve(import.meta.dirname, "..", "artifacts", "test-scraping.json");
process.env.BROWSER_FLOW_SCORING_PATTERNS_PATH = resolve(import.meta.dirname, "..", "artifacts", "test-scoring-patterns.json");
