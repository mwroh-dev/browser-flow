import test from "node:test";
import assert from "node:assert/strict";
import { classifyIrreversible } from "../../scripts/lib/safety-classify.mjs";

test("classifyIrreversible flags payment/email/share steps by keyword, leaves benign", () => {
  const steps = [
    { action: "goto", url: "https://x.com" },
    { action: "click", selector: "button", text: "결제하기", href: "" },       // payment
    { action: "click", selector: "button[aria-label='send email']", text: "send" }, // email
    { action: "click", selector: "button", text: "외부 공유", href: "" },        // share
    { action: "click", selector: "button", text: "검색 열기" }                   // benign
  ];
  assert.deepEqual(classifyIrreversible(steps), [1, 2, 3]);
});

test("classifyIrreversible returns [] when no irreversible step", () => {
  assert.deepEqual(classifyIrreversible([{ action: "click", text: "열기" }]), []);
});

test("classifyIrreversible matches across text/selector/url/href/formAction", () => {
  const steps = [
    { action: "submit", formAction: "/checkout/payment", selector: "form" },
    { action: "click", selector: "a[href='/share/external']", text: "" }
  ];
  assert.deepEqual(classifyIrreversible(steps), [0, 1]);
});
