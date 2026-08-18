from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.playback import prepare_playback_media


class PlaybackTests(unittest.TestCase):
    def test_keeps_h264_aac_mp4(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.mp4"
            source.write_bytes(b"source")
            probe = subprocess.CompletedProcess(
                [], 0, json.dumps({"streams": [
                    {"codec_type": "video", "codec_name": "h264"},
                    {"codec_type": "audio", "codec_name": "aac"},
                ]}), "",
            )
            with patch("app.playback.subprocess.run", return_value=probe) as run:
                self.assertEqual(prepare_playback_media(source), source)
            self.assertEqual(run.call_count, 1)

    def test_transcodes_hevc_to_fixed_playback_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.mp4"
            source.write_bytes(b"source")
            probe = subprocess.CompletedProcess(
                [], 0, json.dumps({"streams": [
                    {"codec_type": "video", "codec_name": "hevc"},
                    {"codec_type": "audio", "codec_name": "aac"},
                ]}), "",
            )

            def run(command, **_kwargs):
                if command[0] == "ffprobe":
                    return probe
                Path(command[-1]).write_bytes(b"playback")
                return subprocess.CompletedProcess(command, 0, "", "")

            with patch("app.playback.subprocess.run", side_effect=run):
                target = prepare_playback_media(source)
            self.assertEqual(target.name, "playback.mp4")
            self.assertEqual(target.read_bytes(), b"playback")


if __name__ == "__main__":
    unittest.main()
