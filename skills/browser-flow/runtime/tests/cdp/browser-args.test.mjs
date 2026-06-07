import test from "node:test";
import assert from "node:assert/strict";
import { buildChromeArgs } from "../../scripts/cdp/browser-session.mjs";

test("buildChromeArgs binds remote debugging to loopback", () => {
  const args = buildChromeArgs({ debugPort: 9222, profileDir: "/tmp/p" });
  assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(args.includes("--remote-debugging-port=9222"));
});

test("buildChromeArgs ignores caller attempts to rebind the address", () => {
  const args = buildChromeArgs({
    debugPort: 9222, profileDir: "/tmp/p",
    extraArgs: ["--remote-debugging-address=0.0.0.0", "--foo"]
  });
  assert.ok(!args.some((a) => a.includes("0.0.0.0")), "0.0.0.0 must be stripped");
  assert.equal(args.filter((a) => a.startsWith("--remote-debugging-address")).length, 1);
  assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(args.includes("--foo"), "unrelated extra args preserved");
});

test("buildChromeArgs prepends headless when requested", () => {
  const args = buildChromeArgs({ debugPort: 1, profileDir: "/tmp/p", headless: true });
  assert.equal(args[0], "--headless=new");
});

test("buildChromeArgs strips space-separated address override (flag + value)", () => {
  const args = buildChromeArgs({ debugPort: 9222, profileDir: "/tmp/p", extraArgs: ["--remote-debugging-address", "0.0.0.0", "--keep"] });
  assert.ok(!args.includes("0.0.0.0"));
  assert.equal(args.filter((a) => a.startsWith("--remote-debugging-address")).length, 1);
  assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(args.includes("--keep"));
});
