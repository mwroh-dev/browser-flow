/**
 * Result artifact schema versions.
 *
 * Per `orchestrator-gated-context-distribution` (Known Limit: schema
 * versioning): every result artifact must carry a `schemaVersion` so
 * downstream consumers can detect silent schema drift. The orchestrator
 * synthesizes across phases — without a version each consumer would
 * have to infer the schema from field presence, which makes
 * misinterpretation indistinguishable from correct synthesis.
 *
 * Bump the version when the corresponding artifact's required-field
 * set or field semantics change. Additive fields do not require a bump.
 */
export const SCHEMA_VERSIONS = Object.freeze({
  workflow: 1,
  pathYaml: 1,
  recipeYaml: 1,
  verification: 1,
  security: 1,
  healResult: 1,
  scoringResult: 1,
  scopeResult: 1,
  revealResult: 1,
  captureNoisePreview: 1,
  captureNoiseResult: 1,
  locatorIntentPreview: 1,
  locatorIntentResult: 1,
  routeIntentPreview: 1,
  routeIntentResult: 1,
  extractorConfig: 1,
  scrapeResult: 1,
  dataResult: 1,
  extractHealResult: 1,
  composeDecision: 1,
  composeSummary: 1
});

/**
 * Reader-side accepted versions per artifact kind.
 *
 * Consumers MUST verify `schemaVersion` is in the accepted set before
 * reading any other field. Pattern source: microservice-api-patterns.org
 * "SemanticVersioning"; Pact spec writes/asserts
 * `metadata.pactSpecification.version` at the read site. Floor
 * implementation — does not validate field shapes (the Zod
 * discriminated union in schemas.mjs adds that).
 */
export const ACCEPTED_VERSIONS = Object.freeze({
  workflow: Object.freeze([1]),
  pathYaml: Object.freeze([1]),
  recipeYaml: Object.freeze([1]),
  verification: Object.freeze([1]),
  security: Object.freeze([1]),
  healResult: Object.freeze([1]),
  scoringResult: Object.freeze([1]),
  scopeResult: Object.freeze([1]),
  revealResult: Object.freeze([1]),
  captureNoisePreview: Object.freeze([1]),
  captureNoiseResult: Object.freeze([1]),
  locatorIntentPreview: Object.freeze([1]),
  locatorIntentResult: Object.freeze([1]),
  routeIntentPreview: Object.freeze([1]),
  routeIntentResult: Object.freeze([1]),
  extractorConfig: Object.freeze([1]),
  scrapeResult: Object.freeze([1]),
  dataResult: Object.freeze([1]),
  extractHealResult: Object.freeze([1]),
  composeDecision: Object.freeze([1]),
  composeSummary: Object.freeze([1])
});

/**
 * Throws if `artifact.schemaVersion` is missing or outside the
 * accepted set for the given kind. Returns the version on success.
 *
 * @param {unknown} artifact
 * @param {keyof SCHEMA_VERSIONS} kind
 * @param {string} [artifactPath]
 * @returns {number}
 */
export function assertSchemaVersion(artifact, kind, artifactPath = "<inline>") {
  const accepted = ACCEPTED_VERSIONS[kind];
  if (!accepted) {
    throw new Error(`Unknown artifact kind: ${kind}`);
  }
  const value = /** @type {{ schemaVersion?: unknown }} */ (artifact)?.schemaVersion;
  if (typeof value !== "number") {
    throw new Error(
      `${artifactPath}: missing schemaVersion (expected one of [${accepted.join(", ")}] for kind '${kind}')`
    );
  }
  if (!accepted.includes(value)) {
    throw new Error(
      `${artifactPath}: schemaVersion ${value} not in accepted set [${accepted.join(", ")}] for kind '${kind}'`
    );
  }
  return value;
}
