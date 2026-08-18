from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from huazhongdian_harness.models import VideoFrame
from huazhongdian_harness.evaluator import judge_harness
from huazhongdian_harness.providers import MockProvider
from huazhongdian_harness.reporting import build_report
from huazhongdian_harness.runner import run_harness


class PipelineIntegrationTests(unittest.TestCase):
    def test_mock_pipeline_writes_outputs_and_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            sidecar = root / "video.md"
            manifest = root / "videos.jsonl"
            out_dir = root / "run"
            video.write_bytes(b"fake video")
            sidecar.write_text(
                "00:72-00:95 甜饮里的果糖可能促进尿酸升高，也可能增加年轻人的痛风风险。",
                encoding="utf-8",
            )
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

            run_harness(
                manifest_path=manifest,
                runs=1,
                out_dir=out_dir,
                provider=MockProvider(),
            )
            case_dir = out_dir / "cases" / "case_001"
            self.assertTrue((out_dir / "trace.jsonl").exists())
            self.assertTrue((out_dir / "task_specs.json").exists())
            self.assertTrue((case_dir / "task_spec.json").exists())
            snapshot = json.loads((case_dir / "environment_snapshot.json").read_text(encoding="utf-8"))
            self.assertEqual(snapshot["provider_name"], "mock")
            self.assertEqual(snapshot["ingestion"]["mode"], "sidecar_text")
            self.assertIn("knowledge_point_selection.md", snapshot["prompt_asset_hashes"])
            self.assertTrue((out_dir / "cases" / "case_001" / "run_001" / "knowledge_points.json").exists())
            candidate_path = out_dir / "cases" / "case_001" / "run_001" / "card_candidates.json"
            self.assertTrue(candidate_path.exists())
            groups = json.loads(candidate_path.read_text(encoding="utf-8"))
            self.assertTrue(all(len(group["candidates"]) == 3 for group in groups))

            summary = judge_harness(run_dir=out_dir, provider=MockProvider())
            self.assertEqual(summary["case_count"], 1)
            self.assertEqual(summary["passed_count"], 1)
            quality = json.loads((case_dir / "quality_summary.json").read_text(encoding="utf-8"))
            self.assertEqual(quality["best_run_id"], "run_001")
            self.assertTrue(quality["best_passed_card_ids"])

            report_path = build_report(run_dir=out_dir)
            self.assertTrue(report_path.exists())
            self.assertIn("甜饮与痛风", report_path.read_text(encoding="utf-8"))

    def test_mock_pipeline_can_use_inline_video_without_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            manifest = root / "videos.jsonl"
            out_dir = root / "run"
            video.write_bytes(b"fake video")
            manifest.write_text(
                json.dumps(
                    {
                        "case_id": "case_001",
                        "video_id": "video_001",
                        "video_path": "video.mp4",
                        "title": "甜饮与痛风",
                        "duration_seconds": 120,
                        "language": "zh-CN",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            with patch(
                "huazhongdian_harness.ingestion._extract_video_frames",
                return_value=[VideoFrame(timestamp_seconds=10, image_data_url="data:image/jpeg;base64,AAAA")],
            ):
                run_harness(
                    manifest_path=manifest,
                    runs=1,
                    out_dir=out_dir,
                    provider=MockProvider(),
                )

            source = json.loads(
                (out_dir / "cases" / "case_001" / "source.json").read_text(encoding="utf-8")
            )
            self.assertEqual(source["mode"], "frame_sequence")
            self.assertEqual(source["frame_count"], 1)
            self.assertTrue(
                (out_dir / "cases" / "case_001" / "run_001" / "card_candidates.json").exists()
            )

    def test_mock_pipeline_keeps_all_generated_knowledge_points(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            sidecar = root / "video.md"
            manifest = root / "videos.jsonl"
            out_dir = root / "run"
            video.write_bytes(b"fake video")
            sidecar.write_text("00:00-05:00 这是一段高密度健康科普视频。", encoding="utf-8")
            manifest.write_text(
                json.dumps(
                    {
                        "case_id": "case_001",
                        "video_id": "video_001",
                        "video_path": "video.mp4",
                        "title": "高密度健康科普",
                        "duration_seconds": 300,
                        "language": "zh-CN",
                        "sidecar_text_path": "video.md",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            run_harness(
                manifest_path=manifest,
                runs=1,
                out_dir=out_dir,
                provider=MockProvider(knowledge_point_count=10),
            )

            run_dir = out_dir / "cases" / "case_001" / "run_001"
            knowledge_points = json.loads((run_dir / "knowledge_points.json").read_text(encoding="utf-8"))
            candidate_groups = json.loads(
                (run_dir / "card_candidates.json").read_text(encoding="utf-8")
            )
            judge_harness(run_dir=out_dir, provider=MockProvider())
            cards = json.loads((run_dir / "cards.json").read_text(encoding="utf-8"))
            self.assertEqual(len(knowledge_points), 10)
            self.assertEqual(len(candidate_groups), 10)
            self.assertTrue(all(len(group["candidates"]) == 3 for group in candidate_groups))
            self.assertEqual(len(cards), 10)
            self.assertEqual(cards[-1]["knowledge_point_id"], "kp_010")

    def test_mock_pipeline_repairs_bad_json_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "video.mp4"
            sidecar = root / "video.md"
            manifest = root / "videos.jsonl"
            out_dir = root / "run"
            video.write_bytes(b"fake video")
            sidecar.write_text("00:10-00:30 甜饮和尿酸的关系。", encoding="utf-8")
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

            run_harness(
                manifest_path=manifest,
                runs=1,
                out_dir=out_dir,
                provider=BadJsonThenRepairProvider(),
            )

            raw = json.loads((out_dir / "cases" / "case_001" / "run_001" / "raw.json").read_text(encoding="utf-8"))
            self.assertIn("selection_repair", raw)
            self.assertTrue((out_dir / "cases" / "case_001" / "run_001" / "knowledge_points.json").exists())


class BadJsonThenRepairProvider(MockProvider):
    def __init__(self) -> None:
        super().__init__()
        self.returned_bad_selection = False

    def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
        if "JSON 修复器" in system_prompt or "JSON 修复器" in user_prompt:
            return json.dumps({"knowledge_points": self._valid_points()}, ensure_ascii=False)
        if ("知识点选择器" in system_prompt or "知识点选择器" in user_prompt) and not self.returned_bad_selection:
            self.returned_bad_selection = True
            return '{"knowledge_points": ['
        return super().complete(system_prompt=system_prompt, user_prompt=user_prompt, temperature=temperature)

    def _valid_points(self) -> list[dict]:
        return [
            {
                "knowledge_point_id": "kp_001",
                "statement": "甜饮里的果糖可能促进尿酸生成并让尿酸升高。",
                "start_time": 10,
                "end_time": 30,
                "selection_scores": {"fact_complete": 1},
                "priority": "S",
                "task_type": "原因解释型",
                "timestamp_note": "从甜饮和尿酸关系开始正式讲解。",
            }
        ]


if __name__ == "__main__":
    unittest.main()
