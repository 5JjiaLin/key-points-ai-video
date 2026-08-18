import type { Chain1HarnessConfig } from "./config.js";
import { buildCandidateWindows } from "./candidates.js";
import { freezeEnvironment } from "./environment.js";
import { createChain1Task } from "./task.js";
import type {
  Chain1HarnessResult,
  EnvironmentSnapshot,
  FinalSupplement,
  GraderResult,
  RouteDecision,
  SuppressedCandidate,
  SupplementRoute,
  UnifiedSupplementCandidate,
  VideoEnvironmentInput,
} from "./domain.js";
import type { BatchRouteClassifier, RouteClassifier } from "./router.js";
import type { SkillRegistry } from "./skills.js";
import { adaptSkillOutput, runSkill } from "./skills.js";
import { gradeContent, gradeHintSticker, gradeVisual, type VisualSemanticInspector } from "./graders.js";
import { arbitrateCandidates } from "./arbiter.js";
import { JsonlTraceStore, type TraceStore } from "./trace.js";
import type { Chain1ImageTool } from "./image/tool.js";

export interface Chain1HarnessDependencies {
  config: Chain1HarnessConfig;
  routeClassifier: RouteClassifier;
  skills: SkillRegistry;
  imageTool: Chain1ImageTool;
  visualSemanticInspector?: VisualSemanticInspector;
  createTraceStore?: (runId: string) => TraceStore;
  modelVersions?: Record<string, string>;
}

export class Chain1Harness {
  constructor(private readonly deps: Chain1HarnessDependencies) {}

