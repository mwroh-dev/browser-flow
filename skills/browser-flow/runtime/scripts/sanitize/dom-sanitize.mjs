// DOM snapshot sanitization.
//
// Policy: strip script/style body, redact `<input value=…>`, and add two
// textContent redaction rules for real-site captures (NotebookLM-class):
//
// - secret-context proximity: text nodes that share a DOM ancestor /
//   sibling with an input whose `name` matches SECRET_FIELD_PATTERN
//   are replaced with `[redacted-secret-text]`
// - email pattern: text-node substrings matching a conservative email
//   regex are replaced with `[redacted-email]`
//
// Conservative on purpose:
// - only email pattern; phone / SSN / credit-card defer until
//   real-site capture surfaces leaks the email pattern misses
// - secret-context proximity caps ancestor depth at 5 to avoid
//   redacting an entire page that happens to contain a password
//   field somewhere

import { parse, serialize } from "parse5";

const SECRET_FIELD_PATTERN = /(pass(word)?|secret|token|csrf|session|auth|cookie|key)/i;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const SECRET_CONTEXT_DEPTH = 5;
const SECRET_FIELD_TAGS = new Set(["input", "textarea", "select"]);

/**
 * @typedef {{
 *   nodeName?: string,
 *   tagName?: string,
 *   attrs?: Array<{ name: string, value: string }>,
 *   childNodes?: ParseNode[],
 *   parentNode?: ParseNode | null,
 *   value?: string
 * }} ParseNode
 */

/**
 * @param {string} html
 * @returns {string}
 */
export function sanitizeDomSnapshot(html) {
  if (typeof html !== "string" || html.length === 0) {
    return "";
  }

  const document = parse(html);

  walkNodes(document, (node) => {
    if (!isElementNode(node)) {
      return;
    }
    if (node.tagName === "script" || node.tagName === "style") {
      node.childNodes = [];
      return;
    }
    if (node.tagName === "input" && hasAttr(node, "value")) {
      setAttr(node, "value", "<redacted-input-value>");
    }
  });

  /** @type {Set<ParseNode>} */
  const secretFields = new Set();
  walkNodes(document, (node) => {
    if (!isElementNode(node) || !SECRET_FIELD_TAGS.has(node.tagName)) {
      return;
    }
    const name = getAttr(node, "name") || "";
    if (SECRET_FIELD_PATTERN.test(name)) {
      secretFields.add(node);
    }
  });

  walkTextNodes(findPrimaryRoot(document), (textNode) => {
    if (isNearSecretField(textNode, secretFields)) {
      textNode.value = "[redacted-secret-text]";
      return;
    }
    const original = textNode.value;
    if (typeof original === "string" && EMAIL_PATTERN.test(original)) {
      EMAIL_PATTERN.lastIndex = 0;
      textNode.value = original.replace(EMAIL_PATTERN, "[redacted-email]");
    }
  });

  return serialize(document);
}

/**
 * @param {ParseNode | null | undefined} root
 * @param {(node: ParseNode) => void} visit
 */
function walkNodes(root, visit) {
  if (!root) {
    return;
  }
  /** @type {ParseNode[]} */
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    visit(node);
    const children = Array.isArray(node.childNodes) ? node.childNodes : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }
}

/**
 * @param {ParseNode | null | undefined} root
 * @param {(node: ParseNode) => void} visit
 */
function walkTextNodes(root, visit) {
  walkNodes(root, (node) => {
    if (node.nodeName === "#text") {
      visit(node);
    }
  });
}

/**
 * @param {ParseNode} document
 * @returns {ParseNode}
 */
function findPrimaryRoot(document) {
  /** @type {ParseNode | null} */
  let html = null;
  /** @type {ParseNode | null} */
  let body = null;
  walkNodes(document, (node) => {
    if (!html && isElementNode(node) && node.tagName === "html") {
      html = node;
    }
    if (!body && isElementNode(node) && node.tagName === "body") {
      body = node;
    }
  });
  return body || html || document;
}

/**
 * @param {ParseNode | null | undefined} node
 * @returns {node is ParseNode & { tagName: string, attrs?: Array<{ name: string, value: string }> }}
 */
function isElementNode(node) {
  return Boolean(node && typeof node.tagName === "string");
}

/**
 * @param {ParseNode} node
 * @param {string} name
 */
function getAttr(node, name) {
  const attrs = Array.isArray(node.attrs) ? node.attrs : [];
  for (const attr of attrs) {
    if (attr.name === name) {
      return attr.value;
    }
  }
  return null;
}

/**
 * @param {ParseNode} node
 * @param {string} name
 */
function hasAttr(node, name) {
  return getAttr(node, name) !== null;
}

/**
 * @param {ParseNode} node
 * @param {string} name
 * @param {string} value
 */
function setAttr(node, name, value) {
  if (!Array.isArray(node.attrs)) {
    node.attrs = [];
  }
  for (const attr of node.attrs) {
    if (attr.name === name) {
      attr.value = value;
      return;
    }
  }
  node.attrs.push({ name, value });
}

/**
 * A text node is "near" a secret field if any secret field is an
 * ancestor within SECRET_CONTEXT_DEPTH hops, or shares the immediate
 * parent.
 *
 * @param {ParseNode} textNode
 * @param {Set<ParseNode>} secretFields
 */
function isNearSecretField(textNode, secretFields) {
  if (secretFields.size === 0) {
    return false;
  }
  let cursor = textNode.parentNode || null;
  for (let depth = 0; depth < SECRET_CONTEXT_DEPTH && cursor; depth += 1) {
    for (const field of secretFields) {
      if (cursor === field) {
        return true;
      }
      /** @type {ParseNode | null} */
      const fieldParent = field.parentNode || null;
      if (fieldParent && cursor === fieldParent) {
        return true;
      }
    }
    cursor = cursor.parentNode || null;
  }
  return false;
}
