# Capture Agent Knowledge Pattern

## Strategy: Strategy B + prediction-error

(Semantic accumulation with prediction-error trigger; canonical label
per `confirmed/memory/knowledge-update-strategies.md`.)

### Semantic Store

Contributes to `knowledge/registry/workflows.json` indirectly — only the orchestrator writes to the registry after full pipeline success.

Tracks locally (episodic, in run artifacts) which fixture types produced clean event streams vs. noisy ones requiring sanitization.

### Prediction-Error Tracking

Log when `prepare` succeeds but `done` receives zero meaningful events (empty capture). Track which fixture types are prone to empty captures. Surface this to the orchestrator as a recommendation signal.

### Episodic Boundary

All capture output lives in `artifacts/runs/<run-id>/events/` — gitignored and ephemeral. Nothing from a single run graduates to `knowledge/` directly.
