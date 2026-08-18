from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.douyin import parse_public_share_page
from app.main import create_app


class InlineExecutor:
    def submit(self, function, *args):
        function(*args)


class ApiTests(unittest.TestCase):
    def test_parses_video_from_public_douyin_share_page(self) -> None:
        html = """<script>window._ROUTER_DATA = {"loaderData":{"video_(id)/page":{
          "videoInfoRes":{"item_list":[{"aweme_id":"7534291258635816251",
          "desc":"测试视频","video":{"play_addr":{"url_list":["https://example.com/playwm/"]}}}]}
        }}}</script>"""
        item = parse_public_share_page(html)
        self.assertEqual(item["aweme_id"], "7534291258635816251")
        self.assertEqual(item["desc"], "测试视频")

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

    def test_douyin_share_text_creates_the_same_video_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            def downloader(source_url, media_dir, _max_bytes):
                self.assertEqual(source_url, "https://v.douyin.com/example/")
                target = media_dir / "source.mp4"
                target.write_bytes(b"video")
                return {
                    "path": target,
                    "url": source_url,
                    "title": "抖音测试视频",
                    "contentType": "video/mp4",
                    "sizeBytes": 5,
                }

            def processor(store, job_id, source_path):
                self.assertEqual(source_path.name, "source.mp4")
                store.write_result(job_id, {"schemaVersion": "video-project.v1", "id": job_id})
                store.update(job_id, state="ready", progress=1.0, message="done", retryable=False)

            app = create_app(
                data_root=root,
                processor=processor,
                executor=InlineExecutor(),
                probe_validator=lambda _path: None,
                douyin_downloader=downloader,
            )
            client = TestClient(app)
            response = client.post(
                "/api/videos/from-douyin",
                json={"url": "3.21 复制打开抖音 https://v.douyin.com/example/ 看视频"},
            )
            self.assertEqual(response.status_code, 202)
            status = client.get(f"/api/jobs/{response.json()['jobId']}").json()
            self.assertEqual(status["state"], "ready")
            self.assertEqual(status["sourceUrl"], "https://v.douyin.com/example/")
            self.assertEqual(status["originalName"], "抖音测试视频.mp4")

    def test_douyin_endpoint_rejects_non_douyin_urls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(data_root=Path(tmp), executor=InlineExecutor())
            response = TestClient(app).post(
                "/api/videos/from-douyin",
                json={"url": "https://example.com/video/123"},
            )
            self.assertEqual(response.status_code, 422)

    def test_showcase_preserves_manifest_order_and_filters_missing_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "jobs"
            manifest = Path(tmp) / "showcase.json"
            app = create_app(
                data_root=root,
                showcase_file=manifest,
                executor=InlineExecutor(),
            )
            store = app.state.job_store
            for job_id, state in [("bbbb", "ready_with_fallbacks"), ("aaaa", "ready")]:
                store.create(job_id, original_name=f"{job_id}.mp4", content_type="video/mp4")
                video = store.job_dir(job_id) / "media" / "source.mp4"
                video.write_bytes(b"video")
                store.write_result(job_id, {
                    "schemaVersion": "video-project.v1",
                    "id": job_id,
                    "videoUrl": f"/api/media/{job_id}/media/source.mp4",
                })
                store.update(job_id, state=state)
            manifest.write_text(json.dumps({"jobIds": ["bbbb", "missing", "aaaa"]}), encoding="utf-8")

            response = TestClient(app).get("/api/showcase")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["schemaVersion"], "video-showcase.v1")
            self.assertEqual([item["id"] for item in response.json()["items"]], ["bbbb", "aaaa"])

    def test_media_supports_range_requests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = create_app(data_root=root, executor=InlineExecutor())
            store = app.state.job_store
            store.create("aaaa", original_name="demo.mp4", content_type="video/mp4")
            (store.job_dir("aaaa") / "media" / "source.mp4").write_bytes(b"0123456789")

            response = TestClient(app).get(
                "/api/media/aaaa/media/source.mp4",
                headers={"Range": "bytes=0-3"},
            )
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.content, b"0123")


if __name__ == "__main__":
    unittest.main()
