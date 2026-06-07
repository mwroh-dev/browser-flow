import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfilesRoot, profilePath } from "../../scripts/lib/config.mjs";

test("profilePath accepts well-formed names", () => {
  const previous = process.env.BROWSER_FLOW_PROFILES_PATH;
  const root = mkdtempSync(join(tmpdir(), "browser-flow-profile-test-"));
  process.env.BROWSER_FLOW_PROFILES_PATH = root;
  try {
    for (const name of ["notebooklm", "github", "a", "service-1", "abc-def-ghi", "x".repeat(60)]) {
      const dir = profilePath(name);
      assert.equal(typeof dir, "string");
      assert.equal(dir.startsWith(getProfilesRoot()), true, `profilePath must resolve under getProfilesRoot for "${name}"`);
      assert.equal(dir.endsWith(name), true);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.BROWSER_FLOW_PROFILES_PATH;
    } else {
      process.env.BROWSER_FLOW_PROFILES_PATH = previous;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("profilePath rejects invalid names", () => {
  const invalid = [
    "",                  // empty
    "Foo",               // uppercase
    "foo_bar",           // underscore not allowed
    "foo.bar",           // dot not allowed
    "foo/bar",           // slash not allowed
    "-foo",              // dash-leading
    "foo!",              // special char
    "x".repeat(61)       // too long
  ];
  for (const name of invalid) {
    assert.throws(
      () => profilePath(name),
      /Invalid profile name/,
      `expected throw for invalid name "${name}"`
    );
  }
});

test("profilePath rejects non-string input", () => {
  // @ts-expect-error — runtime tolerance for wrong types
  assert.throws(() => profilePath(undefined), /Invalid profile name/);
  // @ts-expect-error
  assert.throws(() => profilePath(null), /Invalid profile name/);
  // @ts-expect-error
  assert.throws(() => profilePath(123), /Invalid profile name/);
});
