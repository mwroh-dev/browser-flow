import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort } from "../../scripts/lib/net.mjs";
import { createBrowserSession } from "../../scripts/cdp/browser-session.mjs";
import { installLifecycleWatchdog } from "../../scripts/cdp/watchdogs/lifecycle.mjs";
import { locatorCaptureSource } from "../../scripts/observe/locator-capture.mjs";

// __bfComputedName must NOT use an editable element's innerText
// (user content) as its name. Content can be a typo or differ per session, so it
// is never identity. Stable names (aria-label/label/placeholder) and non-editable
// labels are preserved.
test("__bfComputedName is content-blind for contentEditable, preserves stable names", async () => {
  const html = "<!doctype html><meta charset=utf-8><body>" +
    "<div id=\"ce\" contenteditable=\"true\">ㅁ</div>" +                              // editable + content, no name
    "<div id=\"ce2\" contenteditable=\"true\" aria-label=\"제목\">typed title</div>" + // editable + aria-label
    "<button id=\"btn\">Submit</button>" +                                            // non-editable label
    "<div id=\"plain\">just text</div>" +                                             // non-editable text
    "</body>";
  const url = "data:text/html," + encodeURIComponent(html);

  const profileDir = mkdtempSync(join(tmpdir(), "cn-cb-"));
  const session = await createBrowserSession({ profileDir, debugPort: await getFreePort(), headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    await lc.navigateAndWait(target.targetId, url, { waitUntil: "load" });

    const expr = locatorCaptureSource + "; JSON.stringify({" +
      "ce: __bfComputedName(document.getElementById('ce'))," +
      "ce2: __bfComputedName(document.getElementById('ce2'))," +
      "btn: __bfComputedName(document.getElementById('btn'))," +
      "plain: __bfComputedName(document.getElementById('plain'))" +
      "})";
    const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
    const got = JSON.parse(r.result.value);

    assert.equal(got.ce, "", "editable element's content must NOT become its name");
    assert.equal(got.ce2, "제목", "editable element's aria-label is a stable name, preserved");
    assert.equal(got.btn, "Submit", "non-editable button label preserved");
    assert.equal(got.plain, "just text", "non-editable text preserved");
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("locator capture separates replay identity from skeleton projection for compound controls", async () => {
  const html = "<!doctype html><meta charset=utf-8><body>" +
    "<button id=\"carrier\" type=\"button\" aria-pressed=\"true\"><em>영상</em><strong>위성</strong></button>" +
    "<div role=\"menu\"><button id=\"option\" type=\"button\">강수예측</button></div>" +
    "</body>";
  const url = "data:text/html," + encodeURIComponent(html);

  const profileDir = mkdtempSync(join(tmpdir(), "projection-split-"));
  const session = await createBrowserSession({ profileDir, debugPort: await getFreePort(), headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    await lc.navigateAndWait(target.targetId, url, { waitUntil: "load" });

    const expr = locatorCaptureSource + "; JSON.stringify({" +
      "carrierReplay: __bfReplayIdentity(document.getElementById('carrier'))," +
      "carrierSkeleton: __bfSkeletonEntry(document.getElementById('carrier'))," +
      "optionReplay: __bfReplayIdentity(document.getElementById('option'))" +
      "})";
    const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
    const got = JSON.parse(r.result.value);

    assert.equal(got.carrierReplay.controlKind, "carrier");
    assert.deepEqual(got.carrierReplay.textParts, ["영상", "위성"]);
    assert.equal(got.carrierReplay.name, "영상 위성");
    assert.ok(got.carrierReplay.identityShape.includes("|button|"), got.carrierReplay.identityShape);
    assert.ok(!got.carrierReplay.identityShape.endsWith("|영상 위성"), got.carrierReplay.identityShape);

    assert.equal(got.carrierSkeleton.name, "영상 위성");
    assert.equal(got.carrierSkeleton.controlKind, "carrier");
    assert.equal(got.optionReplay.controlKind, "option");
    assert.deepEqual(got.optionReplay.textParts, ["강수예측"]);
    assert.equal(got.optionReplay.name, "강수예측");
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("locator capture keeps repeated nested label segments as carrier identity evidence", async () => {
  const html = "<!doctype html><meta charset=utf-8><body>" +
    "<button id=\"carrier\" type=\"button\"><span><em>영상</em><strong>영상</strong></span></button>" +
    "<button id=\"single\" type=\"button\"><span>영상</span></button>" +
    "</body>";
  const url = "data:text/html," + encodeURIComponent(html);

  const profileDir = mkdtempSync(join(tmpdir(), "projection-repeat-"));
  const session = await createBrowserSession({ profileDir, debugPort: await getFreePort(), headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    await lc.navigateAndWait(target.targetId, url, { waitUntil: "load" });

    const expr = locatorCaptureSource + "; JSON.stringify({" +
      "carrierReplay: __bfReplayIdentity(document.getElementById('carrier'))," +
      "carrierSkeleton: __bfSkeletonEntry(document.getElementById('carrier'))," +
      "singleReplay: __bfReplayIdentity(document.getElementById('single'))" +
      "})";
    const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
    const got = JSON.parse(r.result.value);

    assert.equal(got.carrierReplay.controlKind, "carrier");
    assert.deepEqual(got.carrierReplay.textParts, ["영상", "영상"]);
    assert.equal(got.carrierReplay.name, "영상 영상");
    assert.equal(got.carrierSkeleton.name, "영상");
    assert.equal(got.carrierSkeleton.controlKind, "carrier");
    assert.equal(got.singleReplay.controlKind, "option");
    assert.deepEqual(got.singleReplay.textParts, ["영상"]);
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("__bfAffordanceSkeleton keeps visible late-DOM controls on dense pages", async () => {
  const chromeLinks = Array.from({ length: 100 }, (_, i) => `<a href="#chrome-${i}">Chrome ${i}</a>`).join("");
  const html = "<!doctype html><meta charset=utf-8><body>" +
    `<nav>${chromeLinks}</nav>` +
    "<main><button id=\"late\" type=\"button\">Late Visible Control</button></main>" +
    "</body>";
  const url = "data:text/html," + encodeURIComponent(html);

  const profileDir = mkdtempSync(join(tmpdir(), "skeleton-late-"));
  const session = await createBrowserSession({ profileDir, debugPort: await getFreePort(), headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    await lc.navigateAndWait(target.targetId, url, { waitUntil: "load" });

    const expr = locatorCaptureSource + "; JSON.stringify(__bfAffordanceSkeleton())";
    const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
    const skeleton = JSON.parse(r.result.value);

    assert.ok(
      skeleton.some((entry) => entry.role === "button" && entry.name === "Late Visible Control"),
      `late visible button must survive dense DOM skeleton projection — got ${JSON.stringify(skeleton.slice(-10))}`
    );
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("__bfAffordanceSkeleton dedupe prefers visible interactable representatives", async () => {
  const html = "<!doctype html><meta charset=utf-8><body>" +
    "<button type=\"button\" class=\"same\" style=\"display:none\">Duplicate</button>" +
    "<button type=\"button\" class=\"same\">Duplicate</button>" +
    "</body>";
  const url = "data:text/html," + encodeURIComponent(html);

  const profileDir = mkdtempSync(join(tmpdir(), "skeleton-dedupe-"));
  const session = await createBrowserSession({ profileDir, debugPort: await getFreePort(), headless: true });
  const lc = await installLifecycleWatchdog(session);
  try {
    const [target] = session.sessionManager.listPageTargets();
    const sid = session.sessionManager.getSessionId(target.targetId);
    await lc.navigateAndWait(target.targetId, url, { waitUntil: "load" });

    const expr = locatorCaptureSource + "; JSON.stringify(__bfAffordanceSkeleton())";
    const r = /** @type {any} */ (await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true }, sid));
    const skeleton = JSON.parse(r.result.value);
    const duplicates = skeleton.filter((entry) => entry.role === "button" && entry.structuralKey.includes("|button|type=button|same|"));

    assert.equal(duplicates.length, 1, `duplicate structural key must dedupe once — got ${JSON.stringify(duplicates)}`);
    assert.equal(duplicates[0].name, "Duplicate");
  } finally {
    await lc.dispose();
    await session.dispose();
    await new Promise((resolve) => session.chromeProcess.once("exit", resolve));
    rmSync(profileDir, { recursive: true, force: true });
  }
});
