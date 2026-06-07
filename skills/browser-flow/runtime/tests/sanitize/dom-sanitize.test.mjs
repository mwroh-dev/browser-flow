import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDomSnapshot } from "../../scripts/sanitize/dom-sanitize.mjs";

// Parser-backed DOM sanitize. Replaces regex implementation with a
// parse5 walker. Preserves the safe-mode policy outputs on existing
// fixtures and adds two textContent redaction rules
// (secret-context proximity + email pattern).

test("strips <script> body even when embedded in attributes", () => {
  // Regex implementation could over-strip on attribute-embedded
  // "<script>" strings. Parser-backed handles HTML structure
  // properly.
  const html = `<html><body>
    <button data-onclick='alert("<script>noop</script>")'>Click</button>
    <script>const secret = "leak-via-script";</script>
  </body></html>`;
  const sanitized = sanitizeDomSnapshot(html);
  // The real <script> element's body must be empty.
  assert.match(sanitized, /<script><\/script>/);
  assert.equal(sanitized.includes("leak-via-script"), false, "real script body must be stripped");
  // The attribute-embedded literal must survive (parsed as an
  // attribute value, not a script tag).
  assert.match(sanitized, /data-onclick=/);
});

test("strips <style> body", () => {
  const html = "<html><body><style>body { color: red; }</style><p>hi</p></body></html>";
  const sanitized = sanitizeDomSnapshot(html);
  assert.match(sanitized, /<style><\/style>/);
  assert.equal(sanitized.includes("color: red"), false);
});

test("redacts <input value=…> attributes", () => {
  const html = `<html><body><input type="text" name="displayName" value="Codex"/></body></html>`;
  const sanitized = sanitizeDomSnapshot(html);
  assert.match(sanitized, /value="<redacted-input-value>"/);
  assert.equal(sanitized.includes("Codex"), false);
});

test("secret-context proximity redacts nearby textContent", () => {
  // An input named "password" + a sibling span containing user-typed
  // value text in the DOM. Both the value attribute and the displayed
  // text get redacted.
  const html = `<html><body>
    <form>
      <input type="password" name="password" value="hunter2"/>
      <span class="display">hunter2 displayed in the chrome</span>
    </form>
  </body></html>`;
  const sanitized = sanitizeDomSnapshot(html);
  // value attribute redacted
  assert.match(sanitized, /value="<redacted-input-value>"/);
  // Nearby textContent inside the same form parent → redacted.
  assert.match(sanitized, /[redacted-secret-text]/);
  assert.equal(sanitized.includes("hunter2 displayed"), false, "text near a secret-named field must be redacted");
});

test("email pattern in textContent is redacted", () => {
  const html = "<html><body><div>Logged in as someone@example.com</div></body></html>";
  const sanitized = sanitizeDomSnapshot(html);
  assert.match(sanitized, /[redacted-email]/);
  assert.equal(sanitized.includes("someone@example.com"), false);
  // Surrounding text preserved.
  assert.match(sanitized, /Logged in as/);
});

test("empty / non-string input returns empty string", () => {
  assert.equal(sanitizeDomSnapshot(""), "");
  // @ts-expect-error — runtime tolerance for non-string input
  assert.equal(sanitizeDomSnapshot(null), "");
  // @ts-expect-error
  assert.equal(sanitizeDomSnapshot(undefined), "");
});

test("no false positives — text without secrets or emails passes through", () => {
  const html = "<html><body><h1 data-bf-evidence='heading'>Synthetic Demo</h1><p>Hello, Codex</p></body></html>";
  const sanitized = sanitizeDomSnapshot(html);
  assert.match(sanitized, /Synthetic Demo/);
  assert.match(sanitized, /Hello, Codex/);
  assert.equal(
    sanitized.includes("[redacted-") || sanitized.includes("<redacted-"),
    false,
    "no spurious redactions on clean fixture content"
  );
});
