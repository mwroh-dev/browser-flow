# Testing

The suite is split into two lanes so that `npm run check` is **deterministic**.

| Lane | Command | Files | Determinism |
|------|---------|-------|-------------|
| **unit** (default) | `npm test` | 114 — no Chrome | deterministic; gates `npm run check` |
| **e2e** (Chrome) | `npm run test:e2e` | 29 — launch real headless Chrome | non-deterministic under load; run with retries, separately |
| both | `npm run test:all` | 143 | — |

`npm run check` runs `npm test` (the unit lane only). The Chrome lane is **not**
part of `check`.

## Why the split

The 29 e2e files launch a real headless Chrome (direct CDP via
`createBrowserSession`, the `demo-driver` capture harness, or CLI commands that
spawn Chrome). Under a loaded serial full-suite run they are **non-deterministic**:

1. **Resource leakage.** Chrome processes and their ephemeral `--user-data-dir`
   profiles are not always reaped (a test that fails/times out mid-capture
   orphans its Chrome). They accumulate across the serial run, so whichever
   Chrome test runs while the machine is under that cumulative pressure can hit a
   `waitForPort` timeout or a widened capture-timing window. The *specific* failing
   test therefore varies run-to-run; each one **passes on isolated re-run**.
2. **An architectural race** in `verify-breadth-enrichment`: the capture host
   observes `frameNavigated` and then asynchronously enumerates the page, but the
   driver may navigate away within that gap — so the mold can be enumerated on a
   blank page. This is not fixable by waiting longer (a longer wait widens the
   gap). The real fix is in-page self-capture, which is out of scope for the
   current hardening pass. See `tasks/lessons.md` (2026-05-24).

Because (2) cannot be made deterministic with a minimal patch, the e2e files are
**quarantined** out of `check` rather than chased. This keeps `check` a true
signal while preserving full Chrome coverage in the dedicated lane.

## How the lanes are defined

`scripts/test/e2e-suite.json` is the explicit list of Chrome test files.
`scripts/test/run-suite.mjs` runs `--suite=unit` (everything except that list),
`--suite=e2e` (the list, with `--retries=N`), or `--suite=all`. The runner
validates the list (errors on a stale entry) and mirrors the project's
`node:test` flags (`--import=./tests/_setup.mjs --test --test-concurrency=1
--test-timeout=120000 --test-force-exit`).

**Adding a test:** if it launches Chrome, add its path to `e2e-suite.json`.
Pure tests need no action — they join the unit lane automatically. If a Chrome
test is accidentally left out, the unit lane will flake; that is the signal to
add it.

## Known limitation

Orphaned Chrome processes / tmp profiles can accumulate on a dev machine across
e2e runs. The e2e lane uses `--retries=2` to absorb transient flakes; persistent
local cleanup (e.g. `pkill -f "user-data-dir=.*browser-flow"`) may be needed
after heavy e2e iteration. This is a known capture-lifecycle limitation, not a
correctness issue in the shipped runtime.
