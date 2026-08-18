import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VideoEnvironmentInput } from "./domain.js";

export function loadVideoEnvironmentFile(path: string): VideoEnvironmentInput {
  const absolutePath = resolve(path);
  const parsed: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
  const normalized = normalizeVideoEnvironmentInput(parsed);
  assertVideoEnvironmentInput(normalized, absolutePath);
  return normalized;
}

export function normalizeVideoEnvironmentInput(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== "video-environment.v1") return value;
  const video = value.video;
  if (!isRecord(video)) throw new TypeError("VideoEnvironmentV1.video must be an object");
  const keyframes = Array.isArray(value.keyframes) ? value.keyframes : [];
  return {
    videoId: video.id,
    videoHash: video.hash,
    title: video.title,
    durationMs: video.durationMs,
    sourceVideoUrl: video.sourcePath,
    asrSegments: value.asrSegments,
    ocrSegments: value.ocrSegments,
    semanticSegments: value.semanticSegments,
    visualContext: keyframes.filter(isRecord).map((frame) => ({
      id: frame.id,
      startMs: frame.timestampMs,
      endMs: typeof frame.timestampMs === "number" ? frame.timestampMs + 1000 : frame.timestampMs,
      description:
        Array.isArray(frame.ocrText) && frame.ocrText.length
          ? `关键帧画面文字：${frame.ocrText.join(" | ")}`
          : "候选区间的局部视觉证据",
      ocrText: frame.ocrText,
      containsScaleVisualization: frame.containsScaleVisualization,
      containsChartOrSource: frame.containsChartOrSource,
      containsSimulation: frame.containsSimulation,
      imagePath: frame.path,
      evidenceKinds: [
        ...(frame.containsScaleVisualization === true ? ["scale"] : []),
        ...(frame.containsChartOrSource === true ? ["chart_or_source"] : []),
        ...(frame.containsSimulation === true ? ["simulation"] : []),
      ],
    })),
    metadata: {
      schemaVersion: value.schemaVersion,
      diagnostics: value.diagnostics,
      analysisChunks: value.analysisChunks,
      keyframes: value.keyframes,
    },
  };
}

export function assertVideoEnvironmentInput(
  value: unknown,
  source = "VideoEnvironmentInput",
): asserts value is VideoEnvironmentInput {
  if (!isRecord(value)) throw new TypeError(`${source} must be a JSON object`);
  requireText(value, "videoId", source);
  requireText(value, "videoHash", source);
  requireText(value, "title", source);
  requireText(value, "sourceVideoUrl", source);
  requireNonNegativeNumber(value, "durationMs", source);

  const asrSegments = requireArray(value, "asrSegments", source);
  const ocrSegments = requireArray(value, "ocrSegments", source);
  const visualContext = requireArray(value, "visualContext", source);
  const semanticSegments = requireArray(value, "semanticSegments", source);
  asrSegments.forEach((segment, index) => assertTimedText(segment, `${source}.asrSegments[${index}]`));
  ocrSegments.forEach((segment, index) => assertTimedText(segment, `${source}.ocrSegments[${index}]`));
  visualContext.forEach((segment, index) => {
    const label = `${source}.visualContext[${index}]`;
    if (!isRecord(segment)) throw new TypeError(`${label} must be an object`);
    requireText(segment, "id", label);
    requireNonNegativeNumber(segment, "startMs", label);
    requireNonNegativeNumber(segment, "endMs", label);
    requireText(segment, "description", label);
    assertTimeOrder(segment, label);
  });
  semanticSegments.forEach((segment, index) => {
    const label = `${source}.semanticSegments[${index}]`;
    assertTimedText(segment, label);
    const ids = requireArray(segment as Record<string, unknown>, "asrSegmentIds", label);
    if (ids.some((id) => typeof id !== "string" || !id.trim())) {
      throw new TypeError(`${label}.asrSegmentIds must contain non-empty strings`);
    }
  });
  if (asrSegments.length === 0) {
    throw new TypeError(`${source}.asrSegments must not be empty`);
  }
  if (semanticSegments.length === 0) {
    throw new TypeError(`${source}.semanticSegments must not be empty`);
  }
}

function assertTimedText(value: unknown, label: string): void {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  requireText(value, "id", label);
  requireText(value, "text", label);
  requireNonNegativeNumber(value, "startMs", label);
  requireNonNegativeNumber(value, "endMs", label);
  assertTimeOrder(value, label);
}

function assertTimeOrder(value: Record<string, unknown>, label: string): void {
  if ((value.endMs as number) < (value.startMs as number)) {
    throw new TypeError(`${label}.endMs must be greater than or equal to startMs`);
  }
}

function requireText(value: Record<string, unknown>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) {
    throw new TypeError(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

function requireNonNegativeNumber(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field) || field < 0) {
    throw new TypeError(`${label}.${key} must be a non-negative number`);
  }
  return field;
}

function requireArray(value: Record<string, unknown>, key: string, label: string): unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new TypeError(`${label}.${key} must be an array`);
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
