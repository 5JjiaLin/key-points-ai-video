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
import { gradeContent, gradeVisual, type VisualSemanticInspector } from "./graders.js";
import { arbitrateCandidates } from "./arbiter.js";
import { JsonlTraceStore, type TraceStore } from "./trace.js";
import type { FullCardImageTool } from "./image/tool.js";

export interface Chain1HarnessDependencies {
  config: Chain1HarnessConfig;
  routeClassifier: RouteClassifier;
  skills: SkillRegistry;
  imageTool: FullCardImageTool;
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
    const batchDecisions = batchClassifier
      ? await batchClassifier.classifyBatch(snapshot, candidates)
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
      ? selectSkillCandidateIds(candidates, batchDecisions, 2)
      : undefined;

    for (const candidate of candidates) {
      const routeStarted = Date.now();
      const decision = batchDecisions?.get(candidate.id) ??
        await this.deps.routeClassifier.classify(snapshot, candidate);
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
        const skillInput = {
          runId: task.runId,
          snapshotId: snapshot.snapshotId,
          video: {
            videoId: snapshot.videoId,
            title: snapshot.title,
            ...(snapshot.description ? { description: snapshot.description } : {}),
            durationMs: snapshot.durationMs,
          },
          candidate,
          routeDecision: decision,
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
            const grade = gradeContent(item);
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
      if (candidate.decision.displayMode === "pending_review") {
        suppressed.push(toSuppressed(candidate, "等待人工复核"));
        continue;
      }
      if (candidate.route === "claim_verification") {
        supplements.push(toFinal(candidate, "verification_template"));
        continue;
      }

      if (!this.deps.config.image.enabled) {
        visualFallbacks += 1;
        supplements.push(toFinal(candidate, "text_fallback"));
        continue;
      }

      const visualResult = await this.generateAndGradeVisual(task.runId, snapshot, candidate, trace);
      if (visualResult.asset) {
        visualPassed += 1;
        supplements.push(
          toFinal(candidate, "full_generated_image", visualResult.asset.publicUrl),
        );
      } else {
        visualFallbacks += 1;
        supplements.push(toFinal(candidate, "text_fallback"));
      }
    }

    const status = visualFallbacks > 0 ? "ready_with_fallbacks" : "ready";
    return {
      runId: task.runId,
      snapshotId: snapshot.snapshotId,
      videoId: snapshot.videoId,
      status,
      supplements,
      suppressed,
      graderSummary: { contentPassed, contentFailed, visualPassed, visualFallbacks },
      tracePath: trace.path,
    };
  }

  private async generateAndGradeVisual(
    runId: string,
    snapshot: EnvironmentSnapshot,
    candidate: UnifiedSupplementCandidate,
    trace: TraceStore,
  ): Promise<{ asset?: Awaited<ReturnType<FullCardImageTool["generate"]>>; grade: GraderResult }> {
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
}

export function selectSkillCandidateIds(
  candidates: Array<{ id: string; startMs: number }>,
  decisions: Map<string, RouteDecision>,
  maximumPerRoute: number,
): Set<string> {
  const selected = new Set<string>();
  const routes: SupplementRoute[] = ["abstract_to_intuitive", "knowledge_gap", "claim_verification"];
  for (const route of routes) {
    candidates
      .map((candidate) => ({ candidate, decision: decisions.get(candidate.id) }))
      .filter(
        (item): item is { candidate: { id: string; startMs: number }; decision: RouteDecision } =>
          Boolean(item.decision?.isCandidate && item.decision.primaryRoute === route),
      )
      .sort(
        (a, b) =>
          (b.decision.routeScores[route] ?? b.decision.confidence) -
            (a.decision.routeScores[route] ?? a.decision.confidence) ||
          a.candidate.startMs - b.candidate.startMs,
      )
      .slice(0, maximumPerRoute)
      .forEach((item) => selected.add(item.candidate.id));
  }
  return selected;
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
    ...(candidate.content.detail !== undefined ? { detail: candidate.content.detail } : {}),
    renderMode,
    ...(cardImageUrl ? { cardImageUrl, cardWidth: 310, cardHeight: 180 } : {}),
    provenance: candidate.provenance,
  };
}
