import type {
  Chain1HarnessResult,
  SuppressedCandidate,
  UnifiedSupplementCandidate,
} from "./domain.js";
import type { Chain1HarnessConfig } from "./config.js";

export interface ArbitrationResult {
  selected: UnifiedSupplementCandidate[];
  suppressed: SuppressedCandidate[];
}

function overlaps(
  a: UnifiedSupplementCandidate,
  b: UnifiedSupplementCandidate,
  windowMs: number,
): boolean {
  return (
    a.source.startMs <= b.source.endMs + windowMs &&
    b.source.startMs <= a.source.endMs + windowMs
  );
}

export function arbitrateCandidates(
  candidates: UnifiedSupplementCandidate[],
  config: Chain1HarnessConfig,
): ArbitrationResult {
  const viable = candidates
    .filter((item) => item.decision.displayMode !== "suppressed")
    .sort((a, b) => b.decision.globalPriority - a.decision.globalPriority);
  const selected: UnifiedSupplementCandidate[] = [];
  const suppressed: SuppressedCandidate[] = candidates
    .filter((item) => item.decision.displayMode === "suppressed")
    .map((item) => ({
      id: item.id,
      route: item.route,
      sourceText: item.source.text,
      startMs: item.source.startMs,
      endMs: item.source.endMs,
      reason: item.decision.reasons.join("；") || "Skill判定抑制",
    }));

  for (const candidate of viable) {
    const conflict = selected.find((item) =>
      overlaps(item, candidate, config.arbitration.overlapWindowMs),
    );
    if (conflict) {
      suppressed.push({
        id: candidate.id,
        route: candidate.route,
        sourceText: candidate.source.text,
        startMs: candidate.source.startMs,
        endMs: candidate.source.endMs,
        reason: `与 ${conflict.id} 时间重叠，保留全局优先级更高的候选`,
      });
      continue;
    }
    selected.push(candidate);
  }

  selected.sort((a, b) => a.trigger.triggerAtMs - b.trigger.triggerAtMs);
  const scheduled: UnifiedSupplementCandidate[] = [];
  for (const candidate of selected) {
    const recent = scheduled.filter(
      (item) => candidate.trigger.triggerAtMs - item.trigger.triggerAtMs < 60000,
    );
    const last = scheduled.at(-1);
    const tooClose =
      last &&
      candidate.trigger.triggerAtMs - last.trigger.triggerAtMs <
        config.arbitration.minimumPromptIntervalMs;
    const tooMany = recent.length >= config.arbitration.maximumPromptsPerMinute;

    if (candidate.decision.displayMode === "auto_prompt" && (tooClose || tooMany)) {
      candidate.decision.displayMode = "list_only";
      candidate.decision.reasons.push(tooClose ? "提示间隔过近，降级为列表" : "每分钟提示过多，降级为列表");
    }
    scheduled.push(candidate);
  }

  return { selected: scheduled, suppressed };
}

export function countFallbacks(result: Chain1HarnessResult): number {
  return result.supplements.filter((item) => item.renderMode === "text_fallback").length;
}
