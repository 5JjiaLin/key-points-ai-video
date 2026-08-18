import { randomUUID } from "node:crypto";

export interface Chain1Task {
  taskId: string;
  runId: string;
  taskName: "analyze_video_understanding_supplements";
  goal: string;
  createdAt: string;
}

export function createChain1Task(): Chain1Task {
  return {
    taskId: randomUUID(),
    runId: `chain1_${Date.now()}_${randomUUID().slice(0, 8)}`,
    taskName: "analyze_video_understanding_supplements",
    goal:
      "识别视频中的抽象数据、知识断层和自然质疑，并生成绑定时间轴的补充内容。",
    createdAt: new Date().toISOString(),
  };
}
