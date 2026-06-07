# Registry Contract

- Source of truth: `knowledge/registry/workflows.json`
- Entries are keyed by workflow `id`
- `status` is one of:
  - `generated`
  - `verified`
  - `failed`
- Reuse only entries with `status: verified`
- Registry writes are serialized through the repository lock path
