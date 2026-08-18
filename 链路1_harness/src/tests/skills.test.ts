import assert from "node:assert/strict";
import test from "node:test";
import type { SkillExecutionResult, SkillRunInput } from "../domain.js";
import { adaptSkillOutput, constrainedModelInput } from "../skills.js";

const temperatureComparisonNodes = [
  {
    value_label: "37℃",
    familiar_reference: "接近体温",
    visible_state: "装有温水的透明水杯",
    experience_or_action: "感觉温热",
  },
  {
    value_label: "50℃",
    familiar_reference: "明显偏热",
    visible_state: "冒少量热气的茶杯",
    experience_or_action: "入口较烫",
  },
  {
    value_label: "65℃",
    familiar_reference: "已经很烫",
    visible_state: "冒明显热气的水杯和轻微烫嘴表情",
    experience_or_action: "需小口慢饮",
  },
  {
    value_label: "100℃",
    familiar_reference: "沸水温度",
    visible_state: "正在沸腾并冒大量热气的水壶",
    experience_or_action: "不能直接喝",
  },
];

test("knowledge-gap model input uses ASR text but excludes OCR and local images", () => {
  const input = skillInput("knowledge_gap", "胃肠功能紊乱");
  input.candidate.ocrText = ["功能紊乱"];
  input.candidate.visualContext = [{
    id: "frame-1",
    startMs: 0,
    endMs: 1000,
    description: "字幕解释画面",
    imagePath: "/private/frame.jpg",
  }];
  const modelInput = constrainedModelInput(input);
  const serialized = JSON.stringify(modelInput);
  assert.equal(serialized.includes("runId"), false);
  assert.equal(serialized.includes("snapshotId"), false);
  assert.equal(serialized.includes("/private/frame.jpg"), false);
  assert.equal(serialized.includes("胃肠功能紊乱"), true);
  assert.equal(serialized.includes("功能紊乱"), true);
  assert.deepEqual((modelInput.evidence as { ocrText: string[] }).ocrText, []);
  assert.deepEqual((modelInput.evidence as { visualEvidence: unknown[] }).visualEvidence, []);
  assert.equal(serialized.includes("source_span_verbatim"), true);
});

test("abstract model input retains OCR and visual evidence", () => {
  const input = skillInput("abstract_to_intuitive", "65℃有多烫");
  input.candidate.ocrText = ["65℃"];
  input.candidate.visualContext = [{
    id: "frame-1",
    startMs: 0,
    endMs: 1000,
    description: "温度对比画面",
    imagePath: "/private/frame.jpg",
  }];
  const evidence = constrainedModelInput(input).evidence as {
    ocrText: string[];
    visualEvidence: unknown[];
  };
  assert.deepEqual(evidence.ocrText, ["65℃"]);
  assert.equal(evidence.visualEvidence.length, 1);
});

