const BLOCKED_VISIBLE_TEXT_PATTERN =
  /\b(delete|remove|destroy|create|save|update|publish|archive|submit|send|purchase|checkout|confirm)\b/i;
const BLOCKED_ACTION_VERBS = new Set([
  "delete",
  "remove",
  "destroy",
  "create",
  "save",
  "update",
  "publish",
  "archive",
  "send",
  "purchase",
  "checkout",
  "confirm"
]);

function actionName(action) {
  if (typeof action === "string") return action;
  if (action && typeof action === "object" && typeof action.action === "string") return action.action;
  return "";
}

function visibleText(action) {
  if (!action || typeof action !== "object") return "";
  const values = [action.text, action.name, action.label, action.ariaLabel, action.visibleText];
  return values.filter((value) => typeof value === "string").join(" ");
}

export function assertComposeActionAllowed({ mode, action }) {
  if (mode !== "public-read") return;
  if (BLOCKED_ACTION_VERBS.has(actionName(action)) || BLOCKED_VISIBLE_TEXT_PATTERN.test(visibleText(action))) {
    throw new Error("policy_blocked");
  }
}
