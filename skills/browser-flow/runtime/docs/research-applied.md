# Research Applied — external work that shaped browser-flow

Scope: the **external** theory, algorithms, tools, and papers consulted while building
browser-flow, what each one told us, what we changed because of it, and what we learned
(including where it made us *change direction*). This is the citable companion to
`docs/patterns-applied.md` (which maps the *internal* confirmed patterns) and
`tasks/lessons.md` (per-finding execution learnings).

Format: **Source → What it says / what we found → What we changed (phase · commit) → Learning / direction.**

---

## 1. CDP-direct architecture

**Source:** [browser-use](https://github.com/browser-use/browser-use) (thin CDP client + auto-attach + per-concern watchdogs); [Chrome DevTools Protocol — Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/).

- **Found:** A Playwright runtime hides 9 forward-axis capabilities (auto-attach, raw network, lifecycle events, proxy auth, ARIA tree, cross-origin, click ladder, download, PDF). `Target.setAutoAttach({autoAttach, flatten})` is the idiomatic way to manage multi-target sessions directly.
- **Changed:** Phase 64–72 **CDP-direct migration** — replaced Playwright runtime with a thin CDP client + `SessionManager` (`Target.setAutoAttach(flatten)`) + single-responsibility watchdogs; the generated `runner.mjs` now imports only our CDP layer (no Playwright runtime). Plan: `docs/superpowers/plans/2026-05-20-cdp-direct-migration.md`.
- **Learning:** Owning the protocol layer (vs a framework) is what later made multi-tab nearly free — every action already took a `targetId` parameter (see §3).

## 2. Element-locator robustness — Similo / VON-Similo

**Source:** Similo (Nass et al., *arXiv:2208.00677*) and VON-Similo (*arXiv:2505.16424*) — weighted multi-signal element similarity for resilient web test locators.

- **Found:** Locating an element is a *scoring* problem, not a find-first problem. Weight many signals (tag, accessible name, visible/neighbor text, id, …), score every candidate, pick the best, and **fail when no candidate clears a threshold**. Stable signals weigh more than volatile ones.
- **Changed:** **Phase 91 (P2)** rewrote `resolveLocator` from ordered first-match rungs to a **coverage-aware weighted scorer** (`scripts/lib/resolver-score.mjs`) — Similo-seeded weights (stable 1.5 / medium 1.0 / weak 0.5), score-best, and a confidence gate that drift-holds when not confident. **Phase 92 (P3)** added per-element weight tuning (`patterns.json` + scoring-agent).
- **Learning / direction:**
  - Confidence = **high-weight mass + margin** ("top-p"), not max ("top-k"). (lesson 2026-05-21)
  - VON-Similo's single fixed threshold (0.4) → our *coverage-aware* gate (floor 0.6 + margin 0.12 + stable-mass 0.55).
  - **URLs are not general strings** — Levenshtein over-credits shared prefixes; href needs path-aware similarity. (commit `e06f71a`)
  - Agent-blind interaction: a **redacted signal must be treated as absent**, not scored against the live value. (commit `bf1c768`)

## 3. Multi-tab / popups — CDP targets, opener linking, auto-switch

**Source:** [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/1-3/Target) (`setAutoAttach`, `targetCreated`, `TargetInfo.openerId`); [Puppeteer popup/opener](https://github.com/puppeteer/puppeteer/issues/3667); [BugBug — pop-up window recording](https://bugbug.io/blog/product/pop-up-window-recording/) (auto-shift test context to the new tab).

- **Found:** `setAutoAttach + targetCreated` is the standard popup/new-tab capture mechanism (Puppeteer/chromedp/PyCDP). `TargetInfo.openerId` links a popup to the page that opened it. Modern recorders (BugBug) **auto-switch context to the new tab** rather than requiring manual window-handle juggling (the older Selenium model).
- **Changed:** **Phase 94/95 multi-tab v1** — capture tags each event with a creation-order `tabOrdinal`; the runner keeps `ordinalToTargetId` and switches the active target per step, waiting for the new target the first time; `openerId` is preserved for future causal disambiguation. Spec: `docs/superpowers/specs/2026-05-22-multitab-replay-design.md`.
- **Learning / direction:** tab identity = **creation-order ordinal** (targetId is per-run; OAuth callback URLs carry nonces so URL-matching is unfit). `openerId` = a stronger **causal** binding to switch on only when ad-order noise demands it (deferred, YAGNI).

## 4. Record-replay determinism theory (validates the "events + time" model)

**Source:** [Mugshot (Mickens et al., NSDI 2010)](https://www.usenix.org/legacy/event/nsdi10/tech/full_papers/mickens-mugshot.pdf); [Timelapse / Dolos (Burg & Ko, UIST 2013)](https://faculty.washington.edu/ajko/papers/Burg2013Timelapse.pdf); [Ringer / End-User Record & Replay (Barman, Berkeley EECS-2015-266)](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2015/EECS-2015-266.pdf); [WebCapsule (Neasbitt et al., CCS 2015)](https://www.longlu.org/publication/neasbitt-15/neasbitt-15.pdf).

- **Found:** Deterministic replay = **capture and re-feed every non-deterministic input** (event order + time + external sources such as the network). Core thesis: *"the same events in the same order produce the same execution."* Ringer's robustness comes from user-facing locators (like our signal-based locators).
- **Changed:** No code change — this **confirmed the design direction**: our `(ts, targetId, event)` time-series is exactly the literature's determinism axis, and tabs/popups are *target-tagged events*, not special cases.
- **Learning / direction:** Full determinism would require capturing *all* external inputs (including ad responses). We deliberately do **not** (agent-blind, runtime-LLM-free, lightweight). So ads are inherently non-deterministic for us → the only sound response is **fail-safe (drift-hold)**, not determinism. This is *why* the 80/20 split holds: the 20% (ad/popup noise) degrades to "couldn't verify" (honest), never "wrongly verified."

## 5. Baseline — Playwright codegen

**Source:** `npx playwright codegen` (the cheapest off-the-shelf alternative).

- **Found:** codegen + manual editing produces a runnable script for trivial flows cheaply.
- **Changed:** `docs/baseline-comparison.md` records the head-to-head.
- **Learning:** browser-flow's value over codegen is verification (truthful replay), self-cleaning, agent-blind sanitization, and resolver robustness — not raw script generation.

---

## Direction pivots driven by validation (not speculation)

The roadmap was steered by *empirical failures*, not guesses. Notable pivots (full detail in `tasks/lessons.md`):

| Symptom observed | Real root cause (pivot) | Commit |
|---|---|---|
| Wiki tab "scoring too low" | Not scoring — **candidate recall**: 200-cap dropped the target (idx 405 of 3629) | `4b590d4` |
| Wiki "transition timeout" | Not transition-gate — **page-settle** (huge async page non-deterministic at resolve time) | `7eaac53` |
| Reactive scoring routed heal cases | "ambiguous locator" string covers *both* present-but-mis-weighted and gone → split by **winner score** | `ca661f3` |
| Multi-tab replay blocked pre-switch | compile `expectUrl` pairing was **tab-unaware** (cross-tab about:blank leaked onto opener click) | `f60d3bf` |

Method (proven this project): **validate on real sites → let the failure pick the next work.** Speculative features waste effort; real-site validation surfaced every gap above.
