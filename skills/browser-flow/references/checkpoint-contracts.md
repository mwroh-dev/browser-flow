# Checkpoint Contracts

Checkpoints are the only user-facing stops in the browser-flow pipeline.
The orchestrator owns when to stop, what the user must know, and where the
pipeline resumes. Runtime commands own machine-readable review artifacts.

## Contract Table

| Checkpoint | Trigger | Result | Review Command | Accepted Verdicts | Resume |
| --- | --- | --- | --- | --- | --- |
| `awaiting_capture` | `prepare` opened a visible manual capture session | none | none | user says capture is done | `done --run-id <id>` |
| `capture_noise_review` | `analysis/capture-noise-preview.json` has `status:"needs_review"` without a resolving result | `analysis/capture-noise-result.json` | `review-noise --run-id <id>` then `review-noise --run-id <id> --apply <capture-noise-result.json>` | `keep`, `exclude` | analyze |
| `locator_intent_review` | `analysis/locator-intent-preview.json` has `status:"needs_review"` without a resolving result | `analysis/locator-intent-result.json` | `review-locator-intent --run-id <id>` then `review-locator-intent --run-id <id> --apply <locator-intent-result.json>` | `confirm` | analyze |
| `route_intent_review` | `analysis/route-intent-preview.json` has `status:"needs_review"` without a resolving result | `analysis/route-intent-result.json` | `review-route-intent --run-id <id>` then `review-route-intent --run-id <id> --apply <route-intent-result.json>` | `confirm-state-route`, `keep-dom-route` | generate or verify |
| `not_verified_hold` | replay is not green/promotable, or diagnostic replay succeeds while promotion/security gates are not green | `reports/verification.json`, `reports/security.json` | none | user direction | user-selected recovery |

## Briefing Rules

- Every checkpoint briefing states why the pipeline stopped, what the user must
  do, and what continues after the user responds.
- Do not stop for tool invocations, file writes, or intermediate CLI output.
- `capture_noise_review` briefs the captured intent journey before raw event
  ranges. It distinguishes navigation, new-tab navigation, state changes,
  observation clicks, and implementation noise. Risky keeps require an explicit
  canonical-vs-strict replay choice.
- `locator_intent_review` lists each candidate's action text, semantic
  section/card/heading summary, href, same-name counts, and replay permission
  level before asking for confirmation.
- `route_intent_review` lists omitted DOM steps, provider pattern when present,
  target state URL, proofs, and risks before asking for a route verdict.
- Do not ask compressed all-candidate questions such as `confirm all?` or
  `cn1~cn8 all exclude?` unless the full candidate list has already been shown
  in the current exchange.
- `not_verified_hold` surfaces `verificationOutcome`, `reasonCategory`, and
  `blockingGate` without framing dynamic content drift as user failure.
