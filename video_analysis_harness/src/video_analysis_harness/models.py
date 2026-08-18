from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class VideoAnalysisRequest:
    video_id: str
    source_path: Path
    title: str
    creator: str = "本地上传"


@dataclass(frozen=True)
class VideoAnalysisResult:
    run_id: str
    video_id: str
    status: str
    environment_snapshot_id: str
    environment_path: Path
    environment: dict[str, Any]
    understanding_supplements: dict[str, Any]
    knowledge_navigation: dict[str, Any]
    fallbacks: list[str]
    errors: dict[str, str]
    trace_path: Path

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": "video-analysis.v1",
            "runId": self.run_id,
            "videoId": self.video_id,
            "status": self.status,
            "environmentSnapshotId": self.environment_snapshot_id,
            "environmentPath": str(self.environment_path),
            "capabilities": {
                "understandingSupplements": self.understanding_supplements,
                "knowledgeNavigation": self.knowledge_navigation,
            },
            "fallbacks": self.fallbacks,
            "errors": self.errors,
            "tracePath": str(self.trace_path),
        }
