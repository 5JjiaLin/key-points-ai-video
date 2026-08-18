from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.pipeline import build_video_project_dto, process_job
from app.store import JobStore


class PipelineDtoTests(unittest.TestCase):
    def test_process_job_uses_unified_harness_result_without_changing_h5_schema(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp))
            job_id = "b" * 32
            store.create(job_id, original_name="demo.mp4", content_type="video/mp4")
            source_path = store.job_dir(job_id) / "media" / "source.mp4"
            source_path.write_bytes(b"video")
            harness = Mock()
            harness.run.return_value = SimpleNamespace(
                status="ready",
                environment={
                    "video": {"title": "demo", "durationMs": 10000},
                    "semanticSegments": [],
                    "diagnostics": {},
                },
                understanding_supplements={"supplements": []},
                knowledge_navigation={"knowledgePoints": []},
                fallbacks=[],
                errors={},
            )

            with (
                patch("app.pipeline.load_local_env"),
                patch("app.pipeline.create_default_harness", return_value=harness),
                patch("app.pipeline.prepare_playback_media", return_value=source_path),
            ):
                process_job(store, job_id, source_path)

            result = store.read_result(job_id)
            status = store.read_status(job_id)
            self.assertEqual(result["schemaVersion"], "video-project.v1")
            self.assertEqual(status["state"], "ready")
            harness.run.assert_called_once()

    def test_chain2_failure_marks_whole_job_retryable_instead_of_falling_back(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp))
            job_id = "a" * 32
            store.create(job_id, original_name="demo.mp4", content_type="video/mp4")
            source_path = store.job_dir(job_id) / "media" / "source.mp4"
            source_path.write_bytes(b"video")
            harness = Mock()
            harness.run.side_effect = RuntimeError("knowledge point selection failed")

            with (
                patch("app.pipeline.load_local_env"),
                patch(
                    "app.pipeline.create_default_harness",
                    return_value=harness,
                ),
            ):
                process_job(store, job_id, source_path)

            status = store.read_status(job_id)
            self.assertEqual(status["state"], "failed")
            self.assertTrue(status["retryable"])
            self.assertIn("knowledge point selection failed", status["error"])
            self.assertFalse((store.job_dir(job_id) / "result.json").exists())

    def test_chain1_viewpoint_clarification_fields_reach_h5_dto(self) -> None:
        result = build_video_project_dto(
            job_id="job",
            environment={
                "video": {"title": "demo", "durationMs": 10000},
                "semanticSegments": [],
                "diagnostics": {},
            },
            chain1={"supplements": [{
                "id": "claim-1",
                "type": "claim_verification",
                "sourceText": "冰水就是不健康的",
                "startMs": 1000,
                "endMs": 4000,
                "triggerAtMs": 4500,
                "displayMode": "auto_prompt",
                "question": "冰水就是不健康的吗？",
                "answer": "需要结合人群和饮用方式判断。",
                "subtitle": "换个角度看看这句话",
                "cardVariant": "viewpoint_clarification",
                "leftColumn": {"title": "一般情况", "content": "多数健康人适量饮用通常无明显问题。"},
                "rightColumn": {"title": "条件变化", "content": "胃肠敏感时可能短暂不适。"},
                "sourceCount": 2,
                "sourceAction": "查看依据",
                "renderMode": "verification_template",
                "hintStickerImageUrl": "/tmp/run_claim-1_hint_a1.png",
                "hintStickerWidth": 96,
                "hintStickerHeight": 96,
            }]},
            chain2={"knowledgePoints": []},
            source_path=Path("source.mp4"),
            fallbacks=[],
            errors={},
        )
        [supplement] = result["supplements"]
        self.assertEqual(supplement["cardVariant"], "viewpoint_clarification")
        self.assertEqual(supplement["leftColumn"]["title"], "一般情况")
        self.assertEqual(supplement["rightColumn"]["title"], "条件变化")
        self.assertEqual(supplement["sourceCount"], 2)
        self.assertEqual(
            supplement["hintStickerImageUrl"],
            "/api/media/job/media/cards/run_claim-1_hint_a1.png",
        )

    def test_chain1_list_only_supplement_is_not_exposed_to_h5(self) -> None:
        result = build_video_project_dto(
            job_id="job",
            environment={
                "video": {"title": "demo", "durationMs": 10000},
                "semanticSegments": [],
                "diagnostics": {},
            },
            chain1={"supplements": [{
                "id": "claim-legacy",
                "type": "claim_verification",
                "sourceText": "所有现象都是激励的产物",
                "startMs": 1000,
                "endMs": 4000,
                "triggerAtMs": 4500,
                "displayMode": "list_only",
                "question": "所有现象真的都是激励的产物吗？",
                "answer": "现有本地证据不足以独立判定真假。",
                "answerLabel": "证据不足/待复核",
                "renderMode": "full_generated_image",
                "cardImageUrl": "/tmp/legacy.png",
            }]},
            chain2={"knowledgePoints": []},
            source_path=Path("source.mp4"),
            fallbacks=[],
            errors={},
        )
        self.assertEqual(result["supplements"], [])

    def test_chain2_question_answer_are_read_directly_from_knowledge_point(self) -> None:
        environment = {
            "video": {"title": "demo", "durationMs": 10000},
            "semanticSegments": [],
            "diagnostics": {},
        }
        result = build_video_project_dto(
            job_id="job",
            environment=environment,
            chain1={"supplements": []},
            chain2={
                "knowledgePoints": [{
                    "id": "kp-1",
                    "statement": "多巴胺参与动机形成",
                    "question": "多巴胺参与什么？",
                    "answer": "它参与动机形成。",
                    "startMs": 1000,
                    "endMs": 5000,
                    "evidenceSegmentIds": ["semantic-1"],
                }]
            },
            source_path=Path("source.mp4"),
            fallbacks=[],
            errors={},
        )
        [point] = result["knowledgePoints"]
        self.assertEqual(point["question"], "多巴胺参与什么？")
        self.assertEqual(point["answer"], "它参与动机形成。")

    def test_dto_uses_browser_playback_copy_without_schema_change(self) -> None:
        result = build_video_project_dto(
            job_id="job",
            environment={
                "video": {"title": "demo", "durationMs": 10000},
                "semanticSegments": [],
                "diagnostics": {},
            },
            chain1={"supplements": []},
            chain2={"knowledgePoints": []},
            source_path=Path("playback.mp4"),
            fallbacks=[],
            errors={},
        )
        self.assertEqual(result["videoUrl"], "/api/media/job/media/playback.mp4")


if __name__ == "__main__":
    unittest.main()
