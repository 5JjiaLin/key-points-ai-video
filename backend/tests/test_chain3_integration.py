from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


class InlineExecutor:
    def submit(self, function, *args):
        function(*args)


class FakeChain3Client:
    def __init__(self) -> None:
        self.analysis_payload = None
        self.reconstruction = None

    def start_analysis(self, payload):
        self.analysis_payload = payload
        return {"analysis_id": "analysis-stable", "status": "created"}

    def get_status(self, analysis_id):
        return {
            "analysis_id": analysis_id,
            "status": "awaiting_question",
            "progress": 75,
            "current_step": "awaiting_question",
            "error": None,
        }

    def get_result(self, _analysis_id):
        return {"status": "awaiting_question", "result": {"recommended_questions": []}}

    def start_reconstruction(self, analysis_id, research_question):
        self.reconstruction = (analysis_id, research_question)
        return {"analysis_id": "analysis-path", "status": "created"}


class Chain3IntegrationTests(unittest.TestCase):
    def test_pool_is_idempotent_and_removal_does_not_delete_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = create_app(
                data_root=root / "jobs",
                knowledge_pool_file=root / "knowledge-pool.json",
                chain3_client=FakeChain3Client(),
                executor=InlineExecutor(),
            )
            job_id = "a" * 32
            _write_ready_job(app.state.job_store, job_id)
            client = TestClient(app)

            first = client.post("/api/knowledge-pool/items", json={"jobId": job_id})
            second = client.post("/api/knowledge-pool/items", json={"jobId": job_id})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertEqual(len(client.get("/api/knowledge-pool").json()["items"]), 1)

            self.assertEqual(client.delete(f"/api/knowledge-pool/items/{job_id}").status_code, 204)
            self.assertTrue(app.state.job_store.job_dir(job_id).is_dir())

    def test_reconstruction_uses_existing_environment_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            chain3 = FakeChain3Client()
            app = create_app(
                data_root=root / "jobs",
                knowledge_pool_file=root / "knowledge-pool.json",
                chain3_client=chain3,
                executor=InlineExecutor(),
            )
            client = TestClient(app)
            job_ids = [character * 32 for character in "abc"]
            for index, job_id in enumerate(job_ids):
                _write_ready_job(app.state.job_store, job_id, creator=f"作者{index}")
                client.post("/api/knowledge-pool/items", json={"jobId": job_id})

            response = client.post(
                "/api/reconstructions",
                json={
                    "videoIds": job_ids,
                    "requestedAnalysisMode": "multi_creator_topic",
                    "themeHint": "地球科学",
                },
            )
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json()["analysisId"], "analysis-stable")
            self.assertEqual(len(chain3.analysis_payload["videos"]), 3)
            first = chain3.analysis_payload["videos"][0]
            self.assertEqual(first["asr_segments"][0]["start_ms"], 1000)
            self.assertEqual(first["chapter_hints"][0]["evidence_segment_ids"], ["semantic-1"])
            self.assertEqual(first["content_version"], "hash-a")

            path = client.post(
                "/api/reconstructions/analysis-stable/path",
                json={"researchQuestion": "这些知识有什么因果关系？"},
            )
            self.assertEqual(path.status_code, 202)
            self.assertEqual(path.json()["analysisId"], "analysis-path")
            self.assertEqual(chain3.reconstruction[0], "analysis-stable")

    def test_reconstruction_rejects_unpooled_or_incomplete_video(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = create_app(
                data_root=root / "jobs",
                knowledge_pool_file=root / "knowledge-pool.json",
                chain3_client=FakeChain3Client(),
                executor=InlineExecutor(),
            )
            client = TestClient(app)
            job_ids = [character * 32 for character in "abc"]
            for job_id in job_ids[:2]:
                _write_ready_job(app.state.job_store, job_id)
                client.post("/api/knowledge-pool/items", json={"jobId": job_id})
            _write_ready_job(app.state.job_store, job_ids[2])

            response = client.post(
                "/api/reconstructions",
                json={"videoIds": job_ids, "requestedAnalysisMode": "auto"},
            )
            self.assertEqual(response.status_code, 422)
            self.assertIn("尚未加入", response.json()["detail"])


def _write_ready_job(store, job_id: str, creator: str = "作者") -> None:
    store.create(job_id, original_name="demo.mp4", content_type="video/mp4")
    environment = {
        "schemaVersion": "video-environment.v1",
        "video": {
            "id": job_id,
            "hash": f"hash-{job_id[0]}",
            "title": "演示视频",
            "creator": creator,
            "durationMs": 120000,
        },
        "asrSegments": [{"id": "asr-1", "startMs": 1000, "endMs": 3000, "text": "证据"}],
        "semanticSegments": [{"id": "semantic-1", "startMs": 1000, "endMs": 3000, "text": "完整证据"}],
        "ocrSegments": [],
        "keyframes": [],
    }
    evidence = store.job_dir(job_id) / "evidence"
    evidence.mkdir()
    (evidence / "video_environment.v1.json").write_text(json.dumps(environment), encoding="utf-8")
    store.write_result(job_id, {
        "schemaVersion": "video-project.v1",
        "id": job_id,
        "title": "演示视频",
        "creator": creator,
        "durationMs": 120000,
        "videoUrl": f"/api/media/{job_id}/media/source.mp4",
        "transcriptSegments": [],
        "knowledgePoints": [{
            "id": "kp-1",
            "title": "知识点",
            "factualStatement": "完整知识陈述",
            "question": "这是什么？",
            "answer": "这是答案。",
            "startMs": 1000,
            "endMs": 3000,
            "order": 1,
            "evidenceSegmentIds": ["semantic-1"],
        }],
        "supplements": [],
        "analysisStatus": {"state": "ready", "fallbacks": [], "errors": {}},
    })
    (store.job_dir(job_id) / "media" / "source.mp4").write_bytes(b"video")
    store.update(job_id, state="ready", progress=1.0, message="done", creator=creator)


if __name__ == "__main__":
    unittest.main()
