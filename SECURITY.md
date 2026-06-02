# Security and Responsible Use

Browser Flow is designed as a local-first workflow compiler. It can operate on
real websites when the user explicitly chooses that mode, but its default design
tries to keep sensitive material out of durable workflow artifacts.

## Intended Security Posture

Browser Flow is intentionally constrained:

- raw cookies, passwords, session tokens, CSRF values, and auth headers should
  not be written to workflow artifacts
- real-site capture is explicit, not the default silent behavior
- replay verification uses a separate browser profile from capture
- screenshots and DOM snapshots are local artifacts and should not be published
- promotion of external workflows is gated by verification and security checks

These constraints are part of the product design. They may make some convenient
automation flows harder, but that tradeoff is intentional.

## User-Directed Automation

Browser Flow is not meant to bypass access controls, anti-automation systems, or
site policy. It is meant to help users turn browser work they are allowed to do
into reusable local workflows.

Because Browser Flow is user-directed, a user may explicitly choose modes that
interact with real sites, authenticated sessions, or visible page data. Treat
those choices carefully. Only capture what is necessary, keep artifacts local,
and avoid sharing run outputs that may include page text, screenshots, DOM
snapshots, account identifiers, or business data.

## Do Not Publish Sensitive Artifacts

Before opening issues, sharing logs, or publishing examples, remove:

- `artifacts/` run directories
- screenshots
- DOM snapshots
- captured page text
- account identifiers
- URLs containing private query parameters
- any file that may contain credentials or session material

When in doubt, reproduce with a synthetic fixture instead of a real account.
