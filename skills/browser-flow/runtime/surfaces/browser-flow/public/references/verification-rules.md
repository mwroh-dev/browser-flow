# Verification Rules

Replay is green only when all of the following pass:

1. Action path executed.
2. Expected transition passed.
3. Expected result evidence passed.
4. Security scan passed.
5. Replay used a fresh profile.

Replay must fail closed for:

- wrong network transition
- wrong result evidence
- wrong action target
- wrong form / wrong field
- stale profile state
- missing or wrong replay secret
- injected forbidden artifact
