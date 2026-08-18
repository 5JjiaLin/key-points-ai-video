from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def prepare_playback_media(source_path: Path) -> Path:
    codecs = _probe_codecs(source_path)
    if source_path.suffix.lower() == ".mp4" and codecs.get("video") == "h264" and codecs.get("audio") in {None, "aac"}:
        return source_path

    target = source_path.parent / "playback.mp4"
    temporary = source_path.parent / "playback.tmp.mp4"
    preset = os.getenv("PLAYBACK_TRANSCODE_PRESET", "veryfast")
    crf = os.getenv("PLAYBACK_TRANSCODE_CRF", "23")
    command = [
        "ffmpeg", "-y", "-v", "error", "-i", str(source_path),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale=-2:720",
        "-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p",
        "-threads", "0",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(temporary),
    ]
    timeout = int(os.getenv("PLAYBACK_TRANSCODE_TIMEOUT_SECONDS", "7200"))
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        temporary.unlink(missing_ok=True)
        raise RuntimeError("playback transcode timed out") from exc
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"playback transcode failed: {(result.stderr or result.stdout)[-500:]}")
    temporary.replace(target)
    return target


def _probe_codecs(path: Path) -> dict[str, str]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"playback probe failed: {(result.stderr or result.stdout)[-500:]}")
    payload = json.loads(result.stdout)
    return {
        stream["codec_type"]: stream["codec_name"]
        for stream in payload.get("streams") or []
        if stream.get("codec_type") in {"video", "audio"} and stream.get("codec_name")
    }
