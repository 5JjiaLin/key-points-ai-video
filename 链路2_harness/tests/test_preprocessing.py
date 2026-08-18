from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from huazhongdian_harness.models import ManifestCase
from huazhongdian_harness.preprocessing import (
    PreprocessingConfig,
    build_analysis_chunks,
    build_semantic_segments,
    preprocess_case,
    select_ocr_timestamps,
)


class FakeTranscriber:
    def transcribe(self, audio_path: Path):
        return (
            [
                {"id": "asr-0001", "startMs": 0, "endMs": 4000, "text": "65℃的热水已经明显烫口。"},
                {
                    "id": "asr-0002",
                    "startMs": 5000,
                    "endMs": 10000,
                    "text": "如图可以看到温度刻度。",
                },
            ],
            {"engine": "fake", "language": "zh"},
        )


class PreprocessingTests(unittest.TestCase):
    def test_long_video_chunks_have_overlap_and_cover_the_tail(self) -> None:
        chunks = build_analysis_chunks(
            duration_seconds=732.3,
            chunk_seconds=240,
            overlap_seconds=12,
        )
        self.assertEqual(len(chunks), 4)
        self.assertEqual(chunks[0]["startMs"], 0)
        self.assertEqual(chunks[1]["startMs"], 228000)
        self.assertEqual(chunks[-1]["endMs"], 732300)

    def test_semantic_segments_keep_asr_provenance(self) -> None:
        segments = build_semantic_segments(
            [
                {"id": "asr-1", "startMs": 0, "endMs": 2000, "text": "这是第一句。"},
                {"id": "asr-2", "startMs": 2500, "endMs": 5000, "text": "这是第二句。"},
            ],
            max_seconds=24,
            max_chars=180,
        )
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["asrSegmentIds"], ["asr-1"])

    def test_ocr_selection_prioritizes_numbers_and_visual_cues(self) -> None:
        timestamps = select_ocr_timestamps(
            semantic_segments=[
                {"startMs": 10000, "endMs": 20000, "text": "65℃是什么概念"},
                {"startMs": 30000, "endMs": 40000, "text": "这里只是普通叙述"},
            ],
            duration_seconds=120,
            periodic_seconds=60,
            scene_timestamps=[45.0],
            max_frames=4,
        )
        self.assertIn(15.0, timestamps)
        self.assertIn(45.0, timestamps)

    def test_preprocess_case_writes_both_chain_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            video.write_bytes(b"video")
            case = ManifestCase(
                case_id="case-1",
                video_id="video-1",
                video_path=video,
                title="温度测试",
                duration_seconds=120,
                language="zh-CN",
            )
            config = PreprocessingConfig(ocr_enabled=False)
            with patch(
                "video_pipeline.preprocessing._probe_video",
                return_value={"durationSeconds": 120.0, "sizeBytes": 5, "streams": []},
            ), patch("video_pipeline.preprocessing._extract_audio") as extract_audio, patch(
                "video_pipeline.preprocessing._sha256", return_value="hash"
            ):
                result = preprocess_case(
                    case=case,
                    out_dir=root / "out",
                    config=config,
                    transcriber=FakeTranscriber(),
                )

            extract_audio.assert_called_once()
            environment = json.loads(Path(result["environmentPath"]).read_text(encoding="utf-8"))
            transcript = Path(result["transcriptPath"]).read_text(encoding="utf-8")
            self.assertEqual(environment["schemaVersion"], "video-environment.v1")
            self.assertEqual(environment["diagnostics"]["pipelineVersion"], "shared-evidence-v1")
            self.assertEqual(len(environment["asrSegments"]), 2)
            self.assertIn("65℃", transcript)


if __name__ == "__main__":
    unittest.main()
