import { DEFAULT_CONFIG } from "./config.js";
import { Chain1Harness } from "./orchestrator.js";
import { HeuristicRouteClassifier } from "./router.js";
import type { SkillRegistry } from "./skills.js";
import { DisabledImageTool } from "./image/tool.js";
import type { VideoEnvironmentInput } from "./domain.js";

const skills: SkillRegistry = {
  abstractToIntuitive: {
    async run(input) {
      return {
        selected_candidates: [
          {
            source_span: "65℃",
            abstract_data_score: 0.91,
            trigger_level: "auto_prompt",
            trigger_at_ms: input.candidate.endMs + 500,
            visualization: {
              qa_region: {
                question: "65℃有多烫？",
                answer: "已经明显烫口，不再只是温热",
              },
              image_prompt:
                "生成一张严格310×180的完整深色科普卡片。顶部问题：65℃有多烫？答案：已经明显烫口，不再只是温热。底部用37℃、50℃、65℃三档温度刻度和少量贴图表达，65℃高亮。",
            },
          },
        ],
      };
    },
  },
  knowledgeGap: {
    async run(input) {
      return {
        source_span: "胃肠功能紊乱",
        selected_term: "胃肠功能紊乱",
        total_score: 95,
        should_trigger: true,
        trigger_at_ms: input.candidate.endMs + 500,
        prompt_title: "功能紊乱是什么？",
        prompt_subtitle: "一句话补懂",
        one_line_answer: "胃肠工作节奏暂时失调，不等于器官已经损坏。",
        explainer_card: {
          top_question: "什么是“胃肠功能紊乱”？",
          main_answer: "不是胃坏了，是暂时工作不顺。",
          main_sticker: "完整无破损、轻微困惑并带不同步运动箭头的拟人化胃",
          visual_semantic_plan: {
            must_show: ["完整无破损的胃", "不同步运动箭头"],
            must_not_show: ["开心竖大拇指", "流血或破裂"],
          },
        },
      };
    },
  },
  claimVerification: {
    async run(input) {
      return {
        extraction: { source_text: input.candidate.sourceText },
        doubt_analysis: { doubt_focus: "冰水是否一定不健康" },
        verification: { status: "oversimplified", confidence: 0.9 },
        ranking: { intervention_value_score: 84, display_action: "auto_prompt" },
        generated_content: {
          question: "冰水一定都不健康吗？",
          answer_label: "表达过于绝对",
          short_answer: "不能一概而论，需要结合人群、饮用量和身体状态判断。",
        },
        trigger: { trigger_at_ms: input.candidate.endMs + 500 },
      };
    },
  },
};

const demo: VideoEnvironmentInput = {
  videoId: "ice-water-demo",
  videoHash: "demo-hash",
  title: "喝冰水伤胃吗？",
  durationMs: 177000,
  sourceVideoUrl: "/demo/ice-water.mp4",
  asrSegments: [],
  ocrSegments: [],
  visualContext: [],
  semanticSegments: [
    {
      id: "seg-1",
      startMs: 12000,
      endMs: 17000,
      text: "冰水就是不健康的",
      asrSegmentIds: ["asr-1"],
    },
    {
      id: "seg-2",
      startMs: 31000,
      endMs: 35600,
      text: "长期饮用65℃以上的热饮更值得注意",
      asrSegmentIds: ["asr-2"],
    },
    {
      id: "seg-3",
      startMs: 63000,
      endMs: 67000,
      text: "低温刺激可能引发胃肠功能紊乱",
      asrSegmentIds: ["asr-3"],
    },
  ],
};

const harness = new Chain1Harness({
  config: { ...DEFAULT_CONFIG, image: { ...DEFAULT_CONFIG.image, enabled: false } },
  routeClassifier: new HeuristicRouteClassifier(),
  skills,
  imageTool: new DisabledImageTool(),
});

console.log(JSON.stringify(await harness.run(demo), null, 2));
