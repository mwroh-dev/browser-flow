# Replay Permission Policy

The runtime, not the LLM, decides which captured actions are eligible for
which replay mode. Agents explain the decision and collect user intent; they
do not reinterpret raw DOM events as permission.

`providerContext` is the first-order construction-pattern hint for modern
CSR/SSR pages. When present, use it before reducing an event to capture noise:
layered controls and rendered data surfaces replay as proof-backed state
clicks, while observation events remain excluded from replay.

## Levels

- `deny`: irreversible, auth/session, unsafe form, or unsupported action.
  Do not replay; ask for recapture or a safer route.
- `strict-replay`: replay the captured DOM action exactly. Use only when the
  action has strong locator identity and no safer canonical or proof-backed
  route is required.
- `canonicalize`: replay a normalized version of the user's intent, not every
  raw event. Use for same-control toggle/reveal journeys such as
  `open -> close -> open`, where only the final settled reveal is needed.
- `confirmed-equivalence`: after `locator_intent_review`, a pure navigation
  link may click first and then navigate to the confirmed destination if the
  live locator is low-confidence. This is not locator loosening; it is a
  user-confirmed navigation substitute.
- `state-proof-replay`: replay same-page UI controls as clicks and verify the
  resulting selected/pressed/DOM/network state. Do not replace tab, switch,
  segmented-button, or map-layer controls with URL fallback.

## Classification Defaults

- Generic navigation affordances such as `More`, `Details`, `View more`,
  `자세히 보기`, `상세보기`, and `더보기` require semantic intent review when
  `semanticRegion` is missing. `href + neighborTexts` alone is not enough to
  promote them to `strict-replay`.
- Short but meaningful domain labels such as `지리` may remain on the scorer
  path when `href + neighborTexts` provide stable disambiguation.
- User answers are treated as intent input. A risky keep must be converted to
  a canonical replay plan unless the user explicitly chooses strict raw replay
  with risk acknowledgement.
- URL-state reduction is allowed only for pure navigation or action-free
  final-state URLs. Same-page controls remain `state-proof-replay`.
