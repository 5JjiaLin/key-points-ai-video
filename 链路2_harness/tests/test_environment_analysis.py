from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from huazhongdian_harness.environment_analysis import (
    _build_chunk_selection_prompt,
    _chunk_context_batches,
    _complete_selection,
    _is_standalone_answer,
    analyze_environment,
    merge_knowledge_points,
)
from huazhongdian_harness.models import KnowledgePoint, ManifestCase, VideoContext, VideoFrame
from huazhongdian_harness.providers import MockProvider


def _write_strict_test_environment(root: Path) -> Path:
    environment_path = root / "environment.json"
    environment_path.write_text(json.dumps({
        "schemaVersion": "video-environment.v1",
        "video": {
            "id": "video",
            "sourcePath": str(root / "video.mp4"),
            "title": "甜饮与尿酸",
            "durationMs": 100000,
            "language": "zh",
        },
        "semanticSegments": [{
            "id": "semantic-1",
            "startMs": 10000,
            "endMs": 30000,
            "text": (
                "甜饮里的果糖可能促进尿酸生成并让尿酸升高。"
                "长期大量摄入含糖饮料更容易使尿酸升高。"
            ),
        }],
        "ocrSegments": [],
        "keyframes": [],
        "analysisChunks": [{
            "id": "chunk-001",
            "startMs": 10000,
            "endMs": 30000,
            "semanticSegmentIds": ["semantic-1"],
            "keyframeIds": [],
        }],
    }), encoding="utf-8")
    return environment_path


