// Irreversible / high-consequence categories. Deterministic keyword
// flagging only — LLM refinement + operator confirmation is offline
// (the pipeline stays LLM-free). Conservative on purpose: better to
// flag a benign step for operator review than to silently replay a
// payment. Operator can un-flag during first-verify confirmation.
const IRREVERSIBLE_PATTERN = new RegExp(
  [
    "결제", "payment", "checkout", "purchase", "구매", "송금", "이체", "transfer",
    "이메일", "email", "메일\\b", "send.?mail", "발송", "전송",
    "공유", "share", "external", "외부",
    "삭제", "delete", "remove", "탈퇴", "withdraw", "구독.?취소", "unsubscribe", "결제.?취소"
  ].join("|"),
  "i"
);

/** @param {unknown} text */
export function isIrreversibleText(text) {
  return IRREVERSIBLE_PATTERN.test(String(text || ""));
}

/**
 * Flag step indexes that look irreversible / high-consequence by keyword
 * across text / selector / url / href / formAction.
 *
 * @param {Array<Record<string, unknown>>} steps
 * @returns {number[]}
 */
export function classifyIrreversible(steps) {
  /** @type {number[]} */
  const flagged = [];
  steps.forEach((step, i) => {
    const haystack = [step.text, step.selector, step.url, step.href, step.formAction, step.submitterText]
      .filter((v) => typeof v === "string")
      .join(" ");
    if (isIrreversibleText(haystack)) flagged.push(i);
  });
  return flagged;
}
