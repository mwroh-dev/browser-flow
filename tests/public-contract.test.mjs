import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const oldProjectionPrefix = "rel" + "ease";
const oldPackagePrefix = "bund" + "le";
const oldPublishDir = ["scripts", "pub" + "lish"].join("/");
const sourceWord = "Sour" + "ce";

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

test("public docs describe the product, not source synchronization metadata", () => {
  const docs = ["README.md", "INSTALL.md", "HISTORY.md"];
  const forbidden = [
    new RegExp(`Latest ${oldProjectionPrefix}`, "i"),
    new RegExp(`${sourceWord} SHA`, "i"),
    new RegExp(`${sourceWord} branch`, "i"),
    new RegExp(`${oldProjectionPrefix} SHA`, "i"),
    new RegExp(`${oldPackagePrefix} file count`, "i"),
    new RegExp(`${oldProjectionPrefix} sync`, "i"),
    new RegExp(`${oldProjectionPrefix} state`, "i"),
    new RegExp(`${oldProjectionPrefix} folder`, "i"),
    new RegExp(`boot${"strap"}-amend`, "i"),
    new RegExp(`pub${"lic"}-sync`, "i"),
    new RegExp(`pub${"lic"}-state`, "i"),
    new RegExp(`${oldProjectionPrefix}d checkout`, "i"),
    new RegExp(`${oldProjectionPrefix}d package`, "i")
  ];

  for (const rel of docs) {
    const text = readFileSync(resolve(repoRoot, rel), "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `${rel} should not contain ${pattern}`);
    }
  }
});
