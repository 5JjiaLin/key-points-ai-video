from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .store import JobStore


READY_STATES = {"ready", "ready_with_fallbacks"}


class ShowcaseStore:
    def __init__(self, path: Path, jobs: JobStore) -> None:
        self.path = path.expanduser().resolve()
        self.jobs = jobs

    def read(self) -> dict[str, Any]:
        job_ids = self._read_job_ids()
        items: list[dict[str, Any]] = []
        for job_id in job_ids:
            try:
                status = self.jobs.read_status(job_id)
                result = self.jobs.read_result(job_id)
                if status.get("state") not in READY_STATES or not self._has_video(job_id, result):
                    continue
            except (FileNotFoundError, ValueError):
                continue
            items.append(result)
        return {"schemaVersion": "video-showcase.v1", "items": items}

    def _read_job_ids(self) -> list[str]:
        if not self.path.is_file():
            return []
        value = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("jobIds"), list):
            raise ValueError(f"Invalid showcase manifest: {self.path}")
        return [job_id for job_id in value["jobIds"] if isinstance(job_id, str)]

    def _has_video(self, job_id: str, result: dict[str, Any]) -> bool:
        prefix = f"/api/media/{job_id}/"
        video_url = result.get("videoUrl")
        if not isinstance(video_url, str) or not video_url.startswith(prefix):
            return False
        return self.jobs.media_file(job_id, video_url.removeprefix(prefix)).is_file()
