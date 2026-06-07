import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { collectPageEvidence } from "../../scripts/observe/page-evidence.mjs";

class FakeHTMLElement {}

class FakeElement extends FakeHTMLElement {
  /**
   * @param {string} tagName
   * @param {{ id?: string, className?: string, text?: string, dataset?: Record<string, string>, attrs?: Record<string, string>, hidden?: boolean, rect?: { width: number, height: number }, throwOnInnerText?: boolean, throwOnLayout?: boolean, nullStyle?: boolean }} [options]
   */
  constructor(tagName, options = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.id = options.id ?? "";
    this.className = options.className ?? "";
    this.textContent = options.text ?? "";
    this.dataset = options.dataset ?? {};
    this.attrs = options.attrs ?? {};
    this.hidden = options.hidden === true;
    this.rect = options.rect ?? { width: 40, height: 20 };
    this.throwOnInnerText = options.throwOnInnerText === true;
    this.throwOnLayout = options.throwOnLayout === true;
    this.nullStyle = options.nullStyle === true;
    this.children = [];
  }

  /**
   * @param {string} name
   */
  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name === "role" && this.attrs.role) return this.attrs.role;
    if (name === "aria-live" && this.attrs["aria-live"]) return this.attrs["aria-live"];
    return this.attrs[name] ?? null;
  }

  /**
   * @param {string} name
   */
  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  /**
   * @param {string} selector
   */
  matches(selector) {
    const normalized = selector.trim().replace(/^:scope\s*/, "");
    if (!normalized) return false;
    if (normalized === "[data-bf-evidence]") return !!this.dataset.bfEvidence;
    if (normalized === "[role=status]" || normalized === '[role="status"]') {
      return this.getAttribute("role") === "status";
    }
    if (normalized === "[aria-live]") return this.hasAttribute("aria-live");
    if (normalized === "[id]") return !!this.id;
    if (normalized === "[class]") return !!this.className;
    if (normalized.startsWith("#")) return this.id === normalized.slice(1);
    if (/^[a-z][a-z0-9-]*$/i.test(normalized)) return this.tagName.toLowerCase() === normalized.toLowerCase();
    const contains = normalized.match(/^\[(id|class)\*=["']?([a-z-]+)["']?\s*i?\]$/i);
    if (contains) {
      const value = contains[1].toLowerCase() === "id" ? this.id : this.className;
      return value.toLowerCase().includes(contains[2].toLowerCase());
    }
    return false;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  get innerText() {
    if (this.throwOnInnerText) {
      throw new Error("innerText should not be read while filtering page evidence candidates");
    }
    return this.textContent;
  }
}

test("collectPageEvidence includes bounded detail evidence and excludes hidden or non-content text", async () => {
  const url = "http://127.0.0.1:59999/shop";
  const nodes = [
    new FakeElement("h1", { text: "Demo Shop" }),
    new FakeElement("button", { id: "view-detail", text: "View detail", throwOnInnerText: true }),
    new FakeElement("div", { id: "empty-detail", text: "", throwOnLayout: true }),
    new FakeElement("div", { id: "detached-detail", text: "Detached Banana Milk", nullStyle: true }),
    new FakeElement("div", { id: "detail", text: "Banana Milk costs $2.10" }),
    new FakeElement("div", { id: "detail-hidden-parent", text: "Parent-hidden Banana Milk", rect: { width: 0, height: 0 } }),
    new FakeElement("div", { id: "hidden-detail", text: "Hidden Banana Milk costs $0", hidden: true }),
    new FakeElement("script", { text: "Banana Milk costs $999" }),
    new FakeElement("style", { text: "#detail{display:block}" }),
    new FakeElement("template", { text: "Template Banana Milk" })
  ];
  const session = {
    sessionManager: { getSessionId: () => "session-1" },
    client: {
      send: async (_method, params) => ({
        result: {
          value: runInNewContext(params.expression, {
            document: {
              querySelectorAll: (selector) => nodes.filter((node) =>
                selector.split(",").some((part) => node.matches(part))
              )
            },
            location: { href: url },
            HTMLElement: FakeHTMLElement,
            getComputedStyle: (node) => {
              if (node.throwOnLayout) {
                throw new Error("layout should not be read for textless page evidence candidates");
              }
              if (node.nullStyle) return null;
              return {
                display: node.hidden ? "none" : "block",
                visibility: node.hidden ? "hidden" : "visible",
                opacity: node.hidden ? "0" : "1"
              };
            }
          })
        }
      })
    }
  };

  const evidence = await collectPageEvidence(session, "target-1");

  assert.ok(evidence.some((entry) => entry.selector === "#detail" && entry.text === "Banana Milk costs $2.10"));
  assert.equal(evidence.some((entry) => entry.selector === "#view-detail"), false);
  assert.equal(evidence.some((entry) => entry.selector === "#empty-detail"), false);
  assert.equal(evidence.some((entry) => entry.selector === "#detached-detail"), false);
  assert.equal(evidence.some((entry) => entry.selector === "#detail-hidden-parent"), false);
  assert.equal(evidence.some((entry) => entry.text?.includes("Hidden Banana")), false);
  assert.equal(evidence.some((entry) => entry.text?.includes("999")), false);
  assert.equal(evidence.some((entry) => entry.text?.includes("Template Banana")), false);
});

test("collectPageEvidence includes plural semantic region labels", async () => {
  const url = "http://127.0.0.1:59999/shop";
  const nodes = [
    new FakeElement("div", { id: "order-details", text: "Banana Milk details" })
  ];
  const session = {
    sessionManager: { getSessionId: () => "session-1" },
    client: {
      send: async (_method, params) => ({
        result: {
          value: runInNewContext(params.expression, {
            document: {
              querySelectorAll: (selector) => nodes.filter((node) =>
                selector.split(",").some((part) => node.matches(part))
              )
            },
            location: { href: url },
            HTMLElement: FakeHTMLElement,
            getComputedStyle: () => ({
              display: "block",
              visibility: "visible",
              opacity: "1"
            })
          })
        }
      })
    }
  };

  const evidence = await collectPageEvidence(session, "target-1");

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].selector, "#order-details");
  assert.equal(evidence[0].text, "Banana Milk details");
});

test("collectPageEvidence stops layout checks after collecting the evidence limit", async () => {
  const url = "http://127.0.0.1:59999/shop";
  const nodes = [
    ...Array.from({ length: 24 }, (_, index) =>
      new FakeElement("div", { id: `detail-${index}`, text: `Detail ${index}` })
    ),
    new FakeElement("div", { id: "detail-overflow", text: "Overflow detail", throwOnLayout: true })
  ];
  const session = {
    sessionManager: { getSessionId: () => "session-1" },
    client: {
      send: async (_method, params) => ({
        result: {
          value: runInNewContext(params.expression, {
            document: {
              querySelectorAll: (selector) => nodes.filter((node) =>
                selector.split(",").some((part) => node.matches(part))
              )
            },
            location: { href: url },
            HTMLElement: FakeHTMLElement,
            getComputedStyle: (node) => {
              if (node.throwOnLayout) {
                throw new Error("layout should not be read after collecting enough evidence");
              }
              return {
                display: "block",
                visibility: "visible",
                opacity: "1"
              };
            }
          })
        }
      })
    }
  };

  const evidence = await collectPageEvidence(session, "target-1");

  assert.equal(evidence.length, 24);
  assert.equal(evidence[0].selector, "#detail-0");
  assert.equal(evidence[23].selector, "#detail-23");
  assert.equal(evidence.some((entry) => entry.selector === "#detail-overflow"), false);
});
