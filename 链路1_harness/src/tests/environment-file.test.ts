import test from "node:test";
import assert from "node:assert/strict";
import type { VideoEnvironmentInput } from "../domain.js";
import { assertVideoEnvironmentInput, normalizeVideoEnvironmentInput } from "../environment-file.js";

function validEnvironment(): Record<string, unknown> {
  return {
    videoId: "video-1",
    videoHash: "abc123",
    title: "测试视频",
    durationMs: 12000,
    sourceVideoUrl: "/videos/video-1.mp4",
    asrSegments: [{ id: "asr-1", startMs: 0, endMs: 5000, text: "65℃的热水" }],
    ocrSegments: [],
    visualContext: [],
    semanticSegments: [
      {
        id: "semantic-1",
        startMs: 0,
        endMs: 5000,
        text: "65℃的热水",
        asrSegmentIds: ["asr-1"],
      },
    ],
  };
}

test("accepts a preprocessed ASR-first video environment", () => {
  const value = validEnvironment();
  assert.doesNotThrow(() => assertVideoEnvironmentInput(value));
});

test("rejects an environment without timestamped ASR", () => {
  const value = validEnvironment();
  value.asrSegments = [];
  assert.throws(() => assertVideoEnvironmentInput(value), /asrSegments must not be empty/);
});

test("normalizes VideoEnvironmentV1 and preserves local visual evidence", () => {
  const normalized = normalizeVideoEnvironmentInput({
    schemaVersion: "video-environment.v1",
    video: {
      id: "video-1",
      hash: "hash",
      title: "测试",
      durationMs: 120000,
      sourcePath: "/videos/video-1.mp4",
    },
    asrSegments: [{ id: "asr-1", startMs: 0, endMs: 1000, text: "65℃" }],
    ocrSegments: [],
    semanticSegments: [{
      id: "semantic-1",
      startMs: 0,
      endMs: 1000,
      text: "65℃",
      asrSegmentIds: ["asr-1"],
      keyframeIds: ["keyframe-1"],
    }],
    keyframes: [{
      id: "keyframe-1",
      timestampMs: 500,
      path: "/frames/1.jpg",
      ocrText: ["温度刻度"],
      containsScaleVisualization: true,
    }],
    analysisChunks: [],
    diagnostics: {},
  });
  assertVideoEnvironmentInput(normalized);
  const environment = normalized as VideoEnvironmentInput;
  assert.equal(environment.visualContext[0]?.imagePath, "/frames/1.jpg");
  assert.deepEqual(environment.visualContext[0]?.evidenceKinds, ["scale"]);
});
