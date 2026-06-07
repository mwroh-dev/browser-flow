import test from "node:test";
import assert from "node:assert/strict";

import { formatDependencyInstallError } from "../../scripts/cli.mjs";

test("formats dependency install failures with a permission hint for EACCES", () => {
  const message = formatDependencyInstallError(
    "/tmp/browser-flow",
    "npm ci failed with EACCES: permission denied"
  );

  assert.match(message, /Unable to prepare browser-flow runtime dependencies/);
  assert.match(message, /Permission hint:/);
  assert.match(message, /npm ci --omit=dev --ignore-scripts --no-audit --no-fund/);
});
