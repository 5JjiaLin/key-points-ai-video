import assert from "node:assert/strict";
import test from "node:test";
import type { SkillExecutionResult, SkillRunInput } from "../domain.js";
import { adaptSkillOutput } from "../skills.js";

test("claim verification without independent sources is marked insufficient evidence", () => {
  const execution: SkillExecutionResult = {
    route: "claim_verification",
    skillId: "claim_verification",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      verification: { status: "verified", source_quality: "high", confidence: 0.99 },
      generated_content: { question: "这是真的吗？", short_answer: "是" },
      ranking: { intervention_value_score: 90, display_action: "auto_prompt" },
    },
  };
  const input = {
    runId: "run",
    snapshotId: "snapshot",
    video: { videoId: "video", title: "title", durationMs: 10000 },
    candidate: {
      id: "candidate",
      videoId: "video",
      sourceText: "某强断言",
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
        containsStrongClaim: true,
        containsCausalLanguage: false,
        containsVisualCue: false,
      },
    },
    routeDecision: {
      isCandidate: true,
      primaryRoute: "claim_verification",
      routeScores: { abstract_to_intuitive: 0, knowledge_gap: 0, claim_verification: 1, discard: 0 },
      confidence: 1,
      reason: "strong claim",
      evidence: [],
    },
  } satisfies SkillRunInput;

  const [candidate] = adaptSkillOutput(execution, input);
  assert.ok(candidate);
  assert.equal(candidate.content.answerLabel, "证据不足/待复核");
  assert.equal(candidate.decision.displayMode, "list_only");
  assert.equal((candidate.content.detail as { verification: { status: string } }).verification.status, "insufficient_evidence");
});
