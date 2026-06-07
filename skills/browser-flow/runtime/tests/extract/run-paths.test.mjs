import test from "node:test";
import assert from "node:assert/strict";
import { getRunPaths } from "../../scripts/lib/config.mjs";

test("getRunPaths exposes scraping artifact paths", () => {
  const p = getRunPaths("demo-run");
  assert.match(p.scrapeRequestPath, /demo-run\/scrape-request\.json$/);
  assert.match(p.scrapeResultPath, /demo-run\/scrape-result\.json$/);
  assert.match(p.extractorConfigPath, /demo-run\/extractor-config\.json$/);
  assert.match(p.extractResultPath, /demo-run\/extract-result\.json$/);
  assert.match(p.dataResultPath, /demo-run\/reports\/data-result\.json$/);
});
