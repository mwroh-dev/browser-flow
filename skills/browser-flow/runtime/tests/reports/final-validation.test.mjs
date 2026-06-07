import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

test("architecture doc exists and package surface templates are at the declared location", () => {
  const archPath = resolve(getRepoRoot(), "docs", "architecture.md");
  assert.equal(existsSync(archPath), true);
  const text = readFileSync(archPath, "utf8");
  assert.match(text, /browser-flow/i);

  const skillPath = resolve(getRepoRoot(), "surfaces", "browser-flow", "package", "SKILL.md.tmpl");
  assert.equal(existsSync(skillPath), true);
});
