from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from huazhongdian_harness.ingestion import SidecarVideoIngestionProvider
from huazhongdian_harness.manifest import read_manifest
from huazhongdian_harness.models import ManifestError, VideoFrame


class ManifestIngestionTests(unittest.TestCase):
    def test_manifest_parses_paths_and_sidecar_loads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            sidecar = root / "video.md"
            manifest = root / "videos.jsonl"
            video.write_bytes(b"fake video")
            sidecar.write_text("甜饮里的果糖可能促进尿酸升高。", encoding="utf-8")
            manifest.write_text(
                json.dumps(
                    {
                        "case_id": "case_001",
                        "video_id": "video_001",
                        "video_path": "video.mp4",
                        "title": "甜饮与痛风",
                        "duration_seconds": 120,
                        "language": "zh-CN",
                        "sidecar_text_path": "video.md",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            cases = read_manifest(manifest)
            self.assertEqual(len(cases), 1)
            self.assertEqual(cases[0].video_path, video.resolve())
            context = SidecarVideoIngestionProvider().load(cases[0])
            self.assertIn("果糖", context.source_text)

    def test_missing_video_fails_manifest_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "videos.jsonl"
            manifest.write_text(
                json.dumps(
                    {
                        "case_id": "case_001",
                        "video_id": "video_001",
                        "video_path": "missing.mp4",
                        "title": "缺失视频",
                        "duration_seconds": 120,
                        "language": "zh-CN",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            with self.assertRaises(ManifestError):
                read_manifest(manifest)

    def test_missing_sidecar_uses_inline_video_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            manifest = root / "videos.jsonl"
            video.write_bytes(b"fake video")
            manifest.write_text(
                json.dumps(
                    {
                        "case_id": "case_001",
                        "video_id": "video_001",
                        "video_path": "video.mp4",
                        "title": "无文本",
                        "duration_seconds": 120,
                        "language": "zh-CN",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            case = read_manifest(manifest)[0]
            with patch(
                "huazhongdian_harness.ingestion._extract_video_frames",
                return_value=[VideoFrame(timestamp_seconds=10, image_data_url="data:image/jpeg;base64,AAAA")],
            ):
                context = SidecarVideoIngestionProvider().load(case)
            self.assertTrue(context.has_frame_input)
            self.assertEqual(len(context.frames), 1)
            self.assertTrue(context.frames[0].image_data_url.startswith("data:image/jpeg;base64,"))

    def test_inline_video_input_has_no_local_size_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "large.mp4"
            manifest = root / "videos.jsonl"
            with video.open("wb") as handle:
                handle.seek(50 * 1024 * 1024)
                handle.write(b"x")
            manifest.write_text(
                json.dumps(
                    {
                        "case_id": "case_001",
                        "video_id": "video_001",
                        "video_path": "large.mp4",
                        "title": "大视频",
                        "duration_seconds": 120,
                        "language": "zh-CN",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            case = read_manifest(manifest)[0]
            with patch(
                "huazhongdian_harness.ingestion._extract_video_frames",
                return_value=[VideoFrame(timestamp_seconds=10, image_data_url="data:image/jpeg;base64,AAAA")],
            ):
                context = SidecarVideoIngestionProvider().load(case)
            self.assertTrue(context.has_frame_input)
            self.assertEqual(len(context.frames), 1)

    def test_file_api_mode_uses_original_video_without_frame_extraction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            manifest = root / "videos.jsonl"
            video.write_bytes(b"fake video")
            manifest.write_text(
                json.dumps(
                    {
                        "case_id": "case_001",
                        "video_id": "video_001",
                        "video_path": "video.mp4",
                        "title": "File API 视频",
                        "duration_seconds": 120,
                        "language": "zh-CN",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            case = read_manifest(manifest)[0]
            with patch("huazhongdian_harness.ingestion._extract_video_frames") as extract:
                context = SidecarVideoIngestionProvider(video_input_mode="file").load(case)

            self.assertTrue(context.has_file_input)
            self.assertTrue(context.has_visual_input)
            extract.assert_not_called()


if __name__ == "__main__":
    unittest.main()
