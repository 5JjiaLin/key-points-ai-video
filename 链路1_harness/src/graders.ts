import { spawnSync } from "node:child_process";
import type {
  GeneratedCardAsset,
  GraderResult,
  SupplementRoute,
  UnifiedSupplementCandidate,
} from "./domain.js";

export function gradeContent(candidate: UnifiedSupplementCandidate): GraderResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!candidate.source.text.trim()) errors.push("source_text_empty");
  if (!candidate.content.question.trim()) errors.push("question_empty");
  if (!candidate.content.answer.trim()) errors.push("answer_empty");
  if (candidate.content.question.length > 36) warnings.push("question_too_long");
  if (candidate.content.answer.length > 100) warnings.push("answer_too_long");
  if (candidate.trigger.triggerAtMs < candidate.source.endMs) {
    warnings.push("trigger_before_source_end");
  }

  if (candidate.route === "claim_verification") {
    if (candidate.visual.required) errors.push("claim_verification_must_not_generate_image");
    if (candidate.visual.fullCardPrompt) errors.push("claim_verification_has_image_prompt");
  } else {
    if (!candidate.visual.required) errors.push("visual_route_requires_image");
    if (!candidate.visual.fullCardPrompt?.trim()) errors.push("full_card_prompt_missing");
  }

  if (candidate.route === "abstract_to_intuitive" && !candidate.source.span) {
    warnings.push("abstract_source_span_missing");
  }
  if (candidate.route === "knowledge_gap" && !candidate.source.span) {
    warnings.push("knowledge_gap_source_span_missing");
  }

  const score = Math.max(0, 1 - errors.length * 0.25 - warnings.length * 0.05);
  return { passed: errors.length === 0, score, errors, warnings };
}

export interface VisualSemanticInspector {
  inspect(args: {
    route: SupplementRoute;
    imagePath: string;
    question: string;
    answer: string;
    mustShow: string[];
    mustNotShow: string[];
  }): Promise<GraderResult>;
}

export async function gradeVisual(
  candidate: UnifiedSupplementCandidate,
  asset: GeneratedCardAsset,
  semanticInspector?: VisualSemanticInspector,
): Promise<GraderResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metadata = imageMetadata(asset.localPath);
  if (metadata.width !== 310 || metadata.height !== 180) {
    errors.push(`invalid_dimensions_${metadata.width ?? "?"}x${metadata.height ?? "?"}`);
  }
  if (!metadata.format) errors.push("unknown_image_format");

  const dimensionScore = errors.length ? 0 : 1;
  if (!semanticInspector) {
    warnings.push("semantic_visual_grader_not_configured");
    return {
      passed: errors.length === 0,
      score: Math.max(0, dimensionScore - warnings.length * 0.05),
      errors,
      warnings,
    };
  }

  const semantic = await semanticInspector.inspect({
    route: candidate.route,
    imagePath: asset.localPath,
    question: candidate.content.question,
    answer: candidate.content.answer,
    mustShow: candidate.visual.mustShow ?? [],
    mustNotShow: candidate.visual.mustNotShow ?? [],
  });

  return {
    passed: errors.length === 0 && semantic.passed,
    score: 0.25 * dimensionScore + 0.75 * semantic.score,
    errors: [...errors, ...semantic.errors],
    warnings: [...warnings, ...semantic.warnings],
    ...(semantic.retryInstruction ? { retryInstruction: semantic.retryInstruction } : {}),
  };
}

function imageMetadata(path: string): { width?: number; height?: number; format?: string } {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return {};
  try {
    const decoded = JSON.parse(result.stdout) as {
      streams?: Array<{ width?: number; height?: number; codec_name?: string }>;
    };
    const stream = decoded.streams?.[0];
    return {
      ...(stream?.width !== undefined ? { width: stream.width } : {}),
      ...(stream?.height !== undefined ? { height: stream.height } : {}),
      ...(stream?.codec_name !== undefined ? { format: stream.codec_name } : {}),
    };
  } catch {
    return {};
  }
}
