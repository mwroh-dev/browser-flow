# Analyzer Agent Knowledge Pattern

## Strategy: Strategy B (N=3)

(Semantic accumulation with fixed N=3 batch trigger; canonical label
per `confirmed/memory/knowledge-update-strategies.md`.)

### Semantic Store

After 3 successful analyses of the same fixture type, promote a summary pattern to `knowledge/registry/workflows.json` under a `compilation_patterns` key. A pattern includes:
- typical event count range
- action types observed (click, navigate, input, submit)
- any anomalous event sequences that required special handling

### Prediction-Error Tracking

Log when `path.yaml` action count deviates more than 20% from the predicted range for that fixture type. Accumulate prediction errors to refine future range estimates.

### Episodic Boundary

Per-run analysis outputs (`path.yaml`, `recipe.yaml`) live in `artifacts/runs/<run-id>/` — gitignored. Only cross-run statistical patterns graduate to `knowledge/`.
