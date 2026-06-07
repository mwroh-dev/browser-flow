# Browser Flow

Scope: public browser-flow runtime and agent contract boundary.

Only `browser-flow` is a public entry surface.
Internal playbooks are agent-owned and are not top-level model entry surfaces.

The release CLI is an agent-facing contract surface. Keep command metadata,
schema output, completion output, and typed errors stable unless the public
contract is intentionally versioned.
