# Browser Flow Public Entry

This is the single public entry workflow for browser-flow.
Top-level entrypoints may invoke only this flow.
Internal agent-owned playbooks are not public entry surfaces.
Runtime commands execute from `runtime/scripts/cli.mjs`.

# Browser Flow — LLM Instruction Set

Scope: model-facing skill entry. This file tells the LLM HOW to walk the
pipeline. Role identity (WHO the LLM is at each phase) lives in
`agents/{name}/AGENT.md` and is loaded as a projected view
at phase entry.

Use this skill when the user wants to capture a browser workflow,
verify a prior capture, or check existing verified workflows.

The internal CLI command structure stays behind this entry surface.

## Role Identity — Orchestrator

The LLM that enters this skill operates as the orchestrator agent. On
skill entry, load `agents/orchestrator/AGENT.md` and
`agents/orchestrator/openai.yaml` as the entry projected view.
The orchestrator does not execute pipeline CLI commands directly — at
each phase it adopts the corresponding phase agent's identity by
loading that phase's projected view (see "Pipeline — Phase Entry
Protocol" below).

## Interaction Posture

This skill works in four steps:

1. Intent classification: action replay vs DATA extraction vs both.
   Treat requests for top N items, current values, latest headlines,
   prices, rows, lists, collecting, reading, or checking values as DATA
   extraction intent even when navigation is required first.
2. Check `runtime/knowledge/registry/workflows.json` for
   existing verified workflows that may satisfy the goal.
3. Present one recommendation: which fixture to use, whether to reuse
   or re-capture.
4. Execute the pipeline, stopping only at meaningful checkpoints.

When the user asks for current/top/latest/list/table/value data, first
classify the request as DATA mode. In DATA mode, the navigational
workflow should stop on the page that contains the data, and Extract owns the current values. Do not encode captured titles, prices, or top-row text as fixed replay evidence unless the user explicitly asks
to reopen that exact item. If the request combines navigation with page
DATA, route to Extract after navigation lands on the page that contains
the requested values. For data-only requests, stop on the listing or
data page instead of continuing into a detail page or terminal action
that would discard the listing state. If the user asks to click a
dynamic item such as "the first result" or "the latest article",
preserve that as an ordinal list action, not only fixed-title click
replay.

Treat accidental or exploratory captured actions as editable capture
noise when the final browser state still satisfies the user's goal. The
analyzer may exclude/trim a backtracked suffix such as
`backtracked-trailing-action`; read `ignored-events.json` and explain
that the raw capture remains the audit trail while the replay path was
cleaned. If `analysis/capture-noise-preview.json` reports
`status:"needs_review"`, stop at `capture_noise_review` and run
`review-noise --run-id <id>`. Brief the full captured intent journey
first: show `journey.intentGroups[]` before raw candidate ranges, explain
the user's likely intent in natural language, then show the canonical
replay plan that the runtime would apply to the underlying events. Ask
whether to `keep` or `exclude` each group only after that intent-group
briefing. If the user chooses a risky keep for a prefix toggle,
href-bearing reveal control, or interrupted same-control sequence, do not
apply it as a raw verdict immediately; explain the drift risk, ask
whether to use canonical replay or strict raw replay, and require explicit
risk acknowledgement for strict replay. Use
`review-noise --run-id <id> --apply <capture-noise-result.json>` to
validate and persist decisions before analyze proceeds. Recapture is the
fallback only when no usable final state, snapshot, or repairable path
remains.

