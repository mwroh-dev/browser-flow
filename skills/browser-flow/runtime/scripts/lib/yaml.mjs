/**
 * @param {unknown} value
 * @param {number} indent
 * @returns {string}
 */
function serialize(value, indent) {
  const padding = " ".repeat(indent);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const inner = serialize(item, indent + 2);
          return `${padding}- ${inner.startsWith("\n") ? inner.slice(1) : inner.replace(/^ */, "")}`;
        }
        return `${padding}- ${formatScalar(item)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    return Object.entries(/** @type {Record<string, unknown>} */ (value))
      .map(([key, entryValue]) => {
        if (Array.isArray(entryValue)) {
          return `${padding}${key}:\n${serialize(entryValue, indent + 2)}`;
        }
        if (entryValue && typeof entryValue === "object") {
          return `${padding}${key}:\n${serialize(entryValue, indent + 2)}`;
        }
        return `${padding}${key}: ${formatScalar(entryValue)}`;
      })
      .join("\n");
  }

  return `${padding}${formatScalar(value)}`;
}

/**
 * @param {unknown} value
 */
function formatScalar(value) {
  if (typeof value === "string") {
    if (/^[A-Za-z0-9._/-]+$/.test(value)) {
      return value;
    }
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}

/**
 * @param {Record<string, unknown>} value
 */
export function toYaml(value) {
  return `${serialize(value, 0)}\n`;
}
