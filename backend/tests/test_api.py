from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


class InlineExecutor:
    def submit(self, function, *args):
        function(*args)


class ApiTests(unittest.TestCase):
    def test_upload_poll_result_and_media(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            def processor(store, job_id, source_path):
                store.write_result(job_id, {"schemaVersion": "video-project.v1", "id": job_id})
                store.update(job_id, state="ready", progress=1.0, message="done", retryable=False)

            app = create_app(
                data_root=root,
                processor=processor,
                executor=InlineExecutor(),
                probe_validator=lambda _path: None,
            )
            client = TestClient(app)
            response = client.post("/api/videos", files={"file": ("demo.mp4", b"video", "video/mp4")})
            self.assertEqual(response.status_code, 202)
            job_id = response.json()["jobId"]
            self.assertEqual(client.get(f"/api/jobs/{job_id}").json()["state"], "ready")
            self.assertEqual(client.get(f"/api/jobs/{job_id}/result").json()["id"], job_id)
            self.assertEqual(client.get(f"/api/media/{job_id}/media/source.mp4").status_code, 200)

    def test_rejects_unsupported_upload_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(data_root=Path(tmp), executor=InlineExecutor())
            response = TestClient(app).post(
                "/api/videos", files={"file": ("note.txt", b"not video", "text/plain")}
            )
            self.assertEqual(response.status_code, 415)


if __name__ == "__main__":
    unittest.main()

