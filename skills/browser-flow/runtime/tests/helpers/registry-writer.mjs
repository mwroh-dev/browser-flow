import { setTimeout as delay } from "node:timers/promises";
import { upsertRegistryEntry } from "../../scripts/registry/workflow-registry.mjs";

const [id, status, waitMs] = process.argv.slice(2);
if (!id || !status) {
  throw new Error("registry-writer requires id and status.");
}

if (waitMs) {
  await delay(Number(waitMs));
}

upsertRegistryEntry({
  id,
  fixture: "synthetic",
  runId: id,
  status
});