test("claim verification without independent sources is marked insufficient evidence", () => {
  const execution: SkillExecutionResult = {
    route: "claim_verification",
    skillId: "claim_verification",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      should_trigger: true,
      extraction: { source_text: "某强断言" },
      reaction_analysis: { viewer_reaction: "skepticism", instant_doubt_probability: 0.9 },
      verification: { status: "verified", source_quality: "high", confidence: 0.99 },
      generated_content: {
        card_variant: "viewpoint_clarification",
        question: "这是真的吗？",
        short_answer: "是",
        left_column: { title: "一般情况", content: "模型伪造的左栏" },
        right_column: { title: "条件变化", content: "模型伪造的右栏" },
        source_count: 99,
      },
      ranking: { intervention_value_score: 90, display_action: "pending_review" },
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
  assert.equal(candidate.decision.displayMode, "auto_prompt");
  assert.equal(candidate.content.cardVariant, "verification_result");
  assert.equal(candidate.content.leftColumn, undefined);
  assert.equal(candidate.content.rightColumn, undefined);
  assert.equal(candidate.content.sourceCount, 0);
  assert.equal((candidate.content.detail as { verification: { status: string } }).verification.status, "insufficient_evidence");
});

test("claim verification discards non-skeptical reactions", () => {
  const execution: SkillExecutionResult = {
    route: "claim_verification",
    skillId: "claim_verification",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      should_trigger: false,
      reaction_analysis: {
        viewer_reaction: "surprise_accept",
        instant_doubt_probability: 0.35,
      },
      ranking: { intervention_value_score: 0, display_action: "discard" },
      generated_content: { question: "", short_answer: "" },
      trigger: { trigger_at_ms: 0 },
    },
  };
  const input = {
    runId: "run",
    snapshotId: "snapshot",
    video: { videoId: "video", title: "title", durationMs: 10000 },
    candidate: {
      id: "candidate",
      videoId: "video",
      sourceText: "每天花1万元，需要2.4亿年",
      startMs: 0,
      endMs: 1000,
      segmentIds: ["asr-1"],
      contextBefore: "",
      contextAfter: "",
      ocrText: [],
      visualContext: [],
      signals: {
        containsNumber: true,
        containsUnit: true,
        containsPotentialTerm: false,
        containsStrongClaim: false,
        containsCausalLanguage: false,
        containsVisualCue: false,
      },
    },
    routeDecision: {
      isCandidate: true,
      primaryRoute: "claim_verification",
      routeScores: { abstract_to_intuitive: 0.6, knowledge_gap: 0, claim_verification: 0.3, discard: 0.1 },
      confidence: 0.6,
      reason: "large number",
      evidence: [],
    },
  } satisfies SkillRunInput;

  assert.deepEqual(adaptSkillOutput(execution, input), []);
});

test("claim verification passes through results only with a complete upstream evidence packet", () => {
  const execution: SkillExecutionResult = {
    route: "claim_verification",
    skillId: "claim_verification",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      should_trigger: true,
      extraction: { source_text: "某强断言" },
      reaction_analysis: { viewer_reaction: "skepticism", instant_doubt_probability: 0.9 },
      verification: {
        status: "conditional",
        concise_judgment: "有条件成立",
        evidence_summary: "两条上游证据支持在限定条件下成立。",
        confidence: 0.82,
      },
      ranking: { intervention_value_score: 84, display_action: "auto_prompt" },
      generated_content: {
        card_variant: "viewpoint_clarification",
        question: "这个说法一定成立吗？",
        helper_text: "来反驳这句话",
        answer_label: "视频错了",
        short_answer: "只在限定条件下成立，不能推广到所有情况。",
        left_column: {
          title: "多数情况",
          content: "多数情况下，这个结论有一定的适用范围。",
        },
        right_column: {
          title: "需要注意",
          content: "人群或剂量改变时，结果可能不同。",
        },
        source_count: 99,
        source_action: "查看依据",
      },
      trigger: { trigger_at_ms: 1500 },
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
    runtimeContext: {
      verification_evidence: [
        {
          source_url: "https://example.org/source-1",
          source_title: "Primary source",
          source_type: "primary",
          published_at: "2026-01-01",
          accessed_at: "2026-07-21",
          stance: "qualifies",
          summary: "Supports the claim only under stated conditions.",
        },
      ],
    },
  } satisfies SkillRunInput;

  const [candidate] = adaptSkillOutput(execution, input);
  assert.ok(candidate);
  assert.equal(candidate.content.answerLabel, "需分情况");
  assert.equal(candidate.content.subtitle, "换个角度看");
  assert.equal(candidate.content.answer, "只在限定条件下成立，不能推广到所有情况。");
  assert.equal(candidate.decision.displayMode, "auto_prompt");
  assert.equal(candidate.content.cardVariant, "viewpoint_clarification");
  assert.equal(candidate.content.leftColumn?.title, "多数情况");
  assert.equal(candidate.content.rightColumn?.title, "需要注意");
  assert.equal(candidate.content.sourceCount, 1);
  assert.equal((candidate.content.detail as { verification: { status: string } }).verification.status, "conditional");

  const adversarialOutput = execution.rawOutput as {
    generated_content: {
      left_column: { title: string; content: string };
      right_column: { title: string; content: string };
    };
  };
  adversarialOutput.generated_content.left_column.title = "支持视频";
  adversarialOutput.generated_content.right_column.title = "反驳视频";
  const [fallback] = adaptSkillOutput(execution, input);
  assert.ok(fallback);
  assert.equal(fallback.content.cardVariant, "verification_result");
  assert.equal(fallback.content.subtitle, "查看核验结果");
  assert.equal(fallback.content.leftColumn, undefined);
  assert.equal(fallback.content.rightColumn, undefined);

  adversarialOutput.generated_content.left_column.title = "多数情况";
  adversarialOutput.generated_content.right_column.title = "需要注意";
  adversarialOutput.generated_content.right_column.content = "这里用来反驳视频的说法。";
  const [contentFallback] = adaptSkillOutput(execution, input);
  assert.ok(contentFallback);
  assert.equal(contentFallback.content.cardVariant, "verification_result");
  assert.equal(contentFallback.content.leftColumn, undefined);
  assert.equal(contentFallback.content.rightColumn, undefined);
});

