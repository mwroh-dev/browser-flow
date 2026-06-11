export const SENSITIVE_HEADER_NAMES = [
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

export const SECRET_HEADER_PATTERN = new RegExp(`^(${SENSITIVE_HEADER_NAMES.join("|")})$`, "i");
// "key" needs two shapes: compound secrets (apiKey, access_key, sshkey — any
// case/separator after a known prefix) and the standalone token ("key",
// "key_id"). A bare boundary cannot keep apikey while dropping hotkey, so the
// compound side is an explicit prefix list. Plain-word false positives
// (keyboard, monkey, whiskey) match neither shape.
export const SECRET_FIELD_PATTERN = /(?:pass(?:word)?|secret|token|csrf|session|auth|cookie|(?:api|access|priv(?:ate)?|pub(?:lic)?|ssh|aws|gcp|gpg|pgp|sign(?:ing)?|enc(?:ryption)?|crypto?|license|client|server|host|master|account|app|user|service|webhook|device|push|admin|recovery|backup)[-_ ]?key|(?<![a-z0-9])key(?![a-z]))/i;
export const HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9+=]{24,}\b/;
