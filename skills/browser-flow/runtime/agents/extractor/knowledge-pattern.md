# Extractor Agent Knowledge Pattern

Task 3 private owner boundary: extraction learning stays under extractor-owned knowledge patterns.

## Strategy: Strategy B (N=3)

(Semantic accumulation with fixed N=3 batch trigger; canonical label
per `confirmed/memory/knowledge-update-strategies.md`.)

### Semantic Store

After 3 successful extractor setups for the same page type, promote a
summary pattern to `knowledge/scraping/<pageKey>/` metadata or the workflow
registry. A pattern includes:
- page type and stable container signals
- field selector families that survived reuse
- golden cardinality expectations and common true-zero cases

### Prediction-Error Tracking

Log extractor drift when the golden cardinality or required sample fields
diverge from the durable oracle. Accumulate drift causes to refine selector
quality guidance in the extractor playbooks.

### Episodic Boundary

Per-run extraction requests, scrape results, and heal requests live in
`artifacts/runs/<run-id>/` - gitignored. Durable extractor configs and
goldens live in `knowledge/scraping/<pageKey>/`.