test("abstract selection enforces the retain and automatic display thresholds", () => {
  const input = skillInput("abstract_to_intuitive", "65℃有多烫？");
  const execution = (score: number): SkillExecutionResult => ({
    route: "abstract_to_intuitive",
    skillId: "abstract_to_intuitive",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      selected_candidates: [
        {
          source_span: "65℃",
          span_verbatim: true,
          candidate_role: "unresolved_candidate",
          author_concretization_check: { already_concretized: false },
          intuitive_mapping: {
            user_missing_experience: "不知道入口体感",
            target_takeaway: "已经明显烫口",
            nodes: temperatureComparisonNodes,
          },
          abstract_data_score: score,
          trigger_level: "auto_prompt",
          visualization: {
            qa_region: { question: "65℃有多烫？", answer: "已经明显烫口" },
            image_prompt: "热茶入口，已经明显烫口",
          },
        },
      ],
    },
  });

  assert.deepEqual(adaptSkillOutput(execution(0.59), input), []);
  assert.equal(adaptSkillOutput(execution(0.7), input)[0]?.decision.displayMode, "list_only");
  const automatic = adaptSkillOutput(execution(0.76), input)[0];
  assert.equal(automatic?.decision.displayMode, "auto_prompt");
  assert.match(automatic?.visual.fullCardPrompt ?? "", /abstract_sticker_compare_v1/);
  assert.match(automatic?.visual.fullCardPrompt ?? "", /顶部问题区位置固定/);
  assert.match(automatic?.visual.fullCardPrompt ?? "", /4个横向均匀排列/);
  assert.match(automatic?.visual.fullCardPrompt ?? "", /珊瑚红圆角描边框/);
  assert.doesNotMatch(automatic?.visual.fullCardPrompt ?? "", /答案：已经明显烫口/);
});

test("abstract selection rejects numeric-only visuals without an intuitive mapping", () => {
  const input = skillInput("abstract_to_intuitive", "65℃有多烫？");
  const execution: SkillExecutionResult = {
    route: "abstract_to_intuitive",
    skillId: "abstract_to_intuitive",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      selected_candidates: [
        {
          source_span: "65℃",
          span_verbatim: true,
          candidate_role: "unresolved_candidate",
          author_concretization_check: { already_concretized: false },
          abstract_data_score: 0.9,
          trigger_level: "auto_prompt",
          visualization: {
            qa_region: { question: "65℃有多烫？", answer: "数值较高" },
            image_prompt: "画37℃、50℃、65℃三档数字和色点",
          },
        },
      ],
    },
  };

  assert.deepEqual(adaptSkillOutput(execution, input), []);
});

