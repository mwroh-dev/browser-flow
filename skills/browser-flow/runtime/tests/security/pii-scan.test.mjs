import { test } from "node:test";
import assert from "node:assert/strict";
import { findPii } from "../../scripts/security/pii-scan.mjs";

test("flags a real home path", () => {
  const hits = findPii("const p = '/Users/testuser-real/projects/x';");
  assert.ok(hits.some((h) => h.type === "home-path"), "home-path detected");
});

test("flags a supplied identity term", () => {
  assert.ok(
    findPii("author synthetic-identity-xyz", ["synthetic-identity-xyz"]).some(
      (h) => h.type === "identity"
    )
  );
});

test("does not flag identity when none supplied", () => {
  assert.deepEqual(findPii("author synthetic-identity-xyz"), []);
});

test("flags a real email", () => {
  assert.ok(findPii("me@real-domain.io").some((h) => h.type === "email"));
});

test("allows synthetic home path", () => {
  assert.deepEqual(findPii("/Users/x/file.pdf"), []);
});

test("allows exact-whitelisted email x@y.com", () => {
  assert.deepEqual(findPii("x@y.com"), []);
});

test("flags other y.com addresses (not exact-whitelisted)", () => {
  assert.ok(findPii("other@y.com").some((h) => h.type === "email"));
});

test("allows example.com email", () => {
  assert.deepEqual(findPii("someone@example.com"), []);
});
