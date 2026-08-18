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
): boolean {
  return (
    a.source.startMs < b.source.endMs &&
    b.source.startMs < a.source.endMs
  );
}

export function arbitrateCandidates(
  candidates: UnifiedSupplementCandidate[],
  _config: Chain1HarnessConfig,
): ArbitrationResult {
  const viable = candidates
    .filter((item) => item.decision.displayMode === "auto_prompt")
    .sort((a, b) => b.decision.globalPriority - a.decision.globalPriority);
  const selected: UnifiedSupplementCandidate[] = [];
  const suppressed: SuppressedCandidate[] = candidates
    .filter((item) => item.decision.displayMode !== "auto_prompt")
    .map((item) => ({
      id: item.id,
      route: item.route,
      sourceText: item.source.text,
      startMs: item.source.startMs,
      endMs: item.source.endMs,
      reason:
        item.decision.displayMode === "pending_review"
          ? "等待人工复核"
          : item.decision.displayMode === "list_only"
            ? "链路1无列表入口，仅展示自动轻提示"
            : item.decision.reasons.join("；") || "Skill判定抑制",
    }));

  for (const candidate of viable) {
    const conflict = selected.find((item) => overlaps(item, candidate));
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
  return { selected, suppressed };
}

export function countFallbacks(result: Chain1HarnessResult): number {
  return result.supplements.filter((item) => item.renderMode === "text_fallback").length;
}