test("abstract safety-sensitive selection requires 0.82 for automatic display", () => {
  const input = skillInput("abstract_to_intuitive", "800伏是什么概念？");
  const execution: SkillExecutionResult = {
    route: "abstract_to_intuitive",
    skillId: "abstract_to_intuitive",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      selected_candidates: [
        {
          source_span: "800伏",
          span_verbatim: true,
          candidate_role: "unresolved_candidate",
          author_concretization_check: { already_concretized: false },
          intuitive_mapping: {
            user_missing_experience: "不知道相对家用电压的尺度",
            target_takeaway: "远高于家用电压",
            nodes: [
              {
                value_label: "12伏",
                familiar_reference: "小型低压设备",
                visible_state: "低压电池组",
                experience_or_action: "常见低压",
              },
              {
                value_label: "220伏",
                familiar_reference: "日常家用电压",
                visible_state: "普通墙面插座",
                experience_or_action: "家庭供电",
              },
              {
                value_label: "380伏",
                familiar_reference: "工业用电级别",
                visible_state: "工业配电箱",
                experience_or_action: "高于家用",
              },
              {
                value_label: "800伏",
                familiar_reference: "远高于家用电压",
                visible_state: "带高压标识的设备外壳",
                experience_or_action: "专业高压级别",
              },
            ],
          },
          abstract_data_score: 0.8,
          trigger_level: "auto_prompt",
          safety_boundary: { requires_claim_verification: true },
          visualization: {
            qa_region: { question: "800伏是什么概念？", answer: "远高于家用电压" },
            image_prompt: "家庭插座对比，远高于家用电压",
          },
        },
      ],
    },
  };

  assert.equal(adaptSkillOutput(execution, input)[0]?.decision.displayMode, "list_only");
});

test("knowledge-gap selection enforces score, source span, and conservative display", () => {
  const input = skillInput("knowledge_gap", "IARC将高温饮品列为2A类致癌物");
  const execution = (score: number, displayMode?: string): SkillExecutionResult => ({
    route: "knowledge_gap",
    skillId: "knowledge_gap",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      source_span: "2A类致癌物",
      selected_term: "2A类致癌物",
      total_score: score,
      should_trigger: true,
      ...(displayMode ? { display_mode: displayMode } : {}),
      one_line_answer: "这是致癌证据分类。",
    },
  });

  assert.deepEqual(adaptSkillOutput(execution(69), input), []);
  assert.equal(adaptSkillOutput(execution(90), input)[0]?.decision.displayMode, "list_only");
  assert.equal(adaptSkillOutput(execution(90, "auto_prompt"), input)[0]?.decision.displayMode, "auto_prompt");
});

test("claim verification enforces doubt and intervention thresholds", () => {
  const input = skillInput("claim_verification", "某强断言");
  const execution = (doubt: number, intervention: number): SkillExecutionResult => ({
    route: "claim_verification",
    skillId: "claim_verification",
    skillVersion: "test",
    durationMs: 1,
    rawOutput: {
      should_trigger: true,
      extraction: { source_text: "某强断言" },
      reaction_analysis: { viewer_reaction: "skepticism", instant_doubt_probability: doubt },
      ranking: { intervention_value_score: intervention, display_action: "save_only" },
      generated_content: { question: "这个说法准确吗？" },
    },
  });

  assert.deepEqual(adaptSkillOutput(execution(0.69, 90), input), []);
  assert.deepEqual(adaptSkillOutput(execution(0.9, 54), input), []);
  assert.equal(adaptSkillOutput(execution(0.9, 55), input)[0]?.decision.displayMode, "list_only");
});

function skillInput(route: SkillRunInput["routeDecision"]["primaryRoute"], sourceText: string): SkillRunInput {
  if (route === "discard") throw new Error("test route must be a skill route");
  return {
    runId: "run",
    snapshotId: "snapshot",
    video: { videoId: "video", title: "title", durationMs: 10000 },
    candidate: {
      id: "candidate",
      videoId: "video",
      sourceText,
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
    },
    routeDecision: {
      isCandidate: true,
      primaryRoute: route,
      routeScores: {
        abstract_to_intuitive: route === "abstract_to_intuitive" ? 1 : 0,
        knowledge_gap: route === "knowledge_gap" ? 1 : 0,
        claim_verification: route === "claim_verification" ? 1 : 0,
        discard: 0,
      },
      confidence: 1,
      reason: "test",
      evidence: [],
    },
  };
}