Layered or heavily styled pages can emit hidden, zero-box, untrusted, or
implementation-layer controls instead of the visible thing the user
perceived. Treat those as ambiguous capture noise too: the review
briefing must describe the overall intent journey, the internal target,
the visible hit summary, and the effect (`navigation`,
`new-tab-navigation`, `state-change`, `observation`, or
`implementation-noise`). Runtime may attach `providerContext` to describe
the frontend construction pattern (`document-navigation`, `spa-route-state`,
`layered-control-surface`, `rendered-data-surface`,
`implementation-proxy`, or `auto-observation`). Treat that as the primary
policy signal before treating a hidden/layered event as noise. Do not
frame these candidate groups as discard-only: if the internal/layered
event corresponds to a navigation
or state-changing control the user intentionally used (for example a
link, tab, switch, segmented control, or map layer), ask whether that
navigation/state change is part of the route and should be kept. Treat
the user's answer as intent input, not as a command to preserve every raw
DOM event. If the runtime sees a safer canonical replay plan, brief that
plan and ask for confirmation. Never ask an opaque all-exclude question
such as "cn1~cn8 전부 exclude?" unless the journey and every candidate's
effect have already been shown in the current exchange.
Analyzer output also includes `analysis/step-ledger.json`, the canonical
user-action ledger. It records each user action as a
`before -> action -> after -> postcondition` transaction. Review
checkpoints may annotate hidden, proxy, or observer events as evidence,
but must not delete a user action that the ledger marks as the
prerequisite for a later visible affordance. For layered control surfaces,
brief parent opener steps and child depth controls as one causal
transition, not as unrelated capture noise.
Content/data-area clicks can also be observational: the user may click a
large visible region only to read or confirm information, while the page
does not transition. Treat no-op container clicks as
`ambiguous-observation-click`; brief the user with the observed text
summary and ask whether that content-area click should be excluded from
replay.

Repeated generic actions such as "More", "Details", "자세히 보기", or
other same-name links/buttons must preserve visible semantic intent, not
only the clicked DOM node. Follow `references/replay-permission-policy.md`:
generic navigation affordances with missing semantic region are not
promoted to `strict-replay` just because `href + neighborTexts` exist,
while short domain labels may stay on the scorer path when those signals
are stable. If `analysis/locator-intent-preview.json` reports
`status:"needs_review"`, stop at `locator_intent_review`. Run
`review-locator-intent --run-id <id>` and show every candidate with its
action text, semantic section/card/heading summary, href, same-name
counts, and replay permission level before asking the user to `confirm`
or recapture. Do not ask a compressed question such as "confirm all?" or
"process cn1~cn7?" unless the full candidate list has already been shown
in the current exchange.

If `analysis/route-intent-preview.json` reports
`status:"needs_review"`, stop at `route_intent_review` before generate
or verify. Run `review-route-intent --run-id <id>` and show every
candidate briefing with omitted DOM steps, provider pattern when present,
target state URL, proofs, and risks
before asking for `confirm-state-route` or `keep-dom-route`. Do not ask
a compressed all-candidates question unless the full candidate list was
already shown in the current exchange.

Verification is proof-set based. `workflow.verification.proofs[]` may
contain `final-url`, `url-state`, `network`, `dom-evidence`, and
`action-transition` proofs, plus `state-control` proofs for same-page
controls whose result is UI state rather than navigation, and
`provider-transaction` proofs for step-ledger postconditions. `expectedNetwork`
remains an existing proof but is no longer mandatory. A workflow
that starts and ends on a final-state URL is valid when the final URL
carries explicit query/hash state, such as a selected mode parameter, or
when another proof such as DOM evidence or an action transition exists.
Do not reject URL-only final-state workflows just because no
click-triggered network request exists. Conversely, do not replace
same-page state controls with URL-state routes just because a URL/query
exists; replay the user action and verify selected/pressed/DOM/network
state. Screenshots remain user artifacts unless produced by replay
verification; a capture-time screenshot is never promoted to proof.

Replay permission is policy based. The analyzer assigns one of
`deny`, `strict-replay`, `canonicalize`, `confirmed-equivalence`, or
`state-proof-replay` from `references/replay-permission-policy.md`.
Agents explain that decision and collect user intent; they do not treat a
user's event number or keep/exclude wording as direct permission to
preserve every raw DOM event.

## Recommendation

A recommendation communicates:

- the interpreted goal
- the recommended fixture (`synthetic`, `docs`, `stateful`, `submit`,
  `secret`, or `manual`)
- why it is recommended over others
- whether an existing verified workflow can be reused instead of
  re-capturing

## Checkpoint

Stop only for:

- **awaiting_capture** — Chrome is open, user must perform the demo
  before continuing. This is a hard stop for human/manual capture.
