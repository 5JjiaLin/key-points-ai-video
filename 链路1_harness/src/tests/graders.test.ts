import test from "node:test";
import assert from "node:assert/strict";
import { gradeContent } from "../graders.js";
import type { UnifiedSupplementCandidate } from "../domain.js";

function base(route: UnifiedSupplementCandidate["route"]): UnifiedSupplementCandidate {
  return {
    id: "x",
    route,
    source: { text: "原文", startMs: 0, endMs: 1000, segmentIds: ["s"] },
    content: { question: "问题？", answer: "答案。" },
    decision: {
      displayMode: "auto_prompt",
      confidence: 0.9,
      globalPriority: 90,
      reasons: [],
    },
    trigger: { triggerAtMs: 1500 },
    visual: {
      required: route !== "claim_verification",
      ...(route !== "claim_verification" ? { fullCardPrompt: "完整卡片prompt" } : {}),
    },
    provenance: { skillId: route, skillVersion: "v1", rawOutput: {} },
  };
}

test("visual routes require a full-card prompt", () => {
  const item = base("knowledge_gap");
  delete item.visual.fullCardPrompt;
  assert.equal(gradeContent(item).passed, false);
});

test("claim verification never requests a full-card image", () => {
  const item = base("claim_verification");
  assert.equal(gradeContent(item).passed, true);
});

test("content grader rejects output not anchored to the ASR/OCR evidence window", () => {
  const item = base("claim_verification");
  item.source.text = "模型自己补出的原话";
  const result = gradeContent(item, {
    id: "candidate",
    videoId: "video",
    sourceText: "视频真实文案",
    startMs: 0,
    endMs: 1000,
    segmentIds: ["s"],
    contextBefore: "",
    contextAfter: "",
    ocrText: ["画面 OCR"],
    visualContext: [],
    signals: {
      containsNumber: false,
      containsUnit: false,
      containsPotentialTerm: false,
      containsStrongClaim: true,
      containsCausalLanguage: false,
      containsVisualCue: false,
    },
  });
  assert.equal(result.passed, false);
  assert.ok(result.errors.includes("source_text_not_in_asr_or_ocr"));
});