class EnvironmentAnalysisTests(unittest.TestCase):
    def test_main_path_selects_generates_and_audits_question_answers(self) -> None:
        class RecordingMockProvider(MockProvider):
            def __init__(self) -> None:
                super().__init__(knowledge_point_count=1)
                self.system_prompts: list[str] = []
                self.temperatures: list[float] = []

            def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
                self.system_prompts.append(system_prompt)
                self.temperatures.append(temperature)
                return super().complete(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=temperature,
                )

        provider = RecordingMockProvider()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment_path = root / "environment.json"
            environment_path.write_text(json.dumps({
                "schemaVersion": "video-environment.v1",
                "video": {
                    "id": "video",
                    "sourcePath": str(root / "video.mp4"),
                    "title": "甜饮与尿酸",
                    "durationMs": 100000,
                    "language": "zh",
                },
                "semanticSegments": [{
                    "id": "semantic-1",
                    "startMs": 10000,
                    "endMs": 30000,
                    "text": (
                        "甜饮里的果糖可能促进尿酸生成并让尿酸升高。"
                        "长期大量摄入含糖饮料更容易使尿酸升高。"
                    ),
                }],
                "ocrSegments": [],
                "keyframes": [],
                "analysisChunks": [{
                    "id": "chunk-001",
                    "startMs": 10000,
                    "endMs": 30000,
                    "semanticSegmentIds": ["semantic-1"],
                    "keyframeIds": [],
                }],
            }), encoding="utf-8")
            result = analyze_environment(
                environment_path=environment_path,
                out_dir=root / "out",
                provider=provider,
            )

            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["knowledgePoints"][0]["question"], "为什么甜饮也升尿酸？")
            self.assertEqual(
                result["knowledgePoints"][0]["answer"],
                "会。果糖代谢可能促进尿酸生成，长期大量摄入含糖饮料更容易使尿酸升高。",
            )
            candidate_path = root / "out" / "question_answer_candidate_batches.json"
            audit_path = root / "out" / "quality_audit.json"
            self.assertTrue(candidate_path.is_file())
            self.assertTrue(audit_path.is_file())
            self.assertTrue((root / "out" / "task_spec.json").is_file())
            self.assertTrue((root / "out" / "environment_snapshot.json").is_file())
            self.assertTrue((root / "out" / "trace.jsonl").is_file())
            self.assertNotIn("card", candidate_path.read_text(encoding="utf-8").casefold())
            self.assertNotIn("card", audit_path.read_text(encoding="utf-8").casefold())
            self.assertFalse((root / "out" / "cards.json").exists())

        self.assertEqual(len(provider.system_prompts), 3)
        self.assertIn("知识点选择器", provider.system_prompts[0])
        self.assertIn("问题答案候选生成器", provider.system_prompts[1])
        self.assertIn("质量审核模型", provider.system_prompts[2])
        self.assertEqual(provider.temperatures, [0.0, 0.0, 0.0])

    def test_rejects_video_guidance_and_uses_next_audited_answer(self) -> None:
        class GuidanceProvider(MockProvider):
            def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
                raw = super().complete(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=temperature,
                )
                if "问题答案候选生成器" not in system_prompt:
                    return raw
                payload = json.loads(raw)
                candidates = payload["candidate_groups"][0]["candidates"]
                candidates[0]["highlight_answer"] = "核心机制和变化过程请回看原视频。"
                candidates[1]["highlight_answer"] = (
                    "甜饮里的果糖可能促进尿酸生成。"
                )
                return json.dumps(payload, ensure_ascii=False)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment_path = root / "environment.json"
            environment_path.write_text(json.dumps({
                "schemaVersion": "video-environment.v1",
                "video": {
                    "id": "video",
                    "sourcePath": str(root / "video.mp4"),
                    "title": "甜饮与尿酸",
                    "durationMs": 100000,
                    "language": "zh",
                },
                "semanticSegments": [{
                    "id": "semantic-1",
                    "startMs": 10000,
                    "endMs": 30000,
                    "text": (
                        "甜饮里的果糖可能促进尿酸生成并让尿酸升高。"
                        "长期大量摄入含糖饮料更容易使尿酸升高。"
                    ),
                }],
                "ocrSegments": [],
                "keyframes": [],
                "analysisChunks": [{
                    "id": "chunk-001",
                    "startMs": 10000,
                    "endMs": 30000,
                    "semanticSegmentIds": ["semantic-1"],
                    "keyframeIds": [],
                }],
            }), encoding="utf-8")
            result = analyze_environment(
                environment_path=environment_path,
                out_dir=root / "out",
                provider=GuidanceProvider(knowledge_point_count=1),
            )

        self.assertEqual(
            result["knowledgePoints"][0]["answer"],
            "甜饮里的果糖可能促进尿酸生成。",
        )
        self.assertEqual(result["fallbacks"], [])
        self.assertFalse(_is_standalone_answer("具体过程请回看原视频。"))
        self.assertTrue(_is_standalone_answer(result["knowledgePoints"][0]["answer"]))

    def test_main_result_contains_question_answer_and_no_cards(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment_path = root / "environment.json"
            environment_path.write_text(json.dumps({
                "schemaVersion": "video-environment.v1",
                "video": {
                    "id": "video",
                    "sourcePath": str(root / "video.mp4"),
                    "title": "甜饮与尿酸",
                    "durationMs": 100000,
                    "language": "zh",
                },
                "semanticSegments": [{
                    "id": "semantic-1",
                    "startMs": 10000,
                    "endMs": 30000,
                    "text": (
                        "甜饮里的果糖可能促进尿酸生成并让尿酸升高。"
                        "长期大量摄入含糖饮料更容易使尿酸升高。"
                    ),
                }],
                "keyframes": [],
                "analysisChunks": [{
                    "id": "chunk-001",
                    "startMs": 10000,
                    "endMs": 30000,
                    "semanticSegmentIds": ["semantic-1"],
                    "keyframeIds": [],
                }],
            }), encoding="utf-8")
            (root / "out").mkdir()
            (root / "out" / "cards.json").write_text("[]", encoding="utf-8")
            result = analyze_environment(
                environment_path=environment_path,
                out_dir=root / "out",
                provider=MockProvider(knowledge_point_count=1),
            )
            self.assertFalse((root / "out" / "cards.json").exists())
        self.assertNotIn("cards", result)
        self.assertNotIn("audits", result)
        self.assertEqual(result["knowledgePoints"][0]["question"], "为什么甜饮也升尿酸？")

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

    def test_chunk_prompt_loads_full_skill_and_keeps_absolute_timestamp_contract(self) -> None:
        context = VideoContext(
            case=ManifestCase("case", "video", Path("video.mp4"), "title", 732, "zh"),
            source_text="【分析块绝对时间 228.000s - 468.000s】\n[228.000-235.000] 文本",
        )
        prompt = _build_chunk_selection_prompt(context)
        self.assertIn("视频知识点选择 Skill v11", prompt)
        self.assertIn("14 项打分", prompt)
        self.assertIn("start_time", prompt)
        self.assertIn("[228.000-235.000]", prompt)

    def test_analysis_chunk_uses_one_cost_efficient_model_batch_by_default(self) -> None:
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
        self.assertEqual(len(contexts), 1)
        self.assertIn("s-0", contexts[0].source_text)
        self.assertIn("s-9", contexts[-1].source_text)

    def test_analysis_chunk_includes_overlapping_ocr_as_frozen_evidence(self) -> None:
        environment = {
            "semanticSegments": [
                {"id": "s-1", "startMs": 0, "endMs": 4000, "text": "口播内容"}
            ],
            "ocrSegments": [
                {"id": "ocr-1", "startMs": 1000, "endMs": 3000, "text": "画面关键结论"}
            ],
            "keyframes": [],
        }
        chunk = {
            "id": "chunk-001",
            "startMs": 0,
            "endMs": 4000,
            "semanticSegmentIds": ["s-1"],
            "keyframeIds": [],
        }
        case = ManifestCase("case", "video", Path("video.mp4"), "title", 4, "zh")
        [context] = _chunk_context_batches(case, environment, chunk)
        self.assertIn("[ASR 0.000-4.000]", context.source_text)
        self.assertIn("[OCR 1.000-3.000]", context.source_text)
        self.assertIn("画面关键结论", context.source_text)

    def test_failed_remote_selection_stops_strict_pipeline(self) -> None:
        class FailingProvider:
            def complete(self, **_kwargs: object) -> str:
                raise TimeoutError("The read operation timed out")

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

            with self.assertRaisesRegex(RuntimeError, "knowledge point selection failed"):
                analyze_environment(
                    environment_path=environment_path,
                    out_dir=root / "out",
                    provider=FailingProvider(),  # type: ignore[arg-type]
                )
            self.assertFalse((root / "out" / "chain2_result.json").exists())

    def test_failed_generation_or_audit_stops_strict_pipeline(self) -> None:
        class FailingStageProvider(MockProvider):
            def __init__(self, marker: str) -> None:
                super().__init__(knowledge_point_count=1)
                self.marker = marker

            def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
                if self.marker in system_prompt:
                    raise TimeoutError("The read operation timed out")
                return super().complete(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=temperature,
                )

        cases = (
            ("问题答案候选生成器", "question generation failed"),
            ("问题答案质量审核模型", "quality audit failed"),
        )
        for marker, expected_error in cases:
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                with self.assertRaisesRegex(RuntimeError, expected_error):
                    analyze_environment(
                        environment_path=_write_strict_test_environment(root),
                        out_dir=root / "out",
                        provider=FailingStageProvider(marker),
                    )
                self.assertFalse((root / "out" / "chain2_result.json").exists())

    def test_audit_rejection_removes_point_instead_of_using_selection_answer(self) -> None:
        class RejectingAuditProvider(MockProvider):
            def complete(self, *, system_prompt: str, user_prompt: str, temperature: float) -> str:
                raw = super().complete(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=temperature,
                )
                if "问题答案质量审核模型" not in system_prompt:
                    return raw
                payload = json.loads(raw)
                for group in payload["group_audits"]:
                    for audit in group["candidate_audits"]:
                        audit["should_keep"] = False
                        audit["audit_grade"] = "C"
                return json.dumps(payload, ensure_ascii=False)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, "approved no knowledge points"):
                analyze_environment(
                    environment_path=_write_strict_test_environment(root),
                    out_dir=root / "out",
                    provider=RejectingAuditProvider(knowledge_point_count=1),
                )
            self.assertFalse((root / "out" / "chain2_result.json").exists())

if __name__ == "__main__":
    unittest.main()