  async run(input: VideoEnvironmentInput): Promise<Chain1HarnessResult> {
    const task = createChain1Task();
    const snapshot = freezeEnvironment(input, this.deps.config, this.deps.modelVersions);
    const trace = this.deps.createTraceStore?.(task.runId) ??
      new JsonlTraceStore(this.deps.config.traceDirectory, task.runId);
    const suppressed: SuppressedCandidate[] = [];
    const normalized: UnifiedSupplementCandidate[] = [];
    let contentPassed = 0;
    let contentFailed = 0;
    let visualPassed = 0;
    let visualFallbacks = 0;
    let hintStickerPassed = 0;
    let hintStickerFallbacks = 0;
    let routeFallbacks = 0;

    await trace.append({
      runId: task.runId,
      snapshotId: snapshot.snapshotId,
      timestamp: new Date().toISOString(),
      step: "task_and_environment",
      status: "completed",
      output: { task, snapshotId: snapshot.snapshotId },
    });

    const candidates = buildCandidateWindows(snapshot);
    const batchClassifier = isBatchRouteClassifier(this.deps.routeClassifier)
      ? this.deps.routeClassifier
      : undefined;
    const batchStarted = Date.now();
    const rawBatchDecisions = batchClassifier
      ? await batchClassifier.classifyBatch(snapshot, candidates)
      : undefined;
    const batchDecisions = rawBatchDecisions
      ? new Map(
          [...rawBatchDecisions].map(([candidateId, decision]) => [
            candidateId,
            enforceRouteDecision(
              decision,
              this.deps.config,
              candidates.find((candidate) => candidate.id === candidateId),
            ),
          ]),
        )
      : undefined;
    if (batchDecisions) {
      await trace.append({
        runId: task.runId,
        snapshotId: snapshot.snapshotId,
        timestamp: new Date().toISOString(),
        step: "route_classifier_batch",
        status: "completed",
        durationMs: Date.now() - batchStarted,
        output: Object.fromEntries(batchDecisions),
      });
    }
    const skillCandidateIds = batchDecisions
      ? selectSkillCandidateIds(candidates, batchDecisions)
      : undefined;

    for (const candidate of candidates) {
      const routeStarted = Date.now();
      const decision = batchDecisions?.get(candidate.id) ??
        enforceRouteDecision(
          await this.deps.routeClassifier.classify(snapshot, candidate),
          this.deps.config,
          candidate,
        );
      if (decision.reason.includes("回退")) routeFallbacks += 1;
      await trace.append({
        runId: task.runId,
        snapshotId: snapshot.snapshotId,
        candidateId: candidate.id,
        timestamp: new Date().toISOString(),
        step: "route_classifier",
        status: "completed",
        durationMs: Date.now() - routeStarted,
        input: candidate,
        output: decision,
      });

      if (!decision.isCandidate || decision.primaryRoute === "discard") {
        suppressed.push({
          id: candidate.id,
          sourceText: candidate.sourceText,
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          reason: decision.reason,
        });
        continue;
      }
      if (skillCandidateIds && !skillCandidateIds.has(candidate.id)) {
        suppressed.push({
          id: candidate.id,
          sourceText: candidate.sourceText,
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          reason: "同路由已有更高优先级候选，未占用远程 Skill 额度",
        });
        continue;
      }

      const routes = selectRoutes(decision.primaryRoute, decision.secondaryRoute, this.deps.config);
      for (const route of routes) {
        const routeCandidate = candidateEvidenceForRoute(candidate, route);
        const skillInput = {
          runId: task.runId,
          snapshotId: snapshot.snapshotId,
          video: {
            videoId: snapshot.videoId,
            title: snapshot.title,
            ...(snapshot.description ? { description: snapshot.description } : {}),
            durationMs: snapshot.durationMs,
          },
          candidate: routeCandidate,
          routeDecision: decision,
          activeRoute: route,
        };
        try {
          const execution = await runSkill(
            this.deps.skills,
            route,
            skillInput,
            skillVersion(snapshot, route),
          );
          await trace.append({
            runId: task.runId,
            snapshotId: snapshot.snapshotId,
            candidateId: candidate.id,
            timestamp: new Date().toISOString(),
            step: `skill_${route}`,
            status: "completed",
            durationMs: execution.durationMs,
            output: execution.rawOutput,
          });

          for (const item of adaptSkillOutput(execution, skillInput)) {
            const grade = gradeContent(item, routeCandidate);
            await trace.append({
              runId: task.runId,
              snapshotId: snapshot.snapshotId,
              candidateId: item.id,
              timestamp: new Date().toISOString(),
              step: "content_grader",
              status: grade.passed ? "completed" : "failed",
              output: grade,
            });
            if (grade.passed) {
              contentPassed += 1;
              normalized.push(item);
            } else {
              contentFailed += 1;
              suppressed.push(toSuppressed(item, `内容审核失败：${grade.errors.join(", ")}`));
            }
          }
        } catch (error) {
          contentFailed += 1;
          await trace.append({
            runId: task.runId,
            snapshotId: snapshot.snapshotId,
            candidateId: candidate.id,
            timestamp: new Date().toISOString(),
            step: `skill_${route}`,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const arbitration = arbitrateCandidates(normalized, this.deps.config);
    suppressed.push(...arbitration.suppressed);
    await trace.append({
      runId: task.runId,
      snapshotId: snapshot.snapshotId,
      timestamp: new Date().toISOString(),
      step: "arbiter",
      status: "completed",
      output: {
        selectedIds: arbitration.selected.map((item) => item.id),
        suppressedIds: arbitration.suppressed.map((item) => item.id),
      },
    });

    const supplements: FinalSupplement[] = [];
    for (const candidate of arbitration.selected) {
      let renderMode: FinalSupplement["renderMode"];
      let cardImageUrl: string | undefined;
      if (candidate.route === "claim_verification") {
        renderMode = "verification_template";
      } else if (!this.deps.config.image.enabled) {
        visualFallbacks += 1;
        renderMode = "text_fallback";
      } else {
        const visualResult = await this.generateAndGradeVisual(task.runId, snapshot, candidate, trace);
        if (visualResult.asset) {
          visualPassed += 1;
          renderMode = "full_generated_image";
          cardImageUrl = visualResult.asset.publicUrl;
        } else {
          visualFallbacks += 1;
          renderMode = "text_fallback";
        }
      }

      let hintStickerImageUrl: string | undefined;
      if (candidate.decision.displayMode === "auto_prompt") {
        if (!this.deps.config.image.enabled || !this.deps.config.image.hintSticker.enabled) {
          hintStickerFallbacks += 1;
        } else {
          const hintStickerResult = await this.generateHintSticker(
            task.runId,
            snapshot,
            candidate,
            trace,
          );
          if (hintStickerResult.asset) {
            hintStickerPassed += 1;
            hintStickerImageUrl = hintStickerResult.asset.publicUrl;
          } else {
            hintStickerFallbacks += 1;
          }
        }
      }
      supplements.push(toFinal(candidate, renderMode, cardImageUrl, hintStickerImageUrl));
    }

    const status = chain1ReadyStatus(
      routeFallbacks,
      contentFailed,
      visualFallbacks,
      hintStickerFallbacks,
    );
    return {
      runId: task.runId,
      snapshotId: snapshot.snapshotId,
      videoId: snapshot.videoId,
      status,
      supplements,
      suppressed,
      graderSummary: {
        contentPassed,
        contentFailed,
        visualPassed,
        visualFallbacks,
        hintStickerPassed,
        hintStickerFallbacks,
      },
      tracePath: trace.path,
    };
  }

  private async generateAndGradeVisual(
    runId: string,
    snapshot: EnvironmentSnapshot,
    candidate: UnifiedSupplementCandidate,
    trace: TraceStore,
  ): Promise<{ asset?: Awaited<ReturnType<Chain1ImageTool["generate"]>>; grade: GraderResult }> {
    let correction: string | undefined;
    let lastGrade: GraderResult = {
      passed: false,
      score: 0,
      errors: ["not_attempted"],
      warnings: [],
    };

    for (let attempt = 1; attempt <= this.deps.config.image.maxAttempts; attempt += 1) {
      try {
        const asset = await this.deps.imageTool.generate({
          runId,
          candidate,
          attempt,
          ...(correction ? { correction } : {}),
        });
        lastGrade = await gradeVisual(candidate, asset, this.deps.visualSemanticInspector);
        await trace.append({
          runId,
          snapshotId: snapshot.snapshotId,
          candidateId: candidate.id,
          timestamp: new Date().toISOString(),
          step: "visual_generation_and_grader",
          status: lastGrade.passed ? "completed" : "failed",
          output: { attempt, asset, grade: lastGrade },
        });
        if (lastGrade.passed) return { asset, grade: lastGrade };
        correction =
          lastGrade.retryInstruction ??
          `修复以下问题：${[...lastGrade.errors, ...lastGrade.warnings].join("；")}`;
      } catch (error) {
        lastGrade = {
          passed: false,
          score: 0,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        };
        correction = lastGrade.errors.join("；");
        await trace.append({
          runId,
          snapshotId: snapshot.snapshotId,
          candidateId: candidate.id,
          timestamp: new Date().toISOString(),
          step: "visual_generation_and_grader",
          status: "failed",
          output: { attempt },
          error: correction,
        });
      }
    }
    return { grade: lastGrade };
  }

  private async generateHintSticker(
    runId: string,
    snapshot: EnvironmentSnapshot,
    candidate: UnifiedSupplementCandidate,
    trace: TraceStore,
  ): Promise<{ asset?: Awaited<ReturnType<Chain1ImageTool["generateHintSticker"]>>; grade: GraderResult }> {
    let correction: string | undefined;
    let lastGrade: GraderResult = {
      passed: false,
      score: 0,
      errors: ["not_attempted"],
      warnings: [],
    };
    for (let attempt = 1; attempt <= this.deps.config.image.hintSticker.maxAttempts; attempt += 1) {
      try {
        const asset = await this.deps.imageTool.generateHintSticker({
          runId,
          candidate,
          attempt,
          ...(correction ? { correction } : {}),
        });
        lastGrade = gradeHintSticker(asset);
        await trace.append({
          runId,
          snapshotId: snapshot.snapshotId,
          candidateId: candidate.id,
          timestamp: new Date().toISOString(),
          step: "hint_sticker_generation_and_grader",
          status: lastGrade.passed ? "completed" : "failed",
          output: { attempt, asset, grade: lastGrade },
        });
        if (lastGrade.passed) return { asset, grade: lastGrade };
        correction = `修复以下问题：${lastGrade.errors.join("；")}`;
      } catch (error) {
        lastGrade = {
          passed: false,
          score: 0,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        };
        correction = lastGrade.errors.join("；");
        await trace.append({
          runId,
          snapshotId: snapshot.snapshotId,
          candidateId: candidate.id,
          timestamp: new Date().toISOString(),
          step: "hint_sticker_generation_and_grader",
          status: "failed",
          output: { attempt },
          error: correction,
        });
      }
    }
    return { grade: lastGrade };
  }
}

export function chain1ReadyStatus(
  routeFallbacks: number,
  contentFailed: number,
  visualFallbacks: number,
  hintStickerFallbacks = 0,
): "ready" | "ready_with_fallbacks" {
  return routeFallbacks > 0 || contentFailed > 0 || visualFallbacks > 0 || hintStickerFallbacks > 0
    ? "ready_with_fallbacks"
    : "ready";
}

export function selectSkillCandidateIds(
  candidates: Array<{ id: string; startMs: number }>,
  decisions: Map<string, RouteDecision>,
): Set<string> {
  return new Set(
    candidates
      .filter((candidate) => {
        const decision = decisions.get(candidate.id);
        return Boolean(decision?.isCandidate && decision.primaryRoute !== "discard");
      })
      .map((candidate) => candidate.id),
  );
}

export function enforceRouteDecision(
  decision: RouteDecision,
  config: Chain1HarnessConfig,
  candidate?: import("./domain.js").CandidateWindow,
): RouteDecision {
  const primaryScore = decision.routeScores[decision.primaryRoute] ?? decision.confidence;
  const passesPrimary =
    decision.isCandidate &&
    decision.primaryRoute !== "discard" &&
    decision.confidence >= config.route.minimumConfidence &&
    primaryScore >= config.route.minimumConfidence;
  if (!passesPrimary) {
    return {
      ...decision,
      isCandidate: false,
      primaryRoute: "discard",
      secondaryRoute: null,
      reason: `${decision.reason}；未达到路由最低置信度 ${config.route.minimumConfidence}`,
    };
  }

  const primaryRoute = decision.primaryRoute as SupplementRoute;
  if (candidate && !routeSupportedByEvidence(primaryRoute, decision, candidate)) {
    return {
      ...decision,
      isCandidate: false,
      primaryRoute: "discard",
      secondaryRoute: null,
      reason: `${decision.reason}；主路由缺少 ASR 文案证据前提`,
    };
  }

  const secondaryScore = decision.secondaryRoute
    ? decision.routeScores[decision.secondaryRoute]
    : undefined;
  const secondaryRoute =
    config.route.allowSecondaryRoute &&
    decision.secondaryRoute &&
    secondaryScore !== undefined &&
    secondaryScore >= config.route.minimumConfidence &&
    primaryScore - secondaryScore <= config.route.ambiguityDelta &&
    (!candidate || routeSupportedByEvidence(decision.secondaryRoute, decision, candidate))
      ? decision.secondaryRoute
      : null;
  return { ...decision, secondaryRoute };
}

function routeSupportedByEvidence(
  route: SupplementRoute,
  decision: RouteDecision,
  candidate: import("./domain.js").CandidateWindow,
): boolean {
  const evidenceText = candidate.sourceText;
  const hasVerbatimEvidence = decision.evidence.some((item) => {
    const value = item.trim();
    return value.length >= 2 && evidenceText.includes(value);
  });
  if (route === "abstract_to_intuitive") {
    return candidate.signals.containsNumber && candidate.signals.containsUnit;
  }
  if (route === "knowledge_gap") {
    return candidate.signals.containsPotentialTerm || hasVerbatimEvidence;
  }
  return (
    candidate.signals.containsStrongClaim ||
    candidate.signals.containsCausalLanguage ||
    hasVerbatimEvidence
  );
}

export function candidateEvidenceForRoute(
  candidate: import("./domain.js").CandidateWindow,
  route: SupplementRoute,
): import("./domain.js").CandidateWindow {
  if (route === "abstract_to_intuitive") return candidate;
  return {
    ...candidate,
    segmentIds: candidate.segmentIds.filter((id) => !id.startsWith("ocr-")),
    ocrText: [],
    visualContext: [],
  };
}

function isBatchRouteClassifier(value: RouteClassifier): value is BatchRouteClassifier {
  return "classifyBatch" in value && typeof value.classifyBatch === "function";
}

function selectRoutes(
  primary: SupplementRoute,
  secondary: SupplementRoute | null | undefined,
  config: Chain1HarnessConfig,
): SupplementRoute[] {
  if (!config.route.allowSecondaryRoute || !secondary || secondary === primary) return [primary];
  return [primary, secondary];
}

function skillVersion(snapshot: EnvironmentSnapshot, route: SupplementRoute): string {
  if (route === "abstract_to_intuitive") return snapshot.skillVersions.abstractToIntuitive;
  if (route === "knowledge_gap") return snapshot.skillVersions.knowledgeGap;
  return snapshot.skillVersions.claimVerification;
}

function toSuppressed(candidate: UnifiedSupplementCandidate, reason: string): SuppressedCandidate {
  return {
    id: candidate.id,
    route: candidate.route,
    sourceText: candidate.source.text,
    startMs: candidate.source.startMs,
    endMs: candidate.source.endMs,
    reason,
  };
}

function toFinal(
  candidate: UnifiedSupplementCandidate,
  renderMode: FinalSupplement["renderMode"],
  cardImageUrl?: string,
  hintStickerImageUrl?: string,
): FinalSupplement {
  return {
    id: candidate.id,
    type: candidate.route,
    sourceText: candidate.source.text,
    startMs: candidate.source.startMs,
    endMs: candidate.source.endMs,
    triggerAtMs: candidate.trigger.triggerAtMs,
    displayMode: candidate.decision.displayMode === "list_only" ? "list_only" : "auto_prompt",
    question: candidate.content.question,
    answer: candidate.content.answer,
    ...(candidate.content.subtitle ? { subtitle: candidate.content.subtitle } : {}),
    ...(candidate.content.answerLabel ? { answerLabel: candidate.content.answerLabel } : {}),
    ...(candidate.content.cardVariant ? { cardVariant: candidate.content.cardVariant } : {}),
    ...(candidate.content.leftColumn ? { leftColumn: candidate.content.leftColumn } : {}),
    ...(candidate.content.rightColumn ? { rightColumn: candidate.content.rightColumn } : {}),
    ...(candidate.content.sourceCount !== undefined ? { sourceCount: candidate.content.sourceCount } : {}),
    ...(candidate.content.sourceAction ? { sourceAction: candidate.content.sourceAction } : {}),
    ...(candidate.content.detail !== undefined ? { detail: candidate.content.detail } : {}),
    renderMode,
    ...(hintStickerImageUrl
      ? { hintStickerImageUrl, hintStickerWidth: 96 as const, hintStickerHeight: 96 as const }
      : {}),
    ...(cardImageUrl ? { cardImageUrl, cardWidth: 310, cardHeight: 180 } : {}),
    provenance: candidate.provenance,
  };
}
