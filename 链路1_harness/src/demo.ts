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
            span_verbatim: true,
            candidate_role: "unresolved_candidate",
            author_concretization_check: { already_concretized: false },
            intuitive_mapping: {
              user_missing_experience: "用户不知道65℃入口时是什么体感",
              target_takeaway: "已经明显烫口，需要小口慢饮",
              nodes: [
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
                  experience_or_action: "需要小口慢饮",
                },
                {
                  value_label: "100℃",
                  familiar_reference: "沸水温度",
                  visible_state: "正在沸腾并冒大量热气的水壶",
                  experience_or_action: "不能直接喝",
                },
              ],
            },
            abstract_data_score: 0.91,
            trigger_level: "auto_prompt",
            trigger_at_ms: input.candidate.endMs + 500,
            visualization: {
              qa_region: {
                question: "65℃有多烫？",
                answer: "已经明显烫口，需要小口慢饮",
              },
              image_prompt:
                "顶部问题：65℃有多烫？主体横向均匀排列37℃、50℃、65℃、100℃四组具体贴图参照，每组包含温度、核心判断和极短说明，用珊瑚红圆角框高亮65℃。",
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
          answer_label: "需分情况",
          short_answer: "研究更多提示短时胃动力与个体反应差异，不能只用健康或不健康概括。",
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
