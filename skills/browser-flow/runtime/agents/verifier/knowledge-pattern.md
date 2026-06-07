# Verifier Agent Knowledge Pattern

## Strategy: Strategy B + prediction-error

(Semantic accumulation with prediction-error trigger; canonical label
per `confirmed/memory/knowledge-update-strategies.md`.)

### Semantic Store

Contributes to `knowledge/registry/workflows.json` via the orchestrator after a successful verify. The verifier's contribution: replay success/failure history per fixture type, stored under a `verification_history` key.

Track:
- fixture types with high first-pass success rates
- fixture types that consistently require re-capture before passing
- security gate trigger patterns (which fixture types are more likely to produce high-entropy tokens)

### Prediction-Error Tracking

Log when the runner fails on replay for a reason traceable to:
- timing (flaky selector wait)
- state divergence (stateful fixture requires fresh state)
- security gate false positive

Each prediction error feeds back to the generator's knowledge (selector strategy) or the capture agent's knowledge (state setup requirements).

### Episodic Boundary

Per-run reports (`verification.json`, `security.json`) live in `artifacts/runs/<run-id>/reports/` — gitignored. Only cross-run verification quality patterns graduate to `knowledge/`.
