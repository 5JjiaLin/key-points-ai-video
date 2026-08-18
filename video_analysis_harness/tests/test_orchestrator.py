from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from video_analysis_harness import (
    RequiredCapabilityError,
    VideoAnalysisHarness,
    VideoAnalysisRequest,
)


class FakePreprocessor:
    def __init__(self) -> None:
        self.calls = 0

    def run(self, request, run_dir, progress):
        self.calls += 1
        environment_path = run_dir / "evidence" / "video_environment.v1.json"
        environment_path.parent.mkdir(parents=True, exist_ok=True)
        environment_path.write_text(
            json.dumps(_environment(request.video_id)),
            encoding="utf-8",
        )
        if progress:
            progress("transcribing", 0.5)
        return {"environmentPath": str(environment_path)}


class FakeCapability:
    def __init__(self, result=None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.environment_paths: list[Path] = []

    def run(self, environment_path, _run_dir, progress):
        self.environment_paths.append(environment_path)
        if progress:
            progress("child", 0.5)
        if self.error:
            raise self.error
        return self.result


class UnifiedHarnessTests(unittest.TestCase):
    def test_runs_both_capabilities_against_one_environment(self) -> None:
        preprocessor = FakePreprocessor()
        supplements = FakeCapability({
            "videoId": "video-1",
            "status": "ready",
            "supplements": [],
        })
        navigation = FakeCapability({
            "videoId": "video-1",
            "status": "ready",
            "knowledgePoints": [],
        })
        harness = VideoAnalysisHarness(
            preprocessor=preprocessor,
            understanding_supplements=supplements,
            knowledge_navigation=navigation,
        )
        with tempfile.TemporaryDirectory() as tmp:
            result = harness.run(_request(Path(tmp)), run_dir=Path(tmp))
            persisted = json.loads(
                (Path(tmp) / "video_analysis_result.json").read_text(encoding="utf-8")
            )

        self.assertEqual(preprocessor.calls, 1)
        self.assertEqual(supplements.environment_paths, navigation.environment_paths)
        self.assertEqual(result.status, "ready")
        self.assertTrue(result.run_id.startswith("video_run_"))
        self.assertTrue(result.environment_snapshot_id.startswith("video_environment_"))
        self.assertEqual(persisted["schemaVersion"], "video-analysis.v1")
        self.assertEqual(
            persisted["capabilities"]["understandingSupplements"]["status"],
            "ready",
        )

    def test_understanding_failure_degrades_without_losing_navigation(self) -> None:
        harness = VideoAnalysisHarness(
            preprocessor=FakePreprocessor(),
            understanding_supplements=FakeCapability(error=RuntimeError("chain1 unavailable")),
            knowledge_navigation=FakeCapability({
                "videoId": "video-1",
                "status": "ready",
                "knowledgePoints": [{"id": "kp-1"}],
            }),
        )
        with tempfile.TemporaryDirectory() as tmp:
            result = harness.run(_request(Path(tmp)), run_dir=Path(tmp))

        self.assertEqual(result.status, "ready_with_fallbacks")
        self.assertEqual(result.understanding_supplements["supplements"], [])
        self.assertEqual(result.knowledge_navigation["knowledgePoints"], [{"id": "kp-1"}])
        self.assertEqual(
            result.fallbacks,
            ["chain1_failed"],
        )
        self.assertIn("chain1 unavailable", result.errors["chain1"])

    def test_navigation_failure_remains_a_required_capability_failure(self) -> None:
        harness = VideoAnalysisHarness(
            preprocessor=FakePreprocessor(),
            understanding_supplements=FakeCapability({
                "videoId": "video-1",
                "status": "ready",
                "supplements": [],
            }),
            knowledge_navigation=FakeCapability(error=RuntimeError("selection failed")),
        )
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(
                RequiredCapabilityError,
                "knowledge navigation strict pipeline failed: selection failed",
            ):
                harness.run(_request(Path(tmp)), run_dir=Path(tmp))

    def test_invalid_capability_contract_cannot_be_reported_as_ready(self) -> None:
        harness = VideoAnalysisHarness(
            preprocessor=FakePreprocessor(),
            understanding_supplements=FakeCapability({
                "videoId": "different-video",
                "status": "ready",
                "supplements": [],
            }),
            knowledge_navigation=FakeCapability({
                "videoId": "video-1",
                "status": "ready",
                "knowledgePoints": [],
            }),
        )
        with tempfile.TemporaryDirectory() as tmp:
            result = harness.run(_request(Path(tmp)), run_dir=Path(tmp))

        self.assertEqual(result.status, "ready_with_fallbacks")
        self.assertIn(
            "videoId does not match",
            result.errors["chain1"],
        )


def _request(root: Path) -> VideoAnalysisRequest:
    source = root / "source.mp4"
    source.write_bytes(b"video")
    return VideoAnalysisRequest(video_id="video-1", source_path=source, title="demo")


def _environment(video_id: str) -> dict:
    return {
        "schemaVersion": "video-environment.v1",
        "video": {
            "id": video_id,
            "hash": "hash",
            "title": "demo",
            "durationMs": 10000,
            "sourcePath": "/tmp/source.mp4",
        },
        "asrSegments": [
            {"id": "asr-1", "startMs": 0, "endMs": 1000, "text": "示例内容"}
        ],
        "semanticSegments": [
            {
                "id": "semantic-1",
                "startMs": 0,
                "endMs": 1000,
                "text": "示例内容",
                "asrSegmentIds": ["asr-1"],
            }
        ],
        "ocrSegments": [],
        "keyframes": [],
        "analysisChunks": [
            {
                "id": "chunk-1",
                "startMs": 0,
                "endMs": 10000,
                "semanticSegmentIds": ["semantic-1"],
                "keyframeIds": [],
            }
        ],
        "diagnostics": {},
    }


if __name__ == "__main__":
    unittest.main()
