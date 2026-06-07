import test from "node:test";
import assert from "node:assert/strict";
import { isSignalPoor } from "../../scripts/lib/scope-gate.mjs";

// signal-poor = none of the DISTINGUISHING signals {name, neighborTexts(non-empty),
// cleanId, href} is present. Only volatile/positional signals (structuralKey/relXPath/box)
// remain → can't disambiguate identical look-alikes → scope-agent target.

test("isSignalPoor: empty-name presentation p with no anchor/id/href (Keep take-a-note) → true", () => {
  const locator = {
    role: "presentation",
    name: "",
    structuralKey: "div>div>div>div>div|p|role=presentation||",
    relXPath: "//div[2]/div[1]/div[5]/div[1]/div[1]/p",
    href: "",
    neighborTexts: [],
    cleanId: ""
  };
  assert.equal(isSignalPoor(locator), true);
});

test("isSignalPoor: button with a name → false (name is a distinguishing signal)", () => {
  assert.equal(isSignalPoor({ role: "button", name: "Save", structuralKey: "form>button" }), false);
});

test("isSignalPoor: nav link with href → false", () => {
  assert.equal(isSignalPoor({ role: "link", name: "", href: "/wiki/Talk:Korea", structuralKey: "nav>a" }), false);
});

test("isSignalPoor: empty name but non-empty neighborTexts → false (anchor already captured)", () => {
  assert.equal(isSignalPoor({ role: "presentation", name: "", neighborTexts: ["메모 작성…"], href: "", cleanId: "" }), false);
});

test("isSignalPoor: empty name but stable cleanId → false", () => {
  assert.equal(isSignalPoor({ role: "textbox", name: "", cleanId: "compose-input", neighborTexts: [], href: "" }), false);
});

test("isSignalPoor: redacted name/anchor is treated as ABSENT → true", () => {
  // a redaction sentinel carries no matchable info — must not count as a present signal.
  assert.equal(
    isSignalPoor({ role: "textbox", name: "<redacted-field>", neighborTexts: ["<redacted-secret>"], href: "", cleanId: "" }),
    true
  );
});

test("isSignalPoor: missing fields entirely (undefined) → true", () => {
  assert.equal(isSignalPoor({ role: "presentation", structuralKey: "div>p" }), true);
});

test("isSignalPoor: non-object / null → false (defensive, nothing to flag)", () => {
  assert.equal(isSignalPoor(null), false);
  assert.equal(isSignalPoor(undefined), false);
});
