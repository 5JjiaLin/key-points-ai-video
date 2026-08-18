import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateWindow, RouteDecision } from "../domain.js";
import { DEFAULT_CONFIG } from "../config.js";
import { candidateEvidenceForRoute, enforceRouteDecision, selectSkillCandidateIds } from "../orchestrator.js";

function decision(score: number): RouteDecision {
  return {
    isCandidate: true,
    primaryRoute: "knowledge_gap",
    routeScores: { abstract_to_intuitive: 0, knowledge_gap: score, claim_verification: 0, discard: 0 },
    confidence: score,
    reason: "test",
    evidence: [],
  };
}

test("remote skill selection keeps every eligible candidate", () => {
  const candidates = [
    { id: "low", startMs: 0 },
    { id: "high", startMs: 1000 },
    { id: "medium", startMs: 2000 },
  ];
  const selected = selectSkillCandidateIds(
    candidates,
    new Map([
      ["low", decision(0.7)],
      ["high", decision(0.95)],
      ["medium", decision(0.8)],
    ]),
  );
  assert.deepEqual([...selected], ["low", "high", "medium"]);
});

test("route enforcement discards decisions below the configured minimum", () => {
  const result = enforceRouteDecision(decision(0.61), DEFAULT_CONFIG);
  assert.equal(result.isCandidate, false);
  assert.equal(result.primaryRoute, "discard");
  assert.equal(result.secondaryRoute, null);
});

test("route enforcement keeps only a sufficiently close secondary route", () => {
  const close: RouteDecision = {
    ...decision(0.8),
    secondaryRoute: "claim_verification",
    routeScores: {
      abstract_to_intuitive: 0,
      knowledge_gap: 0.8,
      claim_verification: 0.74,
      discard: 0,
    },
  };
  const distant: RouteDecision = {
    ...close,
    routeScores: { ...close.routeScores, claim_verification: 0.7 },
  };

  assert.equal(enforceRouteDecision(close, DEFAULT_CONFIG).secondaryRoute, "claim_verification");
  assert.equal(enforceRouteDecision(distant, DEFAULT_CONFIG).secondaryRoute, null);
});

test("route enforcement rejects an abstract route without numeric unit evidence", () => {
  const candidate: CandidateWindow = {
    id: "candidate",
    videoId: "video",
    sourceText: "这是一个很大的变化",
    startMs: 0,
    endMs: 1000,
    segmentIds: ["asr-1"],
    contextBefore: "",
    contextAfter: "",
    ocrText: [],
    visualContext: [],
    signals: {
      containsNumber: false,
      containsUnit: false,
      containsPotentialTerm: false,
      containsStrongClaim: false,
      containsCausalLanguage: false,
      containsVisualCue: false,
    },
  };
  const result = enforceRouteDecision({
    ...decision(0.9),
    primaryRoute: "abstract_to_intuitive",
    routeScores: { abstract_to_intuitive: 0.9, knowledge_gap: 0, claim_verification: 0, discard: 0 },
  }, DEFAULT_CONFIG, candidate);
  assert.equal(result.primaryRoute, "discard");
  assert.match(result.reason, /ASR 文案/);
});

test("non-abstract routes cannot receive OCR or keyframes", () => {
  const source = {
    id: "candidate",
    videoId: "video",
    sourceText: "胃肠功能紊乱",
    startMs: 0,
    endMs: 1000,
    segmentIds: ["semantic-1", "asr-1", "ocr-1"],
    contextBefore: "",
    contextAfter: "",
    ocrText: ["画面文字"],
    visualContext: [{ id: "frame-1", startMs: 0, endMs: 1000, description: "关键帧" }],
    signals: {
      containsNumber: false,
      containsUnit: false,
      containsPotentialTerm: true,
      containsStrongClaim: false,
      containsCausalLanguage: false,
      containsVisualCue: false,
    },
  } satisfies CandidateWindow;
  assert.equal(candidateEvidenceForRoute(source, "abstract_to_intuitive"), source);
  for (const route of ["knowledge_gap", "claim_verification"] as const) {
    const filtered = candidateEvidenceForRoute(source, route);
    assert.deepEqual(filtered.ocrText, []);
    assert.deepEqual(filtered.visualContext, []);
    assert.deepEqual(filtered.segmentIds, ["semantic-1", "asr-1"]);
  }
});
