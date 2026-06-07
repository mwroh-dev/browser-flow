import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolveChromeBinary } from "../../scripts/cdp/chrome-binary.mjs";

test("resolveChromeBinary returns an existing executable path", () => {
  const path = resolveChromeBinary();
  assert.ok(path, "expected a non-empty path");
  assert.ok(existsSync(path), `expected ${path} to exist`);
});

test("resolveChromeBinary respects BROWSER_FLOW_CHROME_PATH override", () => {
  const original = process.env.BROWSER_FLOW_CHROME_PATH;
  process.env.BROWSER_FLOW_CHROME_PATH = "/tmp/fake-chrome-binary-does-not-exist";
  try {
    assert.throws(() => resolveChromeBinary(), /BROWSER_FLOW_CHROME_PATH/);
  } finally {
    if (original === undefined) delete process.env.BROWSER_FLOW_CHROME_PATH;
    else process.env.BROWSER_FLOW_CHROME_PATH = original;
  }
});
