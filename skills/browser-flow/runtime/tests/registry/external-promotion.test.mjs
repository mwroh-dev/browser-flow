import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRegistryPromotion,
  collectExternalWorkflowOrigins,
  normalizeOrigins,
  registrySafeUrl
} from "../../scripts/registry/external-promotion.mjs";

test("normalizeOrigins keeps explicit origins", () => {
  assert.deepEqual(
    normalizeOrigins("https://www.notion.so, https://notebooklm.google.com/path, http://localhost:3000"),
    ["https://www.notion.so", "https://notebooklm.google.com", "http://localhost:3000"]
  );
});

test("normalizeOrigins rejects opaque origins", () => {
  assert.throws(
    () => normalizeOrigins("file:///tmp/workflow.html"),
    /origin/
  );
});

test("registrySafeUrl redacts non-http and opaque URL strings", () => {
  assert.equal(registrySafeUrl("file:///Users/example/private.html?token=secret"), "<non-http-url>");
  assert.equal(registrySafeUrl("data:text/html,secret"), "<non-http-url>");
});

test("collectExternalWorkflowOrigins includes expected network evidence URL", () => {
  assert.deepEqual(
    collectExternalWorkflowOrigins({
      startUrl: "https://www.notion.so/page",
      finalUrl: "https://www.notion.so/page",
      verification: {
        expectedNetwork: { url: "https://api.notion.com/v1/search" }
      }
    }),
    ["https://www.notion.so", "https://api.notion.com"]
  );
});

test("classifyRegistryPromotion refuses unapproved external workflows", () => {
  const result = classifyRegistryPromotion({
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: { scope: "external", approved: false, origins: ["https://www.notion.so"] }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "external_requires_operator_approval");
});

test("classifyRegistryPromotion refuses missing external policy metadata", () => {
  const result = classifyRegistryPromotion({
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "external_requires_policy_metadata");
});

test("classifyRegistryPromotion refuses origins that do not cover persisted URLs", () => {
  const result = classifyRegistryPromotion({
    status: "replay_verified",
    startUrl: "https://www.notion.so/page",
    finalUrl: "https://www.notion.so/page",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://example.com"],
      authMode: "login-required",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "external_origin_not_approved");
});

test("classifyRegistryPromotion allows approved external replay-verified workflows", () => {
  const result = classifyRegistryPromotion({
    status: "replay_verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"],
      authMode: "login-required",
      profileMode: "ephemeral",
      privacyLevel: "minimal",
      screenshots: "off",
      dataMode: "route"
    }
  });

  assert.equal(result.ok, true);
});

test("classifyRegistryPromotion refuses external legacy verified status", () => {
  const result = classifyRegistryPromotion({
    status: "verified",
    security: { localOnly: false, targetScope: "external" },
    promotion: {
      scope: "external",
      approved: true,
      origins: ["https://www.notion.so"]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "external_requires_replay_verified_status");
});
