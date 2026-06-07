import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  assertReleaseClosure,
  assertRelativeImportClosure,
  relativeImportSpecifiers
} from "../../scripts/publish/release-closure.mjs";

test("relativeImportSpecifiers extracts static and literal dynamic imports", () => {
  const source = [
    "import { a } from './a.mjs';",
    "export { b } from '../b.mjs';",
    "await import('./lazy.mjs');",
    "const ignored = import(name);"
  ].join("\n");

  assert.deepEqual(relativeImportSpecifiers(source), ["./a.mjs", "../b.mjs", "./lazy.mjs"]);
});

test("assertRelativeImportClosure fails when a shipped relative import is missing", () => {
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-release-closure-import-"));
  try {
    writeFileSync(resolve(root, "entry.mjs"), "import './missing.mjs';\n");
    assert.throws(
      () => assertRelativeImportClosure(root),
      /missing relative import target/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertReleaseClosure fails when required install/runtime files are missing", () => {
  const root = mkdtempSync(resolve(tmpdir(), "browser-flow-release-closure-required-"));
  try {
    mkdirSync(resolve(root, "skills/browser-flow"), { recursive: true });
    writeFileSync(resolve(root, "skills/browser-flow/SKILL.md"), "# Browser Flow\n");
    assert.throws(
      () => assertReleaseClosure(root, { smoke: false }),
      /missing required file/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
