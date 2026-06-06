# Browser Flow History

This is a compact development history for the public release repository. It is
not a commit-by-commit changelog. Each entry summarizes a major arc in the
project: what problem surfaced, what changed, and what capability or release
posture improved as a result.

<!-- browser-flow-history:start -->
## Work Item: verification-quality-fixes - Verification quality fixes

- Status: resolved
- First recorded: 2026-06-06T15:58:33.060Z
- Last updated: 2026-06-06T19:18:12.876Z

### User Request
Fix installed CLI E2E verification-quality issues where generated CDP runtime IDs blocked security promotion and final DOM evidence could select weak static text or action-label text.

### Why It Mattered
Verification could replay correctly while final promotion was blocked by known generated CDP metadata being misclassified as secrets, or by DOM evidence that did not prove the goal-specific final state.

### Model Conclusion
The release should keep strict artifact scanning, classify only known CDP opaque runtime metadata as non-blocking audit findings, and prefer bounded final-state DOM evidence over generic headings, broad containers, or short action labels.

### Changes Made
Updated the released security scanner to inspect structured high-entropy values, preserve JavaScript literal scanning, narrowly classify known CDP frame/target IDs as non-blocking runtime metadata, and harden generated-source filtering. Updated page evidence collection and analyzer priority scoring to prefer semantic final-state regions, support common plural labels such as details/results/receipts/totals, filter invisible or non-semantic candidates, avoid unnecessary layout reads, and demote weak action-label evidence.

### Expected Resolution
Installed browser-flow CLI verification can promote valid replay runs without false blocking on known CDP runtime IDs, while final DOM evidence is anchored on meaningful final-state content such as detail, result, status, receipt, price, or total regions.

### Validation
Ran focused security scanner, page-evidence, analyzer, observe, and locator regression tests; ran lint and release audit; ran project-local install smoke; and verified the installed CLI E2E workflow with two consecutive verify passes.

### Publication Notes
This release sync contains the verification-quality fixes only. Review follow-up fixes are folded into the final release state rather than recorded as separate public history entries.


## Work Item: public-sync-state - Public sync state

- Status: resolved
- First recorded: 2026-06-04T13:02:54.085Z
- Last updated: 2026-06-04T13:02:54.085Z

### User Request
Mark the release folder as public and ensure release sync behaves correctly after publication.

### Why It Mattered
Once the release repository is public, bootstrap-amend must stop and append syncs must keep README latest metadata aligned without inventing changes when the source is already synced.

### Model Conclusion
The release state should be published=true, and append sync should return unchanged when the release already points at the current source commit.

### Changes Made
Marked the release state as public, added an unchanged public-sync path, and covered it with a sync-release regression test.

### Expected Resolution
Future public release syncs use append mode, require release notes for real source changes, and do not fail on no-op sync attempts.

### Validation
Ran sync-release tests, pii scan, no-provenance scan, skill validation, and release audit.

### Publication Notes
The release folder is now in public-state mode; bootstrap-amend is intentionally disabled after this point.

### Updates

#### 2026-06-04T13:02:54.085Z - 8d11927

- Source branch: main
- Source SHA: 8d11927
- Release SHA: pending-this-commit
- Bundle file count: 230
- Related source commits:
  - 8d11927 fix(release): allow unchanged public sync

##### User Request
Mark the release folder as public and ensure release sync behaves correctly after publication.

##### Why It Mattered
Once the release repository is public, bootstrap-amend must stop and append syncs must keep README latest metadata aligned without inventing changes when the source is already synced.

##### Model Conclusion
The release state should be published=true, and append sync should return unchanged when the release already points at the current source commit.

##### Changes Made
Marked the release state as public, added an unchanged public-sync path, and covered it with a sync-release regression test.

##### Expected Resolution
Future public release syncs use append mode, require release notes for real source changes, and do not fail on no-op sync attempts.

##### Validation
Ran sync-release tests, pii scan, no-provenance scan, skill validation, and release audit.

##### Publication Notes
The release folder is now in public-state mode; bootstrap-amend is intentionally disabled after this point.


## 2026-05-16 - Secure capture and truthful replay baseline

The first milestone focused on a simple but strict question: can Browser Flow
record a local browser demonstration safely, then later prove that the same
workflow actually replayed? The work established secure capture, replay
verification, registry consistency, and evidence-gated success reporting.

This baseline closed the first truthfulness and security gaps around submit
intent, transition correlation, stale state, secret-bearing inputs, short
secrets, header leaks, verifier fallback reports, and persisted security
findings. Browser Flow stopped being just a demonstration recorder and became a
local workflow compiler with fail-closed verification rules.

## 2026-05-18 to 2026-05-19 - Skill, agent, governance, and knowledge foundations

The next arc turned Browser Flow into one public skill surface backed by
separate internal roles: orchestrator, capture, analyzer, generator, and
verifier. The important boundary was that the skill describes the user-facing
procedure, while agents define the authority and responsibilities of each
workflow stage.

At the same time, the project gained governance gates, artifact schemas, trace
records, page-node knowledge, DOM snapshots, persistent profiles, and explicit
unmasked debug mode. This moved the system away from one-off execution and
toward a workflow engine that can learn from page structure and reuse that
knowledge in later runs.

