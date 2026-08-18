from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from huazhongdian_harness.models import VideoFrame
from huazhongdian_harness.providers import DoubaoProvider


class ProviderTests(unittest.TestCase):
    def test_doubao_provider_accepts_ark_env_aliases(self) -> None:
        captured: dict = {}

        class FakeResponse:
            status_code = 200
            text = "{}"

            def json(self) -> dict:
                return {
                    "output": [
                        {
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": '{"ok":true}',
                                }
                            ]
                        }
                    ]
                }

        def fake_post(endpoint: str, *, headers: dict, json: dict, timeout: float) -> FakeResponse:
            captured["endpoint"] = endpoint
            captured["headers"] = headers
            captured["json"] = json
            captured["timeout"] = timeout
            return FakeResponse()

        env = {
            "ARK_API_KEY": "ark-test-key",
            "ARK_API_ENDPOINT_ID": "doubao-test-model",
        }
        with patch.dict(os.environ, env, clear=True), patch("httpx.post", side_effect=fake_post):
            content = DoubaoProvider().complete(
                system_prompt="system",
                user_prompt="user",
                temperature=0,
            )

        self.assertEqual(content, '{"ok":true}')
        self.assertEqual(captured["json"]["model"], "doubao-test-model")
        self.assertIn("/responses", captured["endpoint"])
        self.assertEqual(captured["headers"]["Authorization"], "Bearer ark-test-key")

    def test_doubao_provider_sends_video_to_responses_api(self) -> None:
        captured: dict = {}

        class FakeResponse:
            status_code = 200
            text = "{}"

            def json(self) -> dict:
                return {"output_text": '{"ok":true}'}

        def fake_post(endpoint: str, *, headers: dict, json: dict, timeout: float) -> FakeResponse:
            captured["json"] = json
            return FakeResponse()

        env = {
            "ARK_API_KEY": "ark-test-key",
            "ARK_API_ENDPOINT_ID": "doubao-test-model",
        }
        with patch.dict(os.environ, env, clear=True), patch("httpx.post", side_effect=fake_post):
            content = DoubaoProvider().complete_with_video(
                system_prompt="system",
                user_prompt="user",
                video_data_url="data:video/mp4;base64,AAAA",
                video_fps=1,
                temperature=0,
            )

        self.assertEqual(content, '{"ok":true}')
        request_content = captured["json"]["input"][0]["content"]
        self.assertEqual(request_content[0]["type"], "input_video")
        self.assertEqual(request_content[0]["video_url"], "data:video/mp4;base64,AAAA")
        self.assertEqual(request_content[0]["fps"], 1)

    def test_doubao_provider_sends_frames_to_responses_api(self) -> None:
        captured: dict = {}

        class FakeResponse:
            status_code = 200
            text = "{}"

            def json(self) -> dict:
                return {"output_text": '{"ok":true}'}

        def fake_post(endpoint: str, *, headers: dict, json: dict, timeout: float) -> FakeResponse:
            captured["json"] = json
            return FakeResponse()

        env = {
            "ARK_API_KEY": "ark-test-key",
            "ARK_API_ENDPOINT_ID": "doubao-test-model",
        }
        with patch.dict(os.environ, env, clear=True), patch("httpx.post", side_effect=fake_post):
            content = DoubaoProvider().complete_with_frames(
                system_prompt="system",
                user_prompt="user",
                frames=[
                    VideoFrame(timestamp_seconds=75, image_data_url="data:image/jpeg;base64,AAAA")
                ],
                temperature=0,
            )

        self.assertEqual(content, '{"ok":true}')
        request_content = captured["json"]["input"][0]["content"]
        self.assertEqual(request_content[0]["type"], "input_text")
        self.assertEqual(request_content[1]["type"], "input_text")
        self.assertIn("01:15", request_content[1]["text"])
        self.assertEqual(request_content[2]["type"], "input_image")
        self.assertEqual(request_content[2]["image_url"], "data:image/jpeg;base64,AAAA")

    def test_doubao_provider_uploads_file_and_sends_file_id_to_responses_api(self) -> None:
        captured: list[dict] = []

        class UploadResponse:
            status_code = 200
            text = "{}"

            def json(self) -> dict:
                return {"id": "file-test-123"}

        class CompletionResponse:
            status_code = 200
            text = "{}"

            def json(self) -> dict:
                return {"output_text": '{"ok":true}'}

        def fake_post(endpoint: str, **kwargs) -> UploadResponse | CompletionResponse:
            captured.append({"endpoint": endpoint, **kwargs})
            if endpoint.endswith("/files"):
                return UploadResponse()
            return CompletionResponse()

        env = {
            "ARK_API_KEY": "ark-test-key",
            "ARK_API_ENDPOINT_ID": "doubao-test-model",
            "ARK_FILE_PURPOSE": "user_data",
        }
        with tempfile.TemporaryDirectory() as tmp:
            video_path = Path(tmp) / "video.mp4"
            video_path.write_bytes(b"fake video")
            with patch.dict(os.environ, env, clear=True), patch("httpx.post", side_effect=fake_post):
                provider = DoubaoProvider()
                content = provider.complete_with_file(
                    system_prompt="system",
                    user_prompt="user",
                    video_path=video_path,
                    temperature=0,
                )
                provider.complete_with_file(
                    system_prompt="system",
                    user_prompt="user",
                    video_path=video_path,
                    temperature=0,
                )

        self.assertEqual(content, '{"ok":true}')
        self.assertEqual(captured[0]["endpoint"], "https://ark.cn-beijing.volces.com/api/v3/files")
        self.assertEqual(captured[0]["data"], {"purpose": "user_data"})
        self.assertIn("file", captured[0]["files"])
        request_content = captured[1]["json"]["input"][0]["content"]
        self.assertEqual(request_content[1], {"type": "input_video", "file_id": "file-test-123"})
        self.assertEqual(len([call for call in captured if call["endpoint"].endswith("/files")]), 1)


if __name__ == "__main__":
    unittest.main()
