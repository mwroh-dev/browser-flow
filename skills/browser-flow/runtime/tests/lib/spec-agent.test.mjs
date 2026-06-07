import test from "node:test";
import assert from "node:assert/strict";
import { detectGaps } from "../../scripts/lib/spec-agent.mjs";

const QS = [
  { id: "site-url", category: "site", detectInRawRequest: "https?://|사이트|url" },
  { id: "login-required", category: "credential", detectInRawRequest: "로그인|login" },
  { id: "teardown-strategy", category: "teardown", detectInRawRequest: "정리|teardown|cleanup" }
];

test("detectGaps marks a question answered when raw request matches its pattern", () => {
  const { answered, missing } = detectGaps(QS, "https://notebooklm.google.com 에서 로그인 후 작업", {});
  assert.deepEqual(answered.sort(), ["login-required", "site-url"]);
  assert.deepEqual(missing, ["teardown-strategy"]);
});

test("detectGaps treats knownAnswers as answered regardless of raw text", () => {
  const { answered, missing } = detectGaps(QS, "", { "teardown-strategy": "record" });
  assert.ok(answered.includes("teardown-strategy"));
  assert.ok(missing.includes("site-url"));
});

test("detectGaps with no detectInRawRequest pattern is always missing unless known", () => {
  const { missing } = detectGaps([/** @type {any} */ ({ id: "q1", category: "input" })], "anything", {});
  assert.deepEqual(missing, ["q1"]);
});

test("detectGaps skips external-target questions for local requests", () => {
  const questions = [
    { id: "external-promotion-intent", category: "registry", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|keep|naver|gmail|external|reuse|save" },
    { id: "external-auth-profile-policy", category: "auth", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|keep|naver|gmail|external|reuse|save" },
    { id: "site-url", category: "site", detectInRawRequest: "https?://|사이트|url" }
  ];

  const { answered, missing } = detectGaps(questions, "Use the local docs fixture to click the settings button", {});

  assert.ok(!answered.includes("external-promotion-intent"));
  assert.ok(!answered.includes("external-auth-profile-policy"));
  assert.ok(!missing.includes("external-promotion-intent"));
  assert.ok(!missing.includes("external-auth-profile-policy"));
  assert.ok(missing.includes("site-url"));
});

test("detectGaps does not treat local docs fixture keep or reuse wording as external", () => {
  const questions = [
    { id: "external-promotion-intent", category: "registry", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|google keep|keep\\.google\\.com|naver|gmail|external|--unmasked|https?://(?!localhost|127\\.0\\.0\\.1|\\[::1\\])" },
    { id: "external-auth-profile-policy", category: "auth", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|google keep|keep\\.google\\.com|naver|gmail|external|--unmasked|https?://(?!localhost|127\\.0\\.0\\.1|\\[::1\\])" },
    { id: "site-url", category: "site", detectInRawRequest: "https?://|사이트|url" }
  ];

  const { answered, missing } = detectGaps(questions, "Use the local docs fixture and keep it reusable", {});

  assert.ok(!answered.includes("external-promotion-intent"));
  assert.ok(!answered.includes("external-auth-profile-policy"));
  assert.ok(!missing.includes("external-promotion-intent"));
  assert.ok(!missing.includes("external-auth-profile-policy"));
  assert.ok(missing.includes("site-url"));
});

test("detectGaps does not treat local bookkeeping fixture as external", () => {
  const questions = [
    { id: "external-promotion-intent", category: "registry", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|google keep|keep\\.google\\.com|naver|gmail|external|--unmasked|https?://(?!localhost|127\\.0\\.0\\.1|\\[::1\\])" },
    { id: "external-auth-profile-policy", category: "auth", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|google keep|keep\\.google\\.com|naver|gmail|external|--unmasked|https?://(?!localhost|127\\.0\\.0\\.1|\\[::1\\])" },
    { id: "site-url", category: "site", detectInRawRequest: "https?://|사이트|url" }
  ];

  const { answered, missing } = detectGaps(questions, "local bookkeeping fixture", {});

  assert.ok(!answered.includes("external-promotion-intent"));
  assert.ok(!answered.includes("external-auth-profile-policy"));
  assert.ok(!missing.includes("external-promotion-intent"));
  assert.ok(!missing.includes("external-auth-profile-policy"));
  assert.ok(missing.includes("site-url"));
});

test("detectGaps asks external-target questions for a local-first then external URL request", () => {
  const questions = [
    { id: "external-promotion-intent", category: "registry", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|google keep|keep\\.google\\.com|naver|gmail|external|--unmasked|https?://(?!localhost|127\\.0\\.0\\.1|\\[::1\\])" },
    { id: "external-auth-profile-policy", category: "auth", requiredWhen: "external-target", detectInRawRequest: "notion|notebooklm|google keep|keep\\.google\\.com|naver|gmail|external|--unmasked|https?://(?!localhost|127\\.0\\.0\\.1|\\[::1\\])" },
    { id: "site-url", category: "site", detectInRawRequest: "https?://|사이트|url" }
  ];

  const { answered, missing } = detectGaps(questions, "Open http://localhost:3000 then compare https://example.com", {});

  assert.ok(missing.includes("external-promotion-intent"));
  assert.ok(missing.includes("external-auth-profile-policy"));
  assert.ok(!answered.includes("external-promotion-intent"));
  assert.ok(!answered.includes("external-auth-profile-policy"));
  assert.ok(answered.includes("site-url"));
});
