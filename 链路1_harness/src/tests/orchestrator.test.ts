import assert from "node:assert/strict";
import test from "node:test";
import type { RouteDecision } from "../domain.js";
import { selectSkillCandidateIds } from "../orchestrator.js";

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

test("remote skill budget keeps the two strongest candidates per route", () => {
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
    2,
  );
  assert.deepEqual([...selected], ["high", "medium"]);
});
