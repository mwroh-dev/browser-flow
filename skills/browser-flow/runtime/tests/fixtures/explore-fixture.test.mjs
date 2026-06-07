import { test } from "node:test";
import assert from "node:assert/strict";
import { startFixtureServer } from "../../scripts/fixtures/site-server.mjs";

test("explore fixture — hub page contains expected affordances", async () => {
  const fixture = await startFixtureServer();
  try {
    const res = await fetch(`${fixture.baseUrl}/explore`);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('data-bf="to-a"'), 'hub must contain data-bf="to-a"');
    assert.ok(html.includes('data-bf="to-b"'), 'hub must contain data-bf="to-b"');
    assert.ok(html.includes('data-bf="cud-del"'), 'hub must contain data-bf="cud-del"');
    assert.ok(html.includes("Delete everything"), 'hub must contain text "Delete everything"');
    assert.ok(html.includes('data-bf="hub-input"'), 'hub must contain data-bf="hub-input"');
  } finally {
    await fixture.close();
  }
});

test("explore fixture — /explore/a contains to-ax link", async () => {
  const fixture = await startFixtureServer();
  try {
    const res = await fetch(`${fixture.baseUrl}/explore/a`);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('data-bf="to-ax"'), '/explore/a must contain data-bf="to-ax"');
  } finally {
    await fixture.close();
  }
});

test("explore fixture — /explore/a/x is a leaf (evidence present, no to- links)", async () => {
  const fixture = await startFixtureServer();
  try {
    const res = await fetch(`${fixture.baseUrl}/explore/a/x`);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes("explore-ax"), '/explore/a/x must contain evidence "explore-ax"');
    assert.ok(!html.includes('data-bf="to-'), '/explore/a/x must NOT contain any data-bf="to- link');
  } finally {
    await fixture.close();
  }
});

test("explore fixture — /explore/b contains back link to hub", async () => {
  const fixture = await startFixtureServer();
  try {
    const res = await fetch(`${fixture.baseUrl}/explore/b`);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('data-bf="back"'), '/explore/b must contain data-bf="back"');
  } finally {
    await fixture.close();
  }
});

test("explore fixture — cud-count starts at 0", async () => {
  const fixture = await startFixtureServer();
  try {
    const res = await fetch(`${fixture.baseUrl}/explore/cud-count`);
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.deepEqual(json, { clicks: 0 }, "initial cud-count must be 0");
  } finally {
    await fixture.close();
  }
});

test("explore fixture — POST /explore/cud increments counter", async () => {
  const fixture = await startFixtureServer();
  try {
    // Verify initial count
    const before = await fetch(`${fixture.baseUrl}/explore/cud-count`);
    const { clicks: before0 } = /** @type {{ clicks: number }} */ (await before.json());
    assert.equal(before0, 0, "counter must start at 0");

    // Trigger the CUD trap
    const postRes = await fetch(`${fixture.baseUrl}/explore/cud`, { method: "POST" });
    assert.equal(postRes.status, 200);

    // Verify counter incremented
    const after = await fetch(`${fixture.baseUrl}/explore/cud-count`);
    const { clicks: after1 } = /** @type {{ clicks: number }} */ (await after.json());
    assert.equal(after1, 1, "counter must be 1 after one POST");
  } finally {
    await fixture.close();
  }
});
