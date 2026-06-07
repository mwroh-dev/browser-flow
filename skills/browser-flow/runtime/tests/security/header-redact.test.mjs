import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveHeaderName, sanitizeHeaders } from "../../scripts/security/redact.mjs";

// Header-name redaction promoted from exact-match to substring match
// using SECRET_FIELD_PATTERN. Tests cover:
// - existing exact-name headers still redacted
// - vendor-prefixed variants newly redacted
// - benign headers still pass through (no over-redaction)

test("existing canonical sensitive headers stay redacted (regression)", () => {
  const canonicalSensitive = [
    "cookie",
    "set-cookie",
    "authorization",
    "proxy-authorization",
    "x-csrf-token",
    "x-xsrf-token",
    "x-api-key",
    "x-auth-token",
    "api-key"
  ];
  for (const name of canonicalSensitive) {
    assert.equal(isSensitiveHeaderName(name), true, `expected ${name} to be sensitive`);
    assert.equal(isSensitiveHeaderName(name.toUpperCase()), true, `case insensitivity: ${name}`);
  }
});

test("vendor-prefixed variants are now redacted (defect closed)", () => {
  const vendorVariants = [
    "x-goog-api-key",            // observed in NotebookLM capture
    "x-goog-authuser",
    "x-goog-auth-token",
    "x-google-api-key",
    "x-google-auth-token",
    "x-aws-api-key",
    "x-azure-auth-token",
    "x-github-token",
    "x-mycompany-session-id",
    "x-debug-csrf"
  ];
  for (const name of vendorVariants) {
    assert.equal(isSensitiveHeaderName(name), true, `expected ${name} to be sensitive (substring match)`);
  }
});

test("benign headers still pass through (no over-redaction)", () => {
  const benign = [
    "content-type",
    "content-length",
    "content-encoding",
    "cache-control",
    "accept",
    "accept-encoding",
    "accept-language",
    "host",
    "referer",
    "user-agent",
    "x-frame-options",
    "x-content-type-options",
    "x-request-id",
    "x-trace-id",
    "etag",
    "last-modified",
    "connection",
    "date",
    "server",
    "vary",
    "sec-ch-ua",
    "sec-ch-ua-platform",
    "sec-ch-ua-mobile",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "transfer-encoding",
    "upgrade-insecure-requests"
  ];
  for (const name of benign) {
    assert.equal(isSensitiveHeaderName(name), false, `expected ${name} to be benign (must pass through)`);
  }
});

test("sanitizeHeaders strips sensitive (canonical + vendor) and keeps benign", () => {
  const headers = {
    "Authorization": "Bearer some-token",
    "X-Goog-Api-Key": "AIzaSyExampleValueForTestUseOnly",
    "x-google-auth-token": "g-auth-value",
    "Content-Type": "application/json",
    "Accept-Language": "ko-KR,ko;q=0.9"
  };
  const sanitized = sanitizeHeaders(headers);
  assert.equal("Authorization" in sanitized, false, "Authorization must be stripped");
  assert.equal("X-Goog-Api-Key" in sanitized, false, "X-Goog-Api-Key must be stripped");
  assert.equal("x-google-auth-token" in sanitized, false, "x-google-auth-token must be stripped");
  assert.equal(sanitized["Content-Type"], "application/json", "benign Content-Type must pass through");
  assert.equal(sanitized["Accept-Language"], "ko-KR,ko;q=0.9", "benign Accept-Language must pass through");
});
