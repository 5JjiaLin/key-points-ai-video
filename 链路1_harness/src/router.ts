import type {
  CandidateWindow,
  EnvironmentSnapshot,
  RouteDecision,
  RouteOrDiscard,
  SupplementRoute,
} from "./domain.js";
import { CHAIN1_TASK_CONTRACT } from "./task.js";

export interface JsonInvoker {
  invokeJson<T>(args: {
    systemPrompt: string;
    input: unknown;
    schemaName: string;
    imagePaths?: string[];
  }): Promise<T>;
}

export interface RouteClassifier {
  classify(snapshot: EnvironmentSnapshot, candidate: CandidateWindow): Promise<RouteDecision>;
}

export interface BatchRouteClassifier extends RouteClassifier {
  classifyBatch(
    snapshot: EnvironmentSnapshot,
    candidates: CandidateWindow[],
  ): Promise<Map<string, RouteDecision>>;
}

export const ROUTE_CLASSIFIER_SYSTEM_PROMPT = `
你是链路1 Harness 的前置分类器。只分类，不生成问题、答案或核验结论。
类型：
1. abstract_to_intuitive：明确数字/单位存在，但用户缺少现实尺度感。
2. knowledge_gap：用户不知道术语、分类、缩写或专业状态是什么意思。
3. claim_verification：用户理解句意，但会自然质疑真假、范围、因果、概念等同或绝对化。
4. discard：没有必要补充，或作者已经解释清楚。
只能依据输入的 ASR 视频文案和时间戳分类；OCR 与关键帧仅在确定为 abstract_to_intuitive 后供对应 Skill 使用。evidence 必须逐字引用 ASR 文案，禁止补入外部常识。
允许一个主路由和最多一个次路由。输出严格 JSON。
`;

export class PromptRouteClassifier implements RouteClassifier {
  private readonly heuristic = new HeuristicRouteClassifier();

  constructor(private readonly invoker: JsonInvoker) {}

  async classify(
    snapshot: EnvironmentSnapshot,
    candidate: CandidateWindow,
  ): Promise<RouteDecision> {
    const raw = await this.invoker.invokeJson<{
      is_candidate: boolean;
      primary_route: RouteOrDiscard;
      secondary_route?: SupplementRoute | null;
      route_scores: Record<RouteOrDiscard, number>;
      confidence: number;
      reason: string;
      evidence: string[];
    }>({
      systemPrompt: ROUTE_CLASSIFIER_SYSTEM_PROMPT,
      schemaName: "route-decision",
      input: {
        task: CHAIN1_TASK_CONTRACT,
        video: { title: snapshot.title, description: snapshot.description },
        evidence: routeEvidenceInput(candidate),
      },
    });

    return normalizeRouteDecision(raw);
  }

