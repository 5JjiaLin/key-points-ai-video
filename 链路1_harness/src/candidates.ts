import type { CandidateWindow, EnvironmentSnapshot, SemanticSegment } from "./domain.js";

const NUMBER_RE = /\d+(?:\.\d+)?|[一二三四五六七八九十百千万亿兆]+/;
const UNIT_RE = /(℃|度|伏|V(?![A-Za-z])|安|A(?!类)|瓦|W|米|公里|光年|秒|分钟|小时|年|%|倍|元|万元|亿元|万亿元|万亿|公斤|克|焦耳)/i;
const TERM_RE = /(紊乱|抵抗|反应|机制|受体|致癌物|GDP|CPI|ROI|IARC|板块|流动性|应激|黏膜|摄政|荫封|察举制|做空|冷启动)/i;
const STRONG_CLAIM_RE = /(一定|必然|绝对|完全|都是|就是不|只要.*就|等同于|等于|彻底|百分之百|永远|从来不会)/;
const CAUSAL_RE = /(导致|引发|造成|所以|因此|意味着|证明了|说明了)/;
const VISUAL_CUE_RE = /(这是|像这样|如图|画面里|模拟出来|放在现实里|你看到的|能够装下|平铺满|叠起来)/;

function contextText(segments: SemanticSegment[], index: number, direction: -1 | 1): string {
  const target = segments[index + direction];
  return target?.text ?? "";
}

export function buildCandidateWindows(snapshot: EnvironmentSnapshot): CandidateWindow[] {
  return snapshot.semanticSegments.map((segment, index, all) => {
    const visualContext = snapshot.visualContext.filter(
      (item) => item.endMs >= segment.startMs - 2000 && item.startMs <= segment.endMs + 15000,
    );
    const ocrText = snapshot.ocrSegments
      .filter((item) => item.endMs >= segment.startMs && item.startMs <= segment.endMs)
      .map((item) => item.text);
    const combined = segment.text;

    return {
      id: `candidate_${segment.id}`,
      videoId: snapshot.videoId,
      sourceText: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      segmentIds: [segment.id, ...segment.asrSegmentIds, ...(segment.ocrSegmentIds ?? [])],
      contextBefore: contextText(all, index, -1),
      contextAfter: contextText(all, index, 1),
      ocrText,
      visualContext,
      signals: {
        containsNumber: NUMBER_RE.test(combined),
        containsUnit: UNIT_RE.test(combined),
        containsPotentialTerm: TERM_RE.test(combined),
        containsStrongClaim: STRONG_CLAIM_RE.test(combined),
        containsCausalLanguage: CAUSAL_RE.test(combined),
        containsVisualCue: VISUAL_CUE_RE.test(combined),
      },
    };
  });
}
