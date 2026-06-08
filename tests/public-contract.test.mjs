import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const oldProjectionPrefix = "rel" + "ease";
const oldPackagePrefix = "bund" + "le";
const oldPublishDir = ["scripts", "pub" + "lish"].join("/");

test("repository does not keep projection state", () => {
  const forbiddenPaths = [
    `.${oldProjectionPrefix}-source.json`,
    `.${oldProjectionPrefix}-state.json`,
    `.${oldPackagePrefix}-stamp.json`,
    oldPublishDir,
    "surfaces"
  ];

  for (const rel of forbiddenPaths) {
    assert.equal(existsSync(resolve(repoRoot, rel)), false, `${rel} should not exist`);
  }
});
