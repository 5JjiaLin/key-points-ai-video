import { randomUUID } from "node:crypto";

export interface Chain1Task {
  taskId: string;
  runId: string;
  taskName: "analyze_video_understanding_supplements";
  goal: string;
  contract: typeof CHAIN1_TASK_CONTRACT;
  createdAt: string;
}

export const CHAIN1_TASK_CONTRACT = Object.freeze({
  evidenceInputs: ["asr_source_text", "ocr_text", "timestamp", "visual_evidence"] as const,
  routeEvidencePolicy: {
    routeClassifier: ["asr_source_text", "timestamp"],
    abstract_to_intuitive: ["asr_source_text", "timestamp", "ocr_text", "visual_evidence"],
    knowledge_gap: ["asr_source_text", "timestamp"],
    claim_verification: ["asr_source_text", "timestamp"],
  } as const,
  allowedRoutes: [
    "abstract_to_intuitive",
    "knowledge_gap",
    "claim_verification",
  ] as const,
  outputRule:
    "每个补充必须锚定输入中的视频文案并绑定时间戳；只有抽象变具体路由可以额外使用同一窗口的 OCR 与关键帧。",
  prohibited: [
    "使用运行编号、快照编号影响内容判断",
    "编造视频文案、OCR 或画面中不存在的原始说法",
    "把模型常识当成视频证据",
  ] as const,
  qualityGates: [
    "route_supported_by_evidence",
    "source_span_verbatim",
    "timestamp_within_evidence_window",
    "content_schema_valid",
  ] as const,
});

export function createChain1Task(): Chain1Task {
  return {
    taskId: randomUUID(),
    runId: `chain1_${Date.now()}_${randomUUID().slice(0, 8)}`,
    taskName: "analyze_video_understanding_supplements",
    goal:
      "识别视频中的抽象数据、知识断层和自然质疑，并生成绑定时间轴的补充内容。",
    contract: CHAIN1_TASK_CONTRACT,
    createdAt: new Date().toISOString(),
  };
}