## 2026-05-20 - CDP-direct runtime migration

The largest runtime shift replaced the Playwright-centered path with a
CDP-direct architecture. Browser Flow added Chrome/CRI client wrappers, session
management, recorder, network, lifecycle, and DOM watchdogs, CDP action
dispatch, generated CDP runners, verifier subprocess delegation, and a migrated
demo driver.

This was not a library swap. It changed Browser Flow's runtime identity. Replay
and verification moved closer to Chrome DevTools Protocol itself, giving the
project direct control over the capture, analysis, generation, and verification
loop.

## 2026-05-20 to 2026-05-22 - Real-site verification, auth, and locator intelligence

After the CDP-direct migration, the work turned toward real sites and the
failure modes they exposed. Authenticated replay required a human-in-loop
verification model: keychain-backed session state, first and repeat verify
modes, verifiable-spec questions, safety classification, consent, teardown, and
audit reporting.

Locator behavior also became more explicit. Scoring-agent patterns, per-element
weight overrides, candidate recall expansion, unsettled-page retry, and
click-plus-navigation confirmation were added after real wiki and Keep flows
showed where deterministic selector logic was not enough. The key lesson was
that a locator is not only a selector; it also needs a model-defined identity
region inside the page.

## 2026-05-23 to 2026-05-24 - Data extraction and scraping knowledge

Browser Flow then expanded from replaying actions to returning page data. The
optional extract stage reads captured DOM snapshots, derives an extractor
configuration, checks a golden oracle, and classifies results as data,
confident-zero, or drift.

This arc added `bf extract`, `--apply`, `--reuse`, paged extraction,
extract-heal, and durable `knowledge/scraping/<pageKey>/` storage. The design
kept page-structure knowledge separate from data-extraction knowledge, so a
model-derived scraper can be reused later without spending tokens again.

## 2026-05-24 to 2026-05-25 - Public release surface and security gates

The release work defined the public shipping boundary. Browser Flow added a
shipping allowlist, bundle builder, PII scanner, no-provenance gate, release
audit, and git-tracked-file shipping rule so local development artifacts would
not leak into the public package.

Security and verification also became more honest. Path containment,
page-key validation, scraping-key validation, localhost-only CDP binding,
bootstrap-versus-verified separation, diagnostic mode reporting, and the
`ok`/`securityOk` split made it clearer whether a run merely replayed, passed
security, or could be promoted.

## 2026-05-25 - Capture hardening and operator-facing reporting

The capture hardening pass made Browser Flow better at explaining what happened
and better at preserving the user's actual intent. Structured verification
outcomes, drift fields, compact summaries, stale journal recovery, runtime
dependency preflight checks, and cleanup-runner handling all improved the
operator experience.

The recorder also learned more about noisy browser behavior. Click gesture
provenance, same-gesture noise coalescing, ordinal list item preservation, and
dynamic extraction intent inference helped distinguish user intent from
incidental browser events.

## 2026-05-26 - External workflow promotion and compose

The next arc asked when a verified workflow should become reusable. Browser Flow
added explicit external workflow promotion, public-read external replay reuse,
safe login convenience guidance, and stricter registry policy for promotion.

That prepared the way for `bf compose`. Compose introduced command scaffolding,
reuse selection, checkpoint gates, episodic derived runs, live-learning hooks,
policy checks, generate and verify integration, and semantic slot resolution.
Browser Flow became a system for reusing and combining verified workflows, not
only capturing a single path.

## 2026-05-27 - Cross-runtime surfaces, reveal semantics, screenshots, and graph context

The public skill surface was then made reproducible across Codex and Claude.
Canonical rendering and adapter projection kept one public Browser Flow entry
while moving internal contracts behind agent-owned private playbooks.

At the same time, Browser Flow started representing more visual and stateful
surfaces. Reveal semantics, workflow graph edges, screenshot capture manifests,
screenshot verification modes, and surface context made expandable controls,
maps, visual pages, and other reveal-driven UI states part of replay evidence.

## 2026-05-28 to 2026-05-29 - Route intent and same-page state actions

This arc broke the assumption that every important click is just navigation.
Route intent review, route schemas, route planning, state-url route execution,
and route coverage separated pure navigation from route-like state changes.

The follow-up work added same-page state action classification, state control
proofs, state action review briefing, and journey-oriented capture review.
Browser Flow could now treat UI state changes as workflow steps even when the
URL did not change.

## 2026-06-01 to 2026-06-04 - Replay permission, step ledger, and stateful surface proof

The final arc in this period made replay more explicit about permission and
evidence. Replay permission policy was centralized, enforced in verification,
and combined with provider-context classification, step-ledger replay, trusted
layered actions, and two-lane action-window capture.

Stateful surface replay proofs then tightened how Browser Flow proves visual
and stateful real-site workflows. CSR locator readiness, headed verification
parity, provider-primer target checks, concrete reveal targets, duplicate
network proof handling, source-range metadata, and distribution-surface
documentation clarified both proof quality and public release posture.
<!-- browser-flow-history:end -->