- **capture_noise_review** — `capture-noise-preview.json` reported
  ambiguous prefix, hidden, zero-box, untrusted implementation-layer, or
  no-op observation-click noise that requires a user `keep` or `exclude`
  verdict before analyze may continue. Run `review-noise --run-id <id>`
  to brief the full captured intent journey first, show intent groups and
  canonical replay plans before raw event ranges, separate navigation,
  new-tab-navigation, and state-change actions from
  observation/implementation-noise candidates, ask whether each repeated
  same-control prefix, internal implementation-layer event/burst, or
  content-area observation click should be kept or excluded from replay,
  and challenge risky keeps with a canonical-vs-strict replay question
  before applying the user's verdict with
  `review-noise --run-id <id> --apply
  <capture-noise-result.json>`, then resume the pipeline.
- **locator_intent_review** — `locator-intent-preview.json` reported a
  repeated weak-name link/button whose replay identity depends on visible
  semantic context such as section/card/heading. Run
  `review-locator-intent --run-id <id>`, present every candidate with
  action text, region summary, href, and same-name counts, then ask the
  user to `confirm` each intended action or choose recapture. Persist
  confirmations with `review-locator-intent --run-id <id> --apply
  <locator-intent-result.json>` before analyze may continue.
- **route_intent_review** — `route-intent-preview.json` reported a
  reducible DOM path where an outcome-equivalent state route may be more
  stable than replaying every captured click. Run
  `review-route-intent --run-id <id>`, present every candidate briefing with
  omitted DOM steps, target state URL, proofs, and risks, then ask the
  user to choose `confirm-state-route` or `keep-dom-route`. Persist the
  decision with `review-route-intent --run-id <id> --apply
  <route-intent-result.json>` before generate or verify may continue.
- **not_verified_hold** — replay did not produce a green/promotable
  artifact, or replay succeeded diagnostically but a promotion/security
  gate is not green; present `verificationOutcome`, `reasonCategory`,
  and `blockingGate` without framing it as user failure, then ask how to
  proceed

A checkpoint communicates:
- why the pipeline stopped
- what the user must do
- what will continue after the user responds

Do not stop for tool invocations, file writes, or intermediate CLI
output.

## Pipeline — Phase Entry Protocol

Each phase entry has the same three-step shape:

1. Load the **projected view** for that phase (the agent identity files
   plus the phase-specific reference). Do not load other agents'
   identities or other phases' references at this point.
2. Adopt the phase **agent identity** with an explicit self-
   identification statement.
3. Execute the **callable tool** for that phase from
   `runtime/scripts/cli.mjs`.

The phases run strictly in serial: each phase consumes the previous
phase's artifact. Manual capture opens a visible Chrome by default so a
human can perform the demo. Reserve `--headless` for automation-driven
capture, local fixtures, synthetic tests, or verify flows that are known
to render reliably in headless Chrome. For manual real-site external
visual/canvas or stateful-surface workflows, preserve capture/replay
browser parity and omit `--headless` during verify by default.

### Phase 1 — Capture

Projected view:
- `agents/capture/AGENT.md`
- `agents/capture/openai.yaml`
- `references/security-policy.md`
- `references/replay-permission-policy.md`

Self-identification: state explicitly that the agent identity for this
phase is `capture` before running the callable tool.

Callable tool:
```
node runtime/scripts/cli.mjs prepare --run-id <id> --fixture <fixture> [--start-url <url>] [--unmasked] [--snapshot-dom]
[await_capture checkpoint — user performs the demo]
node runtime/scripts/cli.mjs done --run-id <id>
node runtime/scripts/cli.mjs done --run-id <id> --capture-screenshot final   # when the user explicitly asked for a screenshot
[capture_noise_review checkpoint — only when captureDiagnostics.status === "needs_review"]
node runtime/scripts/cli.mjs review-noise --run-id <id>
node runtime/scripts/cli.mjs review-noise --run-id <id> --apply <capture-noise-result.json>
[locator_intent_review checkpoint — only when locatorDiagnostics.status === "needs_review"]
node runtime/scripts/cli.mjs review-locator-intent --run-id <id>
node runtime/scripts/cli.mjs review-locator-intent --run-id <id> --apply <locator-intent-result.json>
[route_intent_review checkpoint — only when routeDiagnostics.status === "needs_review"]
node runtime/scripts/cli.mjs review-route-intent --run-id <id>
node runtime/scripts/cli.mjs review-route-intent --run-id <id> --apply <route-intent-result.json>
```

