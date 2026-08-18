from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VideoSource:
    video_id: str
    path: Path
    title: str
    language: str = "zh"
    creator: str = "本地上传"

