import type {
  SkillExecutionResult,
  SkillRunInput,
  SupplementRoute,
  UnifiedSupplementCandidate,
} from "./domain.js";
import { CHAIN1_TASK_CONTRACT } from "./task.js";

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
    const activeRoute = input.activeRoute ?? input.routeDecision.primaryRoute;
    return this.invoker.invokeJson({
      systemPrompt: this.systemPrompt,
      schemaName: this.schemaName,
      input: constrainedModelInput(input),
      imagePaths: (activeRoute === "abstract_to_intuitive" ? input.candidate.visualContext : [])
        .map((item) => item.imagePath)
        .filter((value): value is string => Boolean(value)),
    });
  }
}

export function constrainedModelInput(input: SkillRunInput): Record<string, unknown> {
  const activeRoute = input.activeRoute ?? input.routeDecision.primaryRoute;
  const allowsVisualEvidence = activeRoute === "abstract_to_intuitive";
  return {
    task: CHAIN1_TASK_CONTRACT,
    video: input.video,
    evidence: {
      sourceText: input.candidate.sourceText,
      startMs: input.candidate.startMs,
      endMs: input.candidate.endMs,
      segmentIds: allowsVisualEvidence
        ? input.candidate.segmentIds
        : input.candidate.segmentIds.filter((id) => !id.startsWith("ocr-")),
      contextBefore: input.candidate.contextBefore,
      contextAfter: input.candidate.contextAfter,
      ocrText: allowsVisualEvidence ? input.candidate.ocrText : [],
      visualEvidence: (allowsVisualEvidence ? input.candidate.visualContext : []).map((item) => ({
        id: item.id,
        startMs: item.startMs,
        endMs: item.endMs,
        description: item.description,
        ocrText: item.ocrText ?? [],
        evidenceKinds: item.evidenceKinds ?? [],
      })),
      signals: input.candidate.signals,
    },
    route: {
      primaryRoute: input.routeDecision.primaryRoute,
      confidence: input.routeDecision.confidence,
      reason: input.routeDecision.reason,
      evidence: input.routeDecision.evidence,
    },
    ...(input.runtimeContext ? { verifiedRuntimeEvidence: input.runtimeContext } : {}),
  };
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

function intuitiveMappingNodes(value: unknown): Record<string, unknown>[] {
  const mapping = record(value);
  return Array.isArray(mapping.nodes) ? mapping.nodes.map(record) : [];
}

function hasIntuitiveMapping(value: unknown, imagePrompt: string | undefined): boolean {
  const mapping = record(value);
  const missingExperience = stringValue(mapping.user_missing_experience);
  const targetTakeaway = stringValue(mapping.target_takeaway);
  const nodes = intuitiveMappingNodes(value);
  if (!missingExperience || !targetTakeaway || !imagePrompt || nodes.length !== 4) return false;
  return nodes.every((node) => {
    return Boolean(
      stringValue(node.value_label) &&
        stringValue(node.familiar_reference) &&
        stringValue(node.visible_state) &&
        stringValue(node.experience_or_action),
    );
  });
}

export function buildAbstractStickerComparePrompt(
  question: string,
  sourceSpan: string,
  mappingValue: unknown,
): string {
  const nodes = intuitiveMappingNodes(mappingValue);
  if (nodes.length !== 4) throw new Error("abstract_sticker_compare_v1 requires exactly four nodes");
  const matchedTargetIndex = nodes.findIndex((node) => {
    const label = stringValue(node.value_label) ?? "";
    return label.includes(sourceSpan) || sourceSpan.includes(label);
  });
  const targetIndex = matchedTargetIndex >= 0 ? matchedTargetIndex : nodes.length - 1;
  const nodeDescriptions = nodes.map((node, index) => {
    const valueLabel = stringValue(node.value_label)!;
    const judgment = stringValue(node.familiar_reference)!;
    const sticker = stringValue(node.visible_state)!;
    const note = stringValue(node.experience_or_action)!;
    return `${index + 1}. 数值标签“${valueLabel}”；贴图：${sticker}；核心判断“${judgment}”；极短说明“${note}”${index === targetIndex ? "；这是目标项，使用珊瑚红圆角描边框重点突出" : ""}。`;
  }).join("\n");
  return `生成一张适用于移动端短视频知识补充的微型科普解释卡，严格使用 abstract_sticker_compare_v1 视觉风格。以2K、16:9高清画布生成，按310×180 CSS展示尺寸校验缩略阅读效果。深黑或炭黑纯色背景铺满画面，不画外层卡片边框、圆角线框或四周描边，圆角裁切由H5容器提供。顶部问题区位置固定，左上方逐字显示醒目的白色粗体问题标题“${question}”；不在标题下另写答案。主体由4个横向均匀排列的比较组成，每组从上到下只包含数值或量级标签、一个科普贴图、核心判断和极短说明：\n${nodeDescriptions}\n4个贴图必须属于同一套视觉家族：简洁2D科普贴纸插画，轻微2.5D体积感，粗白色模切外轮廓，细深灰内描边，圆润几何造型，柔和左上方高光，轻微统一阴影，中等偏高饱和度，无写实纹理，统一使用正视角或轻微三分之四视角。四项使用从蓝、黄、橙到红的递进色彩关系；只用珊瑚红圆角描边框突出目标项。禁止复杂背景、真实照片、摄影质感、医学器官、人物场景、海报式排版、来源说明、脚注、表格、多层面板、复杂流程、炫光、粒子效果、不同画风混用、额外温度计或其他无关物件。除顶部问题标题、4个数值或量级标签、4个核心判断和4条极短说明外，不添加任何其他文字。`;
}

function verificationEvidenceCount(input: SkillRunInput): number {
  const packet = input.runtimeContext?.verification_evidence;
  if (!Array.isArray(packet) || packet.length === 0) return 0;
  const valid = packet.every((item) => {
    const evidence = record(item);
    const sourceUrl = stringValue(evidence.source_url);
    return Boolean(
      sourceUrl?.startsWith("https://") &&
        stringValue(evidence.source_title) &&
        stringValue(evidence.source_type) &&
        stringValue(evidence.accessed_at) &&
        stringValue(evidence.stance) &&
        stringValue(evidence.summary),
    );
  });
  return valid ? packet.length : 0;
}

function clarificationColumn(value: unknown): { title: string; content: string } | undefined {
  const column = record(value);
  const title = stringValue(column.title);
  const content = stringValue(column.content);
  if (!title || !content) return undefined;
  const text = `${title}\n${content}`;
  const adversarialFraming = [
    /反驳(?:视频|作者|说法)/,
    /支持(?:视频|作者|说法)/,
    /(?:视频|作者)(?:说错|错了|错误)/,
    /打脸/,
    /辟谣/,
  ];
  return adversarialFraming.some((pattern) => pattern.test(text)) ? undefined : { title, content };
}

const CLARIFICATION_TITLE_PAIRS = new Set([
  "多数情况|需要注意",
  "一般情况|条件变化",
  "已有依据|适用边界",
  "可以确认|仍需核验",
  "常见规律|影响因素",
  "已有发现|适用边界",
  "实际含义|容易混淆",
  "已有共识|尚存分歧",
  "数据本身|口径差异",
]);

const EVIDENCE_BACKED_VERIFICATION_STATUSES = new Set([
  "accurate",
  "accurate_with_estimation",
  "conditional",
  "oversimplified",
  "misleading",
  "inaccurate",
]);

const NEUTRAL_VERIFICATION_LABELS: Record<string, string> = {
  accurate: "基本可信",
  accurate_with_estimation: "大致可信",
  conditional: "需分情况",
  oversimplified: "需补充条件",
  misleading: "表述易误解",
  inaccurate: "与证据不符",
  disputed: "存在争议",
  conflicted: "证据有分歧",
  insufficient_evidence: "证据不足",
};

function verbatimSourceSpan(value: unknown, sourceText: string): string | undefined {
  const span = stringValue(value);
  return span && sourceText.includes(span) ? span : undefined;
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
  return "list_only";
}

function scoreToUnit(value: unknown, fallback = 0): number {
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
    cardVariant?: "viewpoint_clarification" | "verification_result";
    leftColumn?: { title: string; content: string };
    rightColumn?: { title: string; content: string };
    sourceCount?: number;
    sourceAction?: string;
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
      ...(fields.cardVariant ? { cardVariant: fields.cardVariant } : {}),
      ...(fields.leftColumn ? { leftColumn: fields.leftColumn } : {}),
      ...(fields.rightColumn ? { rightColumn: fields.rightColumn } : {}),
      ...(fields.sourceCount !== undefined ? { sourceCount: fields.sourceCount } : {}),
      ...(fields.sourceAction ? { sourceAction: fields.sourceAction } : {}),
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
    return selected.flatMap((item, index) => {
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
      const sourceSpan = verbatimSourceSpan(candidate.source_span, input.candidate.sourceText);
      if (
        confidence < 0.6 ||
        !sourceSpan ||
        candidate.span_verbatim !== true ||
        candidate.candidate_role !== "unresolved_candidate" ||
        authorCheck.already_concretized !== false ||
        !hasIntuitiveMapping(candidate.intuitive_mapping, prompt)
      ) {
        return [];
      }
      const safetyBoundary = record(candidate.safety_boundary);
      const safetySensitive =
        candidate.requires_claim_verification === true ||
        safetyBoundary.requires_claim_verification === true;
      const automaticThreshold = safetySensitive ? 0.82 : 0.76;
      const strictMode =
        mode === "auto_prompt" && confidence < automaticThreshold ? "list_only" : mode;
      const normalizedPrompt = buildAbstractStickerComparePrompt(
        question,
        sourceSpan,
        candidate.intuitive_mapping,
      );
      return [common(execution, input, {
        idSuffix: `abstract_${index}`,
        span: sourceSpan,
        question,
        answer,
        subtitle: "把抽象数字变直观",
        detail: candidate,
        displayMode: strictMode,
        confidence,
        skillScore: confidence,
        triggerAtMs:
          numberValue(candidate.trigger_at_ms) ?? numberValue(candidate.time_end_ms) ?? input.candidate.endMs + 500,
        imagePrompt: normalizedPrompt,
        reasons: [
          stringValue(candidate.missing_scale) ?? "用户缺少现实尺度感",
          ...(stringValue(record(candidate.safety_boundary).reason)
            ? [stringValue(record(candidate.safety_boundary).reason)!]
            : []),
        ],
      })];
    });
  }

  if (execution.route === "knowledge_gap") {
    const root = record(execution.rawOutput);
    const score = scoreToUnit(root.total_score ?? root.selected_score);
    const sourceSpan = verbatimSourceSpan(root.source_span, input.candidate.sourceText);
    if (
      root.should_trigger !== true ||
      score < 0.7 ||
      !sourceSpan ||
      root.video_already_explained === true
    ) {
      return [];
    }
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
    return [
      common(execution, input, {
        idSuffix: "knowledge_gap",
        span: sourceSpan,
        question,
        answer,
        subtitle: stringValue(root.prompt_subtitle) ?? "一句话补懂",
        detail: root,
        displayMode:
          root.definition_status === "needs_verification"
            ? "list_only"
            : displayMode(root.display_mode),
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
  const reaction = record(root.reaction_analysis);
  const trigger = record(root.trigger);
  const viewerReaction = stringValue(reaction.viewer_reaction);
  const instantDoubtProbability = scoreToUnit(reaction.instant_doubt_probability);
  const interventionValue = numberValue(ranking.intervention_value_score);
  const sourceSpan = verbatimSourceSpan(extraction.source_text, input.candidate.sourceText);
  if (
    root.should_trigger !== true ||
    ranking.display_action === "discard" ||
    !sourceSpan ||
    viewerReaction !== "skepticism" ||
    instantDoubtProbability < 0.7 ||
    interventionValue === undefined ||
    interventionValue < 55
  ) {
    return [];
  }
  const question = stringValue(generated.question) ?? "这个说法准确吗？";
  const score = scoreToUnit(interventionValue);
  const evidenceCount = verificationEvidenceCount(input);
  const evidenceProvided = evidenceCount > 0;
  const verificationStatus = stringValue(verification.status);
  const requestedDisplayMode = displayMode(ranking.display_action);
  const autoPromptAllowed =
    evidenceProvided &&
    interventionValue >= 70 &&
    EVIDENCE_BACKED_VERIFICATION_STATUSES.has(verificationStatus ?? "");
  const cautiousPromptAllowed =
    !evidenceProvided &&
    interventionValue >= 70 &&
    (requestedDisplayMode === "auto_prompt" || requestedDisplayMode === "pending_review");
  const strictDisplayMode =
    (requestedDisplayMode === "auto_prompt" && autoPromptAllowed) || cautiousPromptAllowed
      ? "auto_prompt"
      : requestedDisplayMode === "suppressed"
        ? "suppressed"
        : requestedDisplayMode === "pending_review"
          ? "pending_review"
          : "list_only";
  const leftColumn = clarificationColumn(generated.left_column);
  const rightColumn = clarificationColumn(generated.right_column);
  const clarificationEligible =
    evidenceProvided &&
    generated.card_variant === "viewpoint_clarification" &&
    ["conditional", "oversimplified", "misleading"].includes(verificationStatus ?? "") &&
    leftColumn !== undefined &&
    rightColumn !== undefined &&
    CLARIFICATION_TITLE_PAIRS.has(`${leftColumn.title}|${rightColumn.title}`);
  const guardedVerification = {
    ...verification,
    status: "insufficient_evidence",
    concise_judgment: "证据不足/待复核",
    evidence_summary: "现有证据只能确认视频中的原话和画面，无法独立核验该说法。",
    source_quality: "insufficient",
    confidence: 0,
  };
  const detail = evidenceProvided ? root : { ...root, verification: guardedVerification };
  const answer = evidenceProvided
    ? stringValue(generated.short_answer) ?? stringValue(verification.evidence_summary) ?? "证据结论待补充。"
    : "现有本地证据只能确认作者说了什么，不足以独立判定真假。";
  const answerLabel = evidenceProvided
    ? NEUTRAL_VERIFICATION_LABELS[verificationStatus ?? ""] ?? "核验结果"
    : "证据不足/待复核";
  return [
    common(execution, input, {
      idSuffix: "claim_verification",
      span: sourceSpan,
      question,
      answer,
      answerLabel,
      subtitle: clarificationEligible ? "换个角度看" : "查看核验结果",
      cardVariant: clarificationEligible ? "viewpoint_clarification" : "verification_result",
      ...(clarificationEligible ? { leftColumn, rightColumn } : {}),
      sourceCount: evidenceCount,
      ...(evidenceCount > 0
        ? { sourceAction: stringValue(generated.source_action) ?? "查看依据" }
        : {}),
      detail,
      displayMode: strictDisplayMode,
      confidence: evidenceProvided ? scoreToUnit(verification.confidence, score) : Math.min(score, 0.5),
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
  return `生成一张2K、16:9的横向移动端知识断层内容图，按310×180 CSS展示尺寸校验缩略阅读效果。背景必须为纯黑或近黑色哑光底（#0B0B0B至#121212）并铺满整张图片；图片内部不得绘制外层卡片边框、圆角线框或四周描边，不得预留透明外边距，圆角、描边、裁切和关闭控件全部由H5容器提供。禁止深蓝、深紫、渐变或场景背景。顶部必须逐字显示大号粗体白色问题：“${args.question}”，其下逐字显示较小浅灰色回答：“${args.answer}”。中下部只能有一个主贴图：${mainSticker}。${note ? `底部极短说明：“${note}”。` : ""}主贴图使用简洁扁平2D科普贴纸风：内部干净深色粗线，外缘明显粗白色模切描边，高饱和色块，只保留轻微2.5D体积和小阴影。不得增加第二个贴图、写实照片、3D玩具/黏土、日漫场景、水彩、额外标签、来源、水印、关闭叉号、播放器按钮、手机外框或无关文字。最终输出内容必须适配310×180 CSS展示。`;
}