For human/manual capture, omit `--headless` so the user sees the live
Chrome session. After `prepare`, stop at `awaiting_capture` and let the
user operate the visible Chrome session themselves. Do not use
computer-use, browser automation, CDP control, or agent-operated
browsing to click, type, scroll, or navigate the page during manual
capture unless the user explicitly asks for automation-driven capture
instead of a human demo. Use `--headless` only for automation-driven
capture flows that do not require an interactive human demo.

If the user explicitly asks for a screenshot, pass
`--capture-screenshot final` to `done`. This writes
`reports/screenshots/capture-final.png` with manifest metadata
`source:"capture"` and `verified:false`. Report it as the user's
capture-time screenshot artifact, not as replay proof; replay screenshots
from `verify --screenshots final|steps|both` remain the verification
evidence.

For real websites such as Keep, Notion, Naver, GitHub, or other remote
HTTPS targets, use `--fixture manual --start-url <url> --unmasked`.
`project-local` describes where the skill package and runtime are
installed; it does not restrict capture targets to localhost. Under
`--unmasked`, external URLs may be captured for real-site workflows, but
the verified workflow registry promotes only replay-verified public-read
flows automatically. Login/profile-dependent flows, screenshot/rich-
artifact retention, irreversible actions, or sensitive security findings
still require explicit operator promotion before reuse.

Browser Flow is project-local by installation/runtime footprint.
External cloud services are normal workflow targets when the user opts
into `--unmasked`. External workflows are replay-verified first and
saved to the registry automatically only when the runtime can infer
public-read policy: allowed origins from the workflow, `authMode:none`,
ephemeral profile, minimal privacy, screenshots off, and no login
preconditions or irreversible consent. Otherwise require explicit
operator approval with origin, auth/profile, privacy, screenshot, and
data-mode metadata.

For external workflows that are not public-read, ask before promotion:
whether to save for reuse, which origins are allowed, whether
login/profile persistence is acceptable, whether screenshots/richer
artifacts are allowed, and whether dynamic data should be captured
through Extract rather than fixed replay text. When the workflow uses
Extract, run the extraction phase after replay verification and report
`reports/data-result.json` as the user's data output; public-read
extraction updates the registry entry's data metadata automatically.

When the user says "do everything", "just save the login too", "다 해줘",
or otherwise asks for maximum convenience, do not persist raw cookies,
passwords, tokens, or session values into files. Offer the supported
secure convenience modes instead:

- `attached-browser`: use a browser the user already logged into; do not
  capture cookies.
- `keychain-session`: bootstrap login once, store the session in the OS
  keychain under a `sessionRef`, and inject it at replay time.
- `persistent-profile`: bind the workflow to a named Chrome profile
  directory.

If the user explicitly asks to write raw cookies, passwords, tokens, or
session values into `artifacts/`, `knowledge/`, the registry, or any
other file artifact, refuse that storage target and map the workflow to
`attached-browser`, `keychain-session`, or `persistent-profile`.
Refuse raw cookies in file artifacts even when the user asks for a
fully automatic or "just do everything" workflow.

### Phase 2 — Analyze

Projected view:
- `agents/analyzer/AGENT.md`
- `agents/analyzer/openai.yaml`
- `references/replay-permission-policy.md`

Self-identification: state explicitly that the agent identity for this
phase is `analyzer` before running the callable tool.

Callable tool:
```
node runtime/scripts/cli.mjs analyze --run-id <id>
```

Before `analyze`, read `analysis/capture-noise-preview.json`. If it
shows `status:"needs_review"` and there is no matching
`analysis/capture-noise-result.json` that resolves every candidate,
stop at `capture_noise_review` instead of running analyze. The review
unit is the candidate group, not individual raw events. Accepted
verdicts are `keep` and `exclude`; `recapture` remains a skill-level
branch, not an artifact verdict. Use `review-noise --run-id <id>` to
render the candidate briefing before asking the user, and use
`review-noise --run-id <id> --apply <capture-noise-result.json>` to
persist the verdicts. After analyze, inspect `analysis/step-ledger.json`
when a route contains layered or implementation-proxy controls; if a
candidate was kept because it reveals the next action, explain it as a
causal parent step rather than as raw-event preservation.

