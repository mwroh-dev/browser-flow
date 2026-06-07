import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVerifySpecPaths } from "../../scripts/lib/config.mjs";
import { loadMergedQuestions, writeVerifySpec, readVerifySpec } from "../../scripts/lib/verify-spec.mjs";

test("questions.base.json is a non-empty array of well-formed questions", () => {
  const { basePath } = getVerifySpecPaths("any");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  assert.ok(Array.isArray(base) && base.length >= 5);
  for (const q of base) {
    assert.ok(typeof q.id === "string" && q.id.length > 0);
    assert.ok(typeof q.prompt === "string" && q.prompt.length > 0);
    assert.ok(["site","credential","file","input","teardown","sandbox","safety","registry","auth","data","privacy"].includes(q.category));
  }
  const ids = base.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const required of ["site-url","login-required","file-location","teardown-strategy","irreversible-ops-consent"]) {
    assert.ok(ids.includes(required), `missing seed question ${required}`);
  }
});

test("loadMergedQuestions merges override by id without mutating base", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec-"));
  const basePath = join(dir, "base.json");
  const overridePath = join(dir, "override.json");
  const base = [{ id: "site-url", prompt: "base prompt", category: "site" }, { id: "login-required", prompt: "p2", category: "credential" }];
  writeFileSync(basePath, JSON.stringify(base));
  writeFileSync(overridePath, JSON.stringify([
    { id: "site-url", prompt: "OVERRIDDEN", category: "site" },
    { id: "custom-q", prompt: "new", category: "input" }
  ]));
  const merged = loadMergedQuestions(basePath, overridePath);
  const byId = Object.fromEntries(merged.map((q) => [q.id, q]));
  assert.ok(byId["site-url"] != null);
  assert.equal(byId["site-url"].prompt, "OVERRIDDEN");
  assert.ok(byId["custom-q"] != null);
  assert.equal(byId["custom-q"].prompt, "new");
  assert.ok(byId["login-required"] != null);
  assert.equal(byId["login-required"].prompt, "p2");
  // base file on disk unchanged
  assert.equal(JSON.parse(readFileSync(basePath, "utf8"))[0].prompt, "base prompt");
});

test("loadMergedQuestions returns base when override absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec2-"));
  const basePath = join(dir, "base.json");
  writeFileSync(basePath, JSON.stringify([{ id: "x", prompt: "p", category: "site" }]));
  const merged = loadMergedQuestions(basePath, join(dir, "nonexistent.json"));
  assert.equal(merged.length, 1);
});

test("writeVerifySpec + readVerifySpec round-trip with schema validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec3-"));
  const p = join(dir, "verify-spec.json");
  const spec = { schemaVersion: 1, answers: { "site-url": "https://x", "teardown-strategy": "record" } };
  writeVerifySpec(p, spec);
  const back = readVerifySpec(p);
  assert.ok(back != null);
  assert.equal(back.answers["site-url"], "https://x");
});

test("readVerifySpec throws on malformed (missing schemaVersion)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vspec4-"));
  const p = join(dir, "bad.json");
  writeFileSync(p, JSON.stringify({ answers: {} }));
  assert.throws(() => readVerifySpec(p), /schemaVersion|Invalid/i);
});
