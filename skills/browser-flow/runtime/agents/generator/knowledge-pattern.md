# Generator Agent Knowledge Pattern

## Strategy: Strategy B (N=3)

(Semantic accumulation with fixed N=3 batch trigger; canonical label
per `confirmed/memory/knowledge-update-strategies.md`.)

### Semantic Store

After 3 successful generations for the same fixture type, promote selector stability observations to `knowledge/registry/workflows.json` under a `generation_patterns` key:
- selector strategies that produced stable runners (CSS vs. ARIA vs. text)
- action types that required special CDP handling (atomic-fp strategy: role / ancestor-scope / selector-fallback)
- fixture types where headless vs. headed made a difference

### Prediction-Error Tracking

Log when the generated runner fails to replay in the verify phase due to a selector or timing issue traceable to generation choices. These prediction errors refine future generation strategy for the same fixture type.

### Episodic Boundary

Per-run `runner.mjs` lives in `artifacts/runs/<run-id>/` — gitignored. Only cross-run generation quality patterns graduate to `knowledge/`.