Also read `analysis/locator-intent-preview.json`. If it shows
`status:"needs_review"` and there is no matching
`analysis/locator-intent-result.json` that resolves every candidate,
stop at `locator_intent_review` instead of running analyze. The accepted
verdict is `confirm`; `recapture` remains a skill-level branch that ends
the current run. Use `review-locator-intent --run-id <id>` to render the
complete candidate briefing before asking the user, and use
`review-locator-intent --run-id <id> --apply <locator-intent-result.json>`
to persist confirmations. Never brief this checkpoint as an opaque range
without listing the action text, semantic region, href, and same-name
counts for each candidate.

Then read `analysis/route-intent-preview.json`. If it shows
`status:"needs_review"` and there is no matching
`analysis/route-intent-result.json` that resolves every candidate, stop
at `route_intent_review` before generate or verify. The accepted
verdicts are `confirm-state-route` and `keep-dom-route`. Use
`review-route-intent --run-id <id>` to render the complete candidate
briefing before asking the user, and use
`review-route-intent --run-id <id> --apply <route-intent-result.json>`
to persist decisions. Never brief this checkpoint as an opaque range
without listing omitted DOM steps, target state URL, proofs, and risks
for each candidate.

### Phase 3 — Generate

Projected view:
- `agents/generator/AGENT.md`
- `agents/generator/openai.yaml`
- `references/artifact-schemas.md`
- `references/replay-permission-policy.md`

Self-identification: state explicitly that the agent identity for this
phase is `generator` before running the callable tool.

Callable tool:
```
node runtime/scripts/cli.mjs generate --run-id <id>
```

### Phase 4 — Verify

Projected view:
- `agents/verifier/AGENT.md`
- `agents/verifier/openai.yaml`
- `references/verification-rules.md`
- `references/replay-permission-policy.md`

Self-identification: state explicitly that the agent identity for this
phase is `verifier` before running the callable tool.

Callable tool:
```
node runtime/scripts/cli.mjs verify --run-id <id> [--headless]
```

For local fixtures, synthetic/e2e tests, and known headless-stable
automation flows, pass `--headless` so replay can run unattended in an
isolated automation browser. For manual real-site external workflows
whose final state depends on a visual/canvas/map/video/stateful rendered
surface, omit `--headless` by default so replay uses the same visible
browser class as capture. If headless verify fails but headed verify
passes, report that as an environment parity finding; do not claim
headless success.

When `verificationOutcome` is `not_verified`, render the structured
verification fields instead of collapsing the result into "workflow
failed". Reserve "workflow failed" for actual runner or system errors.
If the structured result shows `dynamic_content_drift` with
`action_path`, explain that replay could not be promoted as verified
because live dynamic content differed at the guarded step. That is not a claim that the user's action was wrong, and not a claim that the requested data was wrong; it is a truthful not-verified hold.
If `diagnosticMode:true`, `success:true`, and `reasonCategory` is
`security_not_clean`, say the diagnostic replay succeeded and the route
was reproduced, but the artifact is not registry-promoted because
warning-only security findings keep the green verification claim closed.
This is not a replay failure.

### Phase 5 — Extract (OPTIONAL — only when the flow must return page DATA)

Skip this phase unless the user's goal is to pull structured DATA off a page
(e.g. "scrape the search results"). It runs AFTER verify. The orchestrator drives
it directly (no separate phase-agent identity); it dispatches the scraping
sub-agents via the Task tool.

Run Extract for page DATA requests such as top N items, current values,
latest headlines, prices, rows, or list collection. When a request is
data-only, the capture flow should stop on the listing or data page so
the snapshot matches the page being read. When the action path includes
an ordinal list action ("first card", "latest post", "third row"), keep
that ordinal intent intact instead of rewriting it as only fixed-title
click replay.

