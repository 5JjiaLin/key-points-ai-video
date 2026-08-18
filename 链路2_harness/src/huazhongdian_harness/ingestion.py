from __future__ import annotations

import base64
import mimetypes
import os
import shutil
import subprocess
import tempfile
from typing import Protocol

from .models import IngestionError, ManifestCase, VideoContext, VideoFrame


class VideoIngestionProvider(Protocol):
    def load(self, case: ManifestCase) -> VideoContext:
        """Return text that represents the video content for model prompts."""


class SidecarVideoIngestionProvider:
    """Load sidecar text when present; otherwise pass video content by configured mode."""

    def __init__(
        self,
        *,
        frame_count: int | None = None,
        max_frame_edge: int | None = None,
        video_input_mode: str | None = None,
    ) -> None:
        self.frame_count = frame_count or int(os.getenv("HARNESS_FRAME_COUNT", "12"))
        self.max_frame_edge = max_frame_edge or int(os.getenv("HARNESS_FRAME_MAX_EDGE", "768"))
        self.video_input_mode = (video_input_mode or os.getenv("HARNESS_VIDEO_INPUT_MODE", "frames")).strip().lower()

    def load(self, case: ManifestCase) -> VideoContext:
        if not case.video_path.exists():
            raise IngestionError(f"Video not found: {case.video_path}")

        if case.sidecar_text_path is not None:
            if not case.sidecar_text_path.exists():
                raise IngestionError(f"Sidecar not found: {case.sidecar_text_path}")
            text = case.sidecar_text_path.read_text(encoding="utf-8").strip()
            if not text:
                raise IngestionError(f"Sidecar is empty: {case.sidecar_text_path}")
            return VideoContext(case=case, source_text=text)

        if self.video_input_mode == "file":
            _video_mime_type(case.video_path.suffix.lower())
            return VideoContext(case=case, source_text="", use_file_api=True)

        if self.video_input_mode not in {"frames", "inline"}:
            raise IngestionError(
                "HARNESS_VIDEO_INPUT_MODE must be one of: frames, file, inline"
            )

        if self.video_input_mode == "inline":
            suffix = case.video_path.suffix.lower()
            mime_type = _video_mime_type(suffix)
            with case.video_path.open("rb") as handle:
                encoded = base64.b64encode(handle.read()).decode("ascii")
            return VideoContext(
                case=case,
                source_text="",
                video_data_url=f"data:{mime_type};base64,{encoded}",
                video_fps=1.0,
            )

        frames = _extract_video_frames(
            case=case,
            frame_count=self.frame_count,
            max_frame_edge=self.max_frame_edge,
        )
        return VideoContext(
            case=case,
            source_text="",
            frames=frames,
        )


def _video_mime_type(suffix: str) -> str:
    explicit = {
        ".mp4": "video/mp4",
        ".m4v": "video/mp4",
        ".mov": "video/mov",
        ".avi": "video/avi",
    }
    if suffix in explicit:
        return explicit[suffix]
    guessed, _ = mimetypes.guess_type(f"file{suffix}")
    if guessed and guessed.startswith("video/"):
        return guessed
    raise IngestionError(f"Unsupported video extension for inline multimodal input: {suffix}")


def _extract_video_frames(
    *,
    case: ManifestCase,
    frame_count: int,
    max_frame_edge: int,
) -> list[VideoFrame]:
    if frame_count < 1:
        raise IngestionError("frame_count must be >= 1")
    if max_frame_edge < 64:
        raise IngestionError("max_frame_edge must be >= 64")
    if not shutil.which("ffmpeg"):
        raise IngestionError("ffmpeg is required for frame extraction when sidecar_text_path is absent")

    duration = max(case.duration_seconds, 0)
    if duration <= 0:
        timestamps = [0.0]
    else:
        count = min(frame_count, max(1, int(duration)))
        step = duration / (count + 1)
        timestamps = [round(step * index, 3) for index in range(1, count + 1)]

    frames: list[VideoFrame] = []
    with tempfile.TemporaryDirectory(prefix="harness_frames_") as tmp:
        tmp_dir = os.fsdecode(tmp)
        for index, timestamp in enumerate(timestamps, start=1):
            out_path = os.path.join(tmp_dir, f"frame_{index:03d}.jpg")
            scale_filter = (
                f"scale='if(gt(iw,ih),min({max_frame_edge},iw),-2)':"
                f"'if(gt(iw,ih),-2,min({max_frame_edge},ih))'"
            )
            command = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{timestamp:.3f}",
                "-i",
                str(case.video_path),
                "-frames:v",
                "1",
                "-vf",
                scale_filter,
                "-q:v",
                "5",
                out_path,
            ]
            try:
                subprocess.run(command, check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as exc:
                detail = (exc.stderr or exc.stdout or "").strip()
                raise IngestionError(f"ffmpeg failed to extract frame at {timestamp:.3f}s: {detail}") from exc
            with open(out_path, "rb") as handle:
                encoded = base64.b64encode(handle.read()).decode("ascii")
            frames.append(
                VideoFrame(
                    timestamp_seconds=timestamp,
                    image_data_url=f"data:image/jpeg;base64,{encoded}",
                )
            )

    if not frames:
        raise IngestionError(f"No frames extracted from video: {case.video_path}")
    return frames
