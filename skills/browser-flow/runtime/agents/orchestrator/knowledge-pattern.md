# Orchestrator Knowledge Pattern

## Strategy: Strategy B + prediction-error + meta

(Semantic accumulation with prediction-error trigger plus an
orchestrator-only meta layer; canonical label per
`confirmed/memory/knowledge-update-strategies.md`.)

### Semantic Store

`knowledge/registry/workflows.json` — catalog of verified workflows, keyed by fixture type and target URL. Updated after each successful verify phase via `node scripts/registry/workflow-registry.mjs`.

Use this before dispatching capture to check if an existing verified workflow satisfies the user's goal.

### Prediction-Error Tracking

Log cases where fixture recommendation was wrong (user corrected the fixture choice). Track which target URLs are reliably local vs. which trigger local-only rejections. Accumulate in `knowledge/registry/workflows.json` under a `prediction_errors` key.

### Meta

Track which pipeline phases produce the most failures. If verifier failures cluster around specific fixture types, surface that pattern in recommendations.

### Episodic Boundary

Run evidence lives in `artifacts/runs/<run-id>/` — gitignored, ephemeral. Only verified workflow summaries graduate to `knowledge/`.