For current/top/latest/list/table/value data, prepare an Extract schema
proposal before dispatching the scraping agent. If the user wants top N
rows or current values, stop on the listing/data page and extract those
rows or values instead of replaying fixed historical page text.

Contracts (read before dispatching):
- `skills/scraping-agent/SKILL.md` — establishes the extractor config
- `skills/extract-heal-agent/SKILL.md` — repairs a drifted config

Prerequisite: the capture must have used `--snapshot-dom`, else there
are no `.html.gz` snapshots to extract from.

Procedure:
```
# 1. setup (LLM once) — emit the request, dispatch the agent, apply its verdict
node runtime/scripts/cli.mjs extract --run-id <id> --step <n> --schema <targetSchema.json>
  → dispatch scraping-agent (Task tool): reads scrape-request.json + the gunzipped
    snapshot, writes scrape-result.json. The dispatched agent IS the model step —
    no `claude -p` / `codex` / external API.
node runtime/scripts/cli.mjs extract --run-id <id> --apply artifacts/runs/<id>/scrape-result.json
  → validates, runs the config vs the snapshot, persists knowledge/scraping/<pageKey>/,
    writes extract-result.json { status: data|confident-zero|drift, rows[] }

# 2. reuse (zero tokens, no LLM) — later runs on the same page
node runtime/scripts/cli.mjs extract --run-id <id> --step <n> --reuse [--paged]

# 3. self-repair — when status is "drift"
#    bf extract emits extract-heal-request.json → dispatch extract-heal-agent →
node runtime/scripts/cli.mjs extract-heal --run-id <id> --apply artifacts/runs/<id>/extract-heal-result.json
#    healed → durable config force-updated + re-verified; unrepairable → tell the user.
```

The main model consumes `extract-result.json` `rows[]`. Report `confident-zero`
(page genuinely empty) and `drift`/`unrepairable` (page changed) honestly — never
present an empty/stale result as valid data.

For unmasked real-site diagnostic captures, Extract may still read the
captured snapshot and report the data as extracted from the captured or
current page, but describe it as registry-promoted only when it met the
public-read auto-promotion criteria or explicit operator approval has
promoted the replay-verified artifact.

## Compose — v1 boundary

`bf compose --run-id <id> --request "<goal>"` builds a derived workflow from
one primary run. v1 is primary-run-only: it reuses the verified workflow from
that run first, and if a gap remains the orchestrator may use interactive live learning
to fill it before the derived workflow is finalized. Multi-run compose is deferred to a
later version, so do not imply or synthesize a workflow from multiple source runs in v1.

Compose stays within the same code-enforced safety gates as the rest of the
skill; the prompt describes the boundary, while runtime validation and gate
code keep policy enforcement out of prompt prose.

## Constitutional Invariants

1. The skill and runtime must stay project-local: installed under the
   target project's selected browser-flow install root, without
   copying runtime code into the host project root.
2. Default masked capture keeps the URL boundary local. Real-site
   capture is allowed only by explicit `--unmasked` opt-in; unmasked
   runs are auto-promoted only for replay-verified public-read flows
   with inferred minimal policy. Login/profile-dependent, screenshot-
   retaining, irreversible, or sensitive-finding flows stay unpromoted
   until explicit operator approval records allowed origins,
   auth/profile, privacy, screenshot, and data-mode policy.
3. Never declare success before both `verification.json` and
   `security.json` exist and are green.

## Internal Boundary

This skill is the public surface for the installed browser-flow package.

- `runtime/scripts/` commands are internal implementation — do
  not expose their structure to the user.
- `runtime/knowledge/registry/workflows.json` is the catalog of
  verified workflows — read it before recommending re-capture.
- `runtime/artifacts/` contains immutable run evidence — do not
  modify it.
- `agents/{name}/AGENT.md` files are loaded as projected views at
  phase entry, not exposed to the user as part of the public surface.

## Phase-Independent References

Load only when the relevant operation occurs (not phase-bound):

- `references/registry-contract.md` — when reading or updating
  `runtime/knowledge/registry/`
- `references/commit-protocol.md` — when the user asks to commit or
  share the result