  async classifyBatch(
    snapshot: EnvironmentSnapshot,
    candidates: CandidateWindow[],
  ): Promise<Map<string, RouteDecision>> {
    const decisions = new Map<string, RouteDecision>();
    for (let offset = 0; offset < candidates.length; offset += 12) {
      const batch = candidates.slice(offset, offset + 12);
      try {
        const raw = await this.invoker.invokeJson<unknown>({
          systemPrompt: `${ROUTE_CLASSIFIER_SYSTEM_PROMPT}\n一次分类当前候选段，每个 candidate_id 必须恰好输出一条决策。\n根对象必须严格为：{\"decisions\":[{\"candidate_id\":\"candidate_semantic-0001\",\"is_candidate\":true,\"primary_route\":\"abstract_to_intuitive\",\"secondary_route\":null,\"route_scores\":{\"abstract_to_intuitive\":0.9,\"knowledge_gap\":0.1,\"claim_verification\":0.1,\"discard\":0.1},\"confidence\":0.9,\"reason\":\"...\",\"evidence\":[\"...\"]}]}。不得改字段名，不得直接输出数组。`,
          schemaName: "route-decision-batch",
          input: {
            task: CHAIN1_TASK_CONTRACT,
            video: { title: snapshot.title, description: snapshot.description },
            candidates: batch.map(routeEvidenceInput),
          },
        });
        for (const item of batchRows(raw)) {
          const candidateId = textField(item, "candidate_id", "candidateId", "id");
          if (!candidateId || !batch.some((candidate) => candidate.id === candidateId)) continue;
          const normalized = flexibleRouteDecision(item);
          if (normalized) decisions.set(candidateId, normalized);
        }
      } catch (error) {
        for (const candidate of batch) {
          const fallback = await this.heuristic.classify(snapshot, candidate);
          decisions.set(candidate.id, {
            ...fallback,
            reason: `批量路由请求失败，回退规则分类：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
    for (const candidate of candidates) {
      if (!decisions.has(candidate.id)) {
        const fallback = await this.heuristic.classify(snapshot, candidate);
        decisions.set(candidate.id, {
          ...fallback,
          reason: `批量路由结果缺失，回退规则分类：${fallback.reason}`,
        });
      }
    }
    return decisions;
  }
}

function routeEvidenceInput(candidate: CandidateWindow): Record<string, unknown> {
  return {
    id: candidate.id,
    sourceText: candidate.sourceText,
    startMs: candidate.startMs,
    endMs: candidate.endMs,
    contextBefore: candidate.contextBefore,
    contextAfter: candidate.contextAfter,
    signals: candidate.signals,
  };
}

function batchRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["decisions", "route_decisions", "routes", "results"]) {
    const rows = value[key];
    if (Array.isArray(rows)) return rows.filter(isRecord);
  }
  return [];
}

function flexibleRouteDecision(value: Record<string, unknown>): RouteDecision | undefined {
  const primary = textField(value, "primary_route", "primaryRoute") as RouteOrDiscard | undefined;
  const scores = value.route_scores ?? value.routeScores;
  if (!primary || !isRecord(scores)) return undefined;
  const secondary = textField(value, "secondary_route", "secondaryRoute") as SupplementRoute | undefined;
  const evidence = value.evidence;
  return {
    isCandidate: value.is_candidate === true || value.isCandidate === true,
    primaryRoute: primary,
    secondaryRoute: secondary ?? null,
    routeScores: scores as unknown as Record<RouteOrDiscard, number>,
    confidence: numberField(value, "confidence") ?? 0,
    reason: textField(value, "reason") ?? "模型未返回理由",
    evidence: Array.isArray(evidence)
      ? evidence.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function textField(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return undefined;
}

function numberField(value: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "number" && Number.isFinite(field)) return field;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRouteDecision(raw: {
  is_candidate: boolean;
  primary_route: RouteOrDiscard;
  secondary_route?: SupplementRoute | null;
  route_scores: Record<RouteOrDiscard, number>;
  confidence: number;
  reason: string;
  evidence: string[];
}): RouteDecision {
  return {
      isCandidate: raw.is_candidate,
      primaryRoute: raw.primary_route,
      secondaryRoute: raw.secondary_route ?? null,
      routeScores: raw.route_scores,
      confidence: raw.confidence,
      reason: raw.reason,
      evidence: raw.evidence,
  };
}

export class HeuristicRouteClassifier implements RouteClassifier {
  async classify(
    _snapshot: EnvironmentSnapshot,
    candidate: CandidateWindow,
  ): Promise<RouteDecision> {
    const scores: Record<RouteOrDiscard, number> = {
      abstract_to_intuitive: 0.05,
      knowledge_gap: 0.05,
      claim_verification: 0.05,
      discard: 0.25,
    };

    if (candidate.signals.containsNumber && candidate.signals.containsUnit) {
      scores.abstract_to_intuitive = candidate.signals.containsVisualCue ? 0.42 : 0.86;
    }
    if (candidate.signals.containsPotentialTerm) scores.knowledge_gap = 0.82;
    if (candidate.signals.containsStrongClaim) scores.claim_verification = 0.88;
    else if (candidate.signals.containsCausalLanguage) scores.claim_verification = 0.58;

    const ordered = (Object.entries(scores) as Array<[RouteOrDiscard, number]>).sort(
      (a, b) => b[1] - a[1],
    );
    const primary = ordered[0] ?? ["discard", 1];
    const secondary = ordered[1];
    const isCandidate = primary[0] !== "discard" && primary[1] >= 0.55;

    return {
      isCandidate,
      primaryRoute: isCandidate ? primary[0] : "discard",
      secondaryRoute:
        isCandidate && secondary && secondary[0] !== "discard" && primary[1] - secondary[1] <= 0.08
          ? (secondary[0] as SupplementRoute)
          : null,
      routeScores: scores,
      confidence: primary[1],
      reason: isCandidate
        ? `根据候选信号路由到 ${primary[0]}`
        : "未发现足以触发链路1的内容",
      evidence: Object.entries(candidate.signals)
        .filter(([, value]) => value)
        .map(([key]) => key),
    };
  }
}
