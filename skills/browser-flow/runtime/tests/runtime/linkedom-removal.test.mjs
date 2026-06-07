import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { withAssembledPackage } from "../helpers/assembled-package.mjs";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

/** @param {string} relativePath */
function readFile(relativePath) {
  return readFileSync(resolve(getRepoRoot(), relativePath), "utf8");
}

/** @param {string} relativePath */
function readJson(relativePath) {
  return JSON.parse(readFile(relativePath));
}

test("root and assembled runtime package metadata replace linkedom with parse5 + cheerio", async () => {
  await withAssembledPackage(async ({ packageRoot }) => {
    for (const relativePath of ["package.json", resolve(packageRoot, "runtime/package.json")]) {
      const pkg = relativePath === "package.json"
        ? readJson(relativePath)
        : JSON.parse(readFileSync(relativePath, "utf8"));
      const deps = pkg.dependencies || {};
      assert.equal("linkedom" in deps, false, `${relativePath} should not depend on linkedom`);
      assert.equal("parse5" in deps, true, `${relativePath} should depend on parse5`);
      assert.equal("cheerio" in deps, true, `${relativePath} should depend on cheerio`);
    }
  });
});

test("runtime bootstrap preflight requires parse5 + cheerio instead of linkedom", async () => {
  await withAssembledPackage(async ({ packageRoot }) => {
    const files = [
      readFile("scripts/cli.mjs"),
      readFileSync(resolve(packageRoot, "runtime/scripts/cli.mjs"), "utf8")
    ];
    for (const text of files) {
      assert.match(text, /requiredPackages = \["chrome-remote-interface", "parse5", "cheerio", "zod"\]/);
      assert.doesNotMatch(text, /linkedom/);
    }
  });
});

test("live docs and generated subagent skills stop describing the extractor runtime as linkedom-based", async () => {
  await withAssembledPackage(async ({ packageRoot }) => {
    const files = [
      ["agents/extractor/playbooks/scraping-agent.md", readFile("agents/extractor/playbooks/scraping-agent.md")],
      ["skills/scraping-agent/SKILL.md", readFileSync(resolve(packageRoot, "skills/scraping-agent/SKILL.md"), "utf8")],
      ["docs/roadmap.md", readFile("docs/roadmap.md")],
      ["tests/sanitize/dom-sanitize.test.mjs", readFile("tests/sanitize/dom-sanitize.test.mjs")]
    ];
    for (const [relativePath, text] of files) {
      assert.doesNotMatch(text, /linkedom/i, `${relativePath} should not mention linkedom`);
    }
  });
});

test("tsconfig no longer relies on skipLibCheck for linkedom DOM typings", async () => {
  await withAssembledPackage(async ({ packageRoot }) => {
    const configs = [
      ["tsconfig.json", readJson("tsconfig.json")],
      ["runtime/tsconfig.json", JSON.parse(readFileSync(resolve(packageRoot, "runtime/tsconfig.json"), "utf8"))]
    ];
    for (const [relativePath, tsconfig] of configs) {
      assert.notEqual(tsconfig.compilerOptions.skipLibCheck, true, `${relativePath} should not enable skipLibCheck`);
    }
  });
});
