// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { exploreCommand } from "../../scripts/commands/explore.mjs";
import { COMMAND_REGISTRY } from "../../scripts/lib/cli-registry.mjs";
import { buildCommandSchema, renderTopLevelHelp } from "../../scripts/lib/cli-metadata.mjs";
import { getRepoRoot } from "../../scripts/lib/config.mjs";

test("exploreCommand throws when --fixture is missing", () => {
  assert.throws(
    () => exploreCommand({}),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /--fixture/);
      return true;
    }
  );
});

test("command registry registers the explore command", () => {
  assert.equal(COMMAND_REGISTRY.has("explore"), true);
  assert.equal(buildCommandSchema("explore")?.command.name, "explore");
});

test("top-level help mentions explore", () => {
  assert.match(renderTopLevelHelp(getRepoRoot()), /explore/);
});
