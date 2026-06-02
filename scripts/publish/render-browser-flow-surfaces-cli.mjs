#!/usr/bin/env node

import { main } from "./render-browser-flow-surfaces.mjs";

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
