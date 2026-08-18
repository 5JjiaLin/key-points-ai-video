import type {
  SkillExecutionResult,
  SkillRunInput,
  SupplementRoute,
  UnifiedSupplementCandidate,
} from "./domain.js";

export interface SkillRunner {
  run(input: SkillRunInput): Promise<unknown>;
}

export interface SkillRegistry {
  abstractToIntuitive: SkillRunner;
  knowledgeGap: SkillRunner;
  claimVerification: SkillRunner;
}

export class PromptSkillRunner implements SkillRunner {
  constructor(
    private readonly invoker: import("./router.js").JsonInvoker,
    private readonly systemPrompt: string,
    private readonly schemaName: string,
  ) {}

  run(input: SkillRunInput): Promise<unknown> {
    return this.invoker.invokeJson({
      systemPrompt: this.systemPrompt,
      schemaName: this.schemaName,
      input,
      imagePaths: input.candidate.visualContext
        .map((item) => item.imagePath)
        .filter((value): value is string => Boolean(value)),
    });
  }
}

export async function runSkill(
  registry: SkillRegistry,
  route: SupplementRoute,
  input: SkillRunInput,
  version: string,
): Promise<SkillExecutionResult> {
  const started = Date.now();
  const runner =
    route === "abstract_to_intuitive"
      ? registry.abstractToIntuitive
      : route === "knowledge_gap"
        ? registry.knowledgeGap
        : registry.claimVerification;

  return {
    route,
    skillId: route,
    skillVersion: version,
    rawOutput: await runner.run(input),
    durationMs: Date.now() - started,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output = value.filter((item): item is string => typeof item === "string");
  return output.length ? output : undefined;
}

function displayMode(value: unknown): UnifiedSupplementCandidate["decision"]["displayMode"] {
  if (value === "auto_prompt" || value === "auto_prompt_high") return "auto_prompt";
  if (value === "save_only" || value === "list_only" || value === "internal_candidate") {
    return "list_only";
  }
  if (value === "pending_review" || value === "pending_verification") {
    return "pending_review";
  }
  if (value === "suppress" || value === "discard") return "suppressed";
  return "auto_prompt";
}

function scoreToUnit(value: unknown, fallback = 0.75): number {
  const score = numberValue(value);
  if (score === undefined) return fallback;
  return score > 1 ? Math.max(0, Math.min(1, score / 100)) : Math.max(0, Math.min(1, score));
}

function common(
  execution: SkillExecutionResult,
  input: SkillRunInput,
  fields: {
    idSuffix: string;
    span?: string;
    question: string;
    answer: string;
    subtitle?: string;
    answerLabel?: string;
    detail?: unknown;
    displayMode: UnifiedSupplementCandidate["decision"]["displayMode"];
    confidence: number;
    skillScore?: number;
    triggerAtMs: number;
    imagePrompt?: string;
    mustShow?: string[];
    mustNotShow?: string[];
    reasons: string[];
  },
): UnifiedSupplementCandidate {
  const globalPriority = Math.round(
    100 * (0.35 * fields.confidence + 0.35 * (fields.skillScore ?? fields.confidence) + 0.3),
  );

  return {
    id: `${input.candidate.id}_${fields.idSuffix}`,
    route: execution.route,
    source: {
      text: input.candidate.sourceText,
      ...(fields.span ? { span: fields.span } : {}),
      startMs: input.candidate.startMs,
      endMs: input.candidate.endMs,
      segmentIds: input.candidate.segmentIds,
    },
    content: {
      question: fields.question,
      answer: fields.answer,
      ...(fields.subtitle ? { subtitle: fields.subtitle } : {}),
      ...(fields.answerLabel ? { answerLabel: fields.answerLabel } : {}),
      ...(fields.detail !== undefined ? { detail: fields.detail } : {}),
    },
    decision: {
      displayMode: fields.displayMode,
      confidence: fields.confidence,
      ...(fields.skillScore !== undefined ? { skillScore: fields.skillScore } : {}),
      globalPriority,
      reasons: fields.reasons,
    },
    trigger: { triggerAtMs: fields.triggerAtMs },
    visual: {
      required: execution.route !== "claim_verification",
      ...(fields.imagePrompt ? { fullCardPrompt: fields.imagePrompt } : {}),
      ...(fields.mustShow ? { mustShow: fields.mustShow } : {}),
      ...(fields.mustNotShow ? { mustNotShow: fields.mustNotShow } : {}),
    },
    provenance: {
      skillId: execution.skillId,
      skillVersion: execution.skillVersion,
      rawOutput: execution.rawOutput,
    },
  };
}

export function adaptSkillOutput(
  execution: SkillExecutionResult,
  input: SkillRunInput,
): UnifiedSupplementCandidate[] {
  if (execution.route === "abstract_to_intuitive") {
    const root = record(execution.rawOutput);
    const selected = Array.isArray(root.selected_candidates) ? root.selected_candidates : [];
    return selected.map((item, index) => {
      const candidate = record(item);
      const visualization = record(candidate.visualization);
      const qa = record(visualization.qa_region);
      const authorCheck = record(candidate.author_concretization_check);
      const question =
        stringValue(qa.question) ?? stringValue(candidate.natural_question) ?? "这个数字是什么概念？";
      const answer = stringValue(qa.answer) ?? stringValue(candidate.short_answer) ?? "需要一个现实参照。";
      const prompt = stringValue(visualization.image_prompt) ?? stringValue(candidate.image_prompt);
      const mode = displayMode(candidate.trigger_level);
      const confidence = scoreToUnit(candidate.abstract_data_score);
      return common(execution, input, {
        idSuffix: `abstract_${index}`,
        ...(stringValue(candidate.source_span) ? { span: stringValue(candidate.source_span)! } : {}),
        question,
        answer,
        subtitle: "把抽象数字变直观",
        detail: candidate,
        displayMode: authorCheck.already_concretized === true ? "suppressed" : mode,
        confidence,
        skillScore: confidence,
        triggerAtMs:
          numberValue(candidate.trigger_at_ms) ?? numberValue(candidate.time_end_ms) ?? input.candidate.endMs + 500,
        ...(prompt ? { imagePrompt: prompt } : {}),
        reasons: [
          stringValue(candidate.missing_scale) ?? "用户缺少现实尺度感",
          ...(stringValue(record(candidate.safety_boundary).reason)
            ? [stringValue(record(candidate.safety_boundary).reason)!]
            : []),
        ],
      });
    });
  }

  if (execution.route === "knowledge_gap") {
    const root = record(execution.rawOutput);
    if (root.should_trigger === false && root.display_mode === "discard") return [];
    const card = record(root.explainer_card);
    const semantic = record(card.visual_semantic_plan);
    const question =
      stringValue(card.top_question) ?? stringValue(root.prompt_title) ?? "这个概念是什么意思？";
    const answer =
      stringValue(card.main_answer) ?? stringValue(root.one_line_answer) ?? "需要补上这个前置概念。";
    const prompt =
      stringValue(card.image_prompt) ??
      stringValue(root.image_prompt) ??
      buildKnowledgeGapPrompt({
        selectedTerm: stringValue(root.selected_term) ?? stringValue(root.source_span) ?? "当前概念",
        question,
        answer,
        card,
      });
    const score = scoreToUnit(root.total_score ?? root.selected_score);
    return [
      common(execution, input, {
        idSuffix: "knowledge_gap",
        ...((stringValue(root.source_span) ?? stringValue(root.selected_term))
          ? { span: (stringValue(root.source_span) ?? stringValue(root.selected_term))! }
          : {}),
        question,
        answer,
        subtitle: stringValue(root.prompt_subtitle) ?? "一句话补懂",
        detail: root,
        displayMode: displayMode(root.display_mode ?? (root.should_trigger === false ? "discard" : "auto_prompt")),
        confidence: score,
        skillScore: score,
        triggerAtMs: numberValue(root.trigger_at_ms) ?? input.candidate.endMs + 500,
        imagePrompt: prompt,
        ...(stringArray(semantic.must_show) ? { mustShow: stringArray(semantic.must_show)! } : {}),
        ...(stringArray(semantic.must_not_show) ? { mustNotShow: stringArray(semantic.must_not_show)! } : {}),
        reasons: [stringValue(root.selection_reason) ?? "该概念影响主线理解"],
      }),
    ];
  }

  const root = record(execution.rawOutput);
  const extraction = record(root.extraction);
  const generated = record(root.generated_content);
  const verification = record(root.verification);
  const ranking = record(root.ranking);
  const trigger = record(root.trigger);
  const question = stringValue(generated.question) ?? "这个说法准确吗？";
  const score = scoreToUnit(ranking.intervention_value_score ?? ranking.spontaneous_doubt_score);
  const guardedVerification = {
    ...verification,
    status: "insufficient_evidence",
    concise_judgment: "证据不足/待复核",
    evidence_summary: "现有证据只能确认视频中的原话和画面，无法独立核验该说法。",
    source_quality: "insufficient",
    confidence: 0,
  };
  const guardedDetail = { ...root, verification: guardedVerification };
  return [
    common(execution, input, {
      idSuffix: "claim_verification",
      ...(stringValue(extraction.source_text) ? { span: stringValue(extraction.source_text)! } : {}),
      question,
      answer: "现有本地证据只能确认作者说了什么，不足以独立判定真假。",
      answerLabel: "证据不足/待复核",
      detail: guardedDetail,
      displayMode: "list_only",
      confidence: Math.min(score, 0.5),
      skillScore: score,
      triggerAtMs: numberValue(trigger.trigger_at_ms) ?? input.candidate.endMs + 500,
      reasons: [stringValue(record(root.doubt_analysis).doubt_focus) ?? "用户存在自然质疑"],
    }),
  ];
}

function buildKnowledgeGapPrompt(args: {
  selectedTerm: string;
  question: string;
  answer: string;
  card: Record<string, unknown>;
}): string {
  const mainSticker = stringValue(args.card.main_sticker) ?? "一个直接表达当前概念核心状态的主贴纸";
  const note = stringValue(args.card.optional_bottom_note) ?? "";
  return `生成一张严格为310px×180px的横向移动端知识断层解释卡，比例固定为31:18，按原生小尺寸构图。顶部必须逐字显示问题：“${args.question}”。中部只能有一个主贴纸和一个主回答，回答逐字显示：“${args.answer}”。主贴纸：${mainSticker}。${note ? `底部极短说明：“${note}”。` : ""}深色圆角背景，简洁2D科普贴纸风，轻微2.5D体积，粗白色模切轮廓。不得增加第二个贴纸、额外标签、来源、水印、手机外框或无关文字。最终输出内容必须适配310×180。`;
}
