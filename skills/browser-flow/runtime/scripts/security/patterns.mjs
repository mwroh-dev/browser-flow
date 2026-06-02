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
export const SECRET_FIELD_PATTERN = /(pass(word)?|secret|token|csrf|session|auth|cookie|key)/i;
export const HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9+=]{24,}\b/;
