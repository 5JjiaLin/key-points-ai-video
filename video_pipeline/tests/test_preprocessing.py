from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from video_pipeline import (
    PreprocessingConfig,
    VideoSource,
    build_analysis_chunks,
    build_semantic_segments,
    preprocess_video,
    select_ocr_timestamps_by_chunk,
    validate_environment,
)
from video_pipeline.preprocessing import (
    _budget_chunk_keyframes,
    _detect_ocr_engine,
    _normalize_asr_segments,
)
from video_pipeline.preprocessing import to_simplified_chinese


class FakeTranscriber:
    def transcribe(self, _audio_path: Path):
        return (
            [
                {"id": "asr-0001", "startMs": 0, "endMs": 4000, "text": "65℃已经明显烫口。"},
                {"id": "asr-0002", "startMs": 5000, "endMs": 10000, "text": "如圖可以看到溫度刻度。"},
            ],
            {"status": "ok", "engine": "fake", "language": "zh"},
        )


class SharedPreprocessingTests(unittest.TestCase):
    def test_linux_uses_tesseract_when_swift_vision_is_unavailable(self) -> None:
        with patch("video_pipeline.preprocessing.shutil.which") as which:
            which.side_effect = lambda command: "/usr/bin/tesseract" if command == "tesseract" else None
            self.assertEqual(_detect_ocr_engine(Path("vision_ocr.swift")), "tesseract")

    def test_traditional_chinese_is_normalized_to_simplified(self) -> None:
        simplified = to_simplified_chinese("這是資產與廣義貨幣，裝著現金，什麼概念")
        self.assertEqual(simplified, "这是资产与广义货币，装着现金，什么概念")
        self.assertEqual(to_simplified_chinese(simplified), simplified)

    def test_word_timestamps_are_split_into_short_asr_segments(self) -> None:
        raw = SimpleNamespace(
            start=0.0,
            end=10.0,
            text="一张100块就像薄薄一层，而这是100万。",
            words=[
                SimpleNamespace(start=0.0, end=1.5, word="一张100块就像薄薄一层，", probability=0.9),
                SimpleNamespace(start=1.5, end=4.0, word="而这是100万。", probability=0.8),
            ],
        )
        segments = _normalize_asr_segments([raw], max_seconds=8, max_chars=50)
        self.assertEqual([item["text"] for item in segments], ["一张100块就像薄薄一层，", "而这是100万。"])
        self.assertEqual([item["id"] for item in segments], ["asr-0001", "asr-0002"])
        self.assertEqual(segments[0]["endMs"], 1500)

    def test_known_video_durations_create_expected_chunks(self) -> None:
        short = build_analysis_chunks(duration_seconds=138.025, chunk_seconds=240, overlap_seconds=12)
        long = build_analysis_chunks(duration_seconds=732.330, chunk_seconds=240, overlap_seconds=12)
        self.assertEqual(len(short), 1)
        self.assertEqual(len(long), 4)
        self.assertEqual(long[1]["startMs"], 228000)
        self.assertEqual(long[-1]["endMs"], 732330)

    def test_semantic_segments_keep_asr_provenance(self) -> None:
        segments = build_semantic_segments(
            [
                {"id": "asr-1", "startMs": 0, "endMs": 2000, "text": "这是第一句。"},
                {"id": "asr-2", "startMs": 2500, "endMs": 5000, "text": "这是第二句。"},
            ],
            max_seconds=24,
            max_chars=180,
        )
        self.assertEqual(segments[0]["asrSegmentIds"], ["asr-1"])

    def test_ocr_schedule_has_guard_frames_and_chunk_budget(self) -> None:
        chunks = build_analysis_chunks(duration_seconds=732.33, chunk_seconds=240, overlap_seconds=12)
        timestamps = select_ocr_timestamps_by_chunk(
            semantic_segments=[
                {"startMs": 10000, "endMs": 20000, "text": "65℃是什么概念"},
                {"startMs": 500000, "endMs": 510000, "text": "成瘾一定都能戒掉吗"},
            ],
            analysis_chunks=chunks,
            scene_timestamps=[45.0, 300.0, 600.0],
            periodic_seconds=60,
            frames_per_chunk=8,
        )
        self.assertIn(15.0, timestamps)
        self.assertIn(505.0, timestamps)
        self.assertLessEqual(len(timestamps), len(chunks) * 8)
        self.assertTrue(any(abs(value - 2.0) < 0.01 for value in timestamps))
        self.assertTrue(all(abs(a - b) >= 2 for a, b in zip(timestamps, timestamps[1:])))

    def test_overlap_cannot_expand_chunk_keyframes_past_budget(self) -> None:
        frames = [
            {
                "id": f"frame-{index}",
                "timestampMs": index * 1000,
                "ocrText": ["55万亿"] if index == 8 else [],
            }
            for index in range(10)
        ]
        selected = _budget_chunk_keyframes(frames, 8)
        self.assertEqual(len(selected), 8)
        self.assertIn("frame-8", [item["id"] for item in selected])

    def test_preprocess_writes_video_environment_v1(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            video.write_bytes(b"video")
            stale_keyframe = root / "out" / "keyframes" / "keyframe-stale.jpg"
            stale_keyframe.parent.mkdir(parents=True)
            stale_keyframe.write_bytes(b"stale")
            with patch(
                "video_pipeline.preprocessing._probe_video",
                return_value={"durationSeconds": 120.0, "sizeBytes": 5, "streams": []},
            ), patch("video_pipeline.preprocessing._extract_audio"), patch(
                "video_pipeline.preprocessing._sha256", return_value="hash"
            ):
                result = preprocess_video(
                    source=VideoSource(video_id="video-1", path=video, title="温度测试"),
                    out_dir=root / "out",
                    config=PreprocessingConfig(ocr_enabled=False),
                    transcriber=FakeTranscriber(),
                )
            environment = json.loads(Path(result["environmentPath"]).read_text(encoding="utf-8"))
            validate_environment(environment)
            self.assertEqual(environment["schemaVersion"], "video-environment.v1")
            self.assertEqual(environment["diagnostics"]["pipelineVersion"], "shared-evidence-v1")
            self.assertEqual(environment["video"]["durationMs"], 120000)
            self.assertEqual(environment["semanticSegments"][1]["text"], "如图可以看到温度刻度。")
            self.assertEqual(environment["diagnostics"]["asr"]["textScript"], "simplified_chinese")
            self.assertFalse(stale_keyframe.exists())


if __name__ == "__main__":
    unittest.main()
