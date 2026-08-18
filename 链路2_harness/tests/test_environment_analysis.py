from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from huazhongdian_harness.environment_analysis import (
    _build_chunk_selection_prompt,
    _chunk_context_batches,
    _complete_selection,
    _fallback_points_from_context,
    _is_transport_error,
    _point_answer,
    _point_question,
    analyze_environment,
    merge_knowledge_points,
)
from huazhongdian_harness.models import KnowledgePoint, ManifestCase, VideoContext, VideoFrame


class EnvironmentAnalysisTests(unittest.TestCase):
    def test_main_result_contains_question_answer_and_no_cards(self) -> None:
        class Provider:
            def complete(self, **_kwargs: object) -> str:
                return json.dumps({
                    "knowledge_points": [{
                        "knowledge_point_id": "raw-1",
                        "statement": "多巴胺参与动机和奖励预期",
                        "start_time": 2,
                        "end_time": 8,
                        "question_direction": "多巴胺主要参与什么？",
                        "answer_core": "它参与动机形成和奖励预期。",
                        "task_type": "作用说明型",
                    }]
                }, ensure_ascii=False)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment_path = root / "environment.json"
            environment_path.write_text(json.dumps({
                "schemaVersion": "video-environment.v1",
                "video": {
                    "id": "video",
                    "sourcePath": str(root / "video.mp4"),
                    "title": "多巴胺",
                    "durationMs": 10000,
                    "language": "zh",
                },
                "semanticSegments": [{
                    "id": "semantic-1",
                    "startMs": 2000,
                    "endMs": 8000,
                    "text": "多巴胺参与动机和奖励预期",
                }],
                "keyframes": [],
                "analysisChunks": [{
                    "id": "chunk-001",
                    "startMs": 0,
                    "endMs": 10000,
                    "semanticSegmentIds": ["semantic-1"],
                    "keyframeIds": [],
                }],
            }), encoding="utf-8")
            (root / "out").mkdir()
            (root / "out" / "cards.json").write_text("[]", encoding="utf-8")
            result = analyze_environment(
                environment_path=environment_path,
                out_dir=root / "out",
                provider=Provider(),  # type: ignore[arg-type]
            )
            self.assertFalse((root / "out" / "cards.json").exists())
        self.assertNotIn("cards", result)
        self.assertNotIn("audits", result)
        self.assertEqual(result["knowledgePoints"][0]["question"], "多巴胺主要参与什么？")
        self.assertEqual(result["knowledgePoints"][0]["answer"], "它参与动机形成和奖励预期。")

    def test_merge_removes_overlap_duplicates_and_combines_evidence(self) -> None:
        points = [
            KnowledgePoint("kp-1", "果糖代谢会促进尿酸生成", 220, 250, evidence_segment_ids=["s1"]),
            KnowledgePoint("kp-2", "果糖代谢可以促进尿酸生成", 228, 252, evidence_segment_ids=["s2"]),
        ]
        merged = merge_knowledge_points(points, duration_seconds=732)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].evidence_segment_ids, ["s1", "s2"])

    def test_merge_makes_distinct_overlapping_points_non_overlapping(self) -> None:
        points = [
            KnowledgePoint("kp-1", "多巴胺的基础作用", 100, 130),
            KnowledgePoint("kp-2", "成瘾回路如何形成", 125, 160),
        ]
        merged = merge_knowledge_points(points, duration_seconds=732)
        self.assertEqual(len(merged), 2)
        self.assertLessEqual(merged[0].end_time, merged[1].start_time)

    def test_selection_falls_back_to_timestamped_text_when_frames_timeout(self) -> None:
        class Provider:
            def complete_with_frames(self, **_kwargs: object) -> str:
                raise TimeoutError("multimodal timeout")

            def complete(self, **_kwargs: object) -> str:
                return '{"knowledge_points": []}'

        context = VideoContext(
            case=ManifestCase("case", "video", Path("video.mp4"), "title", 60, "zh"),
            source_text="[0.000-2.000] 时间戳文本",
            frames=[VideoFrame(1, "data:image/jpeg;base64,AA==")],
        )
        raw, mode = _complete_selection(Provider(), context)  # type: ignore[arg-type]
        self.assertEqual(raw, '{"knowledge_points": []}')
        self.assertEqual(mode, "text_fallback")

    def test_chunk_prompt_is_compact_and_keeps_absolute_timestamp_contract(self) -> None:
        context = VideoContext(
            case=ManifestCase("case", "video", Path("video.mp4"), "title", 732, "zh"),
            source_text="【分析块绝对时间 228.000s - 468.000s】\n[228.000-235.000] 文本",
        )
        prompt = _build_chunk_selection_prompt(context)
        self.assertLess(len(prompt), 6000)
        self.assertIn("原视频绝对秒数", prompt)
        self.assertIn("[228.000-235.000]", prompt)

    def test_long_analysis_chunk_is_split_into_small_model_batches(self) -> None:
        environment = {
            "semanticSegments": [
                {"id": f"s-{index}", "startMs": index * 1000, "endMs": (index + 1) * 1000, "text": str(index)}
                for index in range(10)
            ],
            "keyframes": [],
        }
        chunk = {
            "id": "chunk-001",
            "startMs": 0,
            "endMs": 10000,
            "semanticSegmentIds": [f"s-{index}" for index in range(10)],
            "keyframeIds": [],
        }
        case = ManifestCase("case", "video", Path("video.mp4"), "title", 10, "zh")
        contexts = _chunk_context_batches(case, environment, chunk)
        self.assertEqual(len(contexts), 3)
        self.assertIn("s-0", contexts[0].source_text)
        self.assertIn("s-9", contexts[-1].source_text)

    def test_failed_remote_batch_can_preserve_timestamped_fallback(self) -> None:
        context = VideoContext(
            case=ManifestCase("case", "video", Path("video.mp4"), "title", 60, "zh"),
            source_text="[12.000-20.000] (semantic-1) 多巴胺参与动机和奖励预期",
        )
        [point] = _fallback_points_from_context(context)
        self.assertEqual(point.evidence_segment_ids, ["semantic-1"])
        self.assertEqual(_point_question(point), "这段内容的关键结论是什么？")
        self.assertEqual(_point_answer(point), "多巴胺参与动机和奖励预期")
        self.assertTrue(_is_transport_error("The read operation timed out"))
        self.assertFalse(_is_transport_error("invalid model JSON"))


if __name__ == "__main__":
    unittest.main()
