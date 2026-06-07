import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidates, decideConfidence, DEFAULT_WEIGHTS } from "../../scripts/lib/resolver-score.mjs";

test("semanticRegion is a stable-tier signal for repeated generic action names", () => {
  const target = {
    role: "link",
    name: "More",
    href: "/detail",
    semanticRegion: {
      role: "section",
      headingText: "Satellite imagery",
      label: "Satellite imagery",
      sameNameCountPage: 3,
      sameNameCountRegion: 1,
      targetPosition: { x: 0.92, y: 0.08 }
    }
  };
  const candidates = [
    {
      role: "link",
      name: "More",
      href: "/detail",
      semanticRegion: {
        role: "section",
        headingText: "Hourly forecast",
        label: "Hourly forecast",
        sameNameCountPage: 3,
        sameNameCountRegion: 1,
        targetPosition: { x: 0.91, y: 0.07 }
      }
    },
    {
      role: "link",
      name: "More",
      href: "/detail",
      semanticRegion: {
        role: "section",
        headingText: "Satellite imagery",
        label: "Satellite imagery",
        sameNameCountPage: 3,
        sameNameCountRegion: 1,
        targetPosition: { x: 0.93, y: 0.08 }
      }
    },
    {
      role: "link",
      name: "More",
      href: "/detail",
      semanticRegion: {
        role: "section",
        headingText: "Air quality",
        label: "Air quality",
        sameNameCountPage: 3,
        sameNameCountRegion: 1,
        targetPosition: { x: 0.9, y: 0.08 }
      }
    }
  ];

  const scored = scoreCandidates(target, candidates, DEFAULT_WEIGHTS);
  const decision = decideConfidence(scored, { weights: DEFAULT_WEIGHTS });

  assert.equal(decision.pick, 1, `semantic region should select the Satellite candidate: ${JSON.stringify(decision)}`);
  assert.equal(decision.confidence, "high");
});
