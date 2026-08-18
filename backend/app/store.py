from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def job_dir(self, job_id: str) -> Path:
        if not job_id or any(char not in "0123456789abcdef-" for char in job_id.lower()):
            raise ValueError("invalid job id")
        return self.root / job_id

    def create(self, job_id: str, *, original_name: str, content_type: str | None) -> dict[str, Any]:
        directory = self.job_dir(job_id)
        (directory / "media").mkdir(parents=True, exist_ok=False)
        status = {
            "jobId": job_id,
            "state": "queued",
            "progress": 0.0,
            "message": "已加入解析队列",
            "retryable": False,
            "originalName": original_name,
            "contentType": content_type,
        }
        self.write_status(job_id, status)
        return status

    def read_status(self, job_id: str) -> dict[str, Any]:
        return self._read_json(self.job_dir(job_id) / "status.json")

    def write_status(self, job_id: str, value: dict[str, Any]) -> None:
        self._write_json(self.job_dir(job_id) / "status.json", value)

    def update(self, job_id: str, **changes: Any) -> dict[str, Any]:
        with self._lock:
            status = self.read_status(job_id)
            status.update(changes)
            self._write_json(self.job_dir(job_id) / "status.json", status)
            return status

    def write_result(self, job_id: str, value: dict[str, Any]) -> None:
        self._write_json(self.job_dir(job_id) / "result.json", value)

    def read_result(self, job_id: str) -> dict[str, Any]:
        return self._read_json(self.job_dir(job_id) / "result.json")

    def media_file(self, job_id: str, relative_path: str) -> Path:
        root = self.job_dir(job_id)
        candidate = (root / relative_path).resolve()
        if root not in candidate.parents or candidate.suffix.lower() not in {
            ".mp4", ".mov", ".m4v", ".webm", ".jpg", ".jpeg", ".png", ".webp"
        }:
            raise ValueError("invalid media path")
        return candidate

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        if not path.is_file():
            raise FileNotFoundError(path)
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError(f"Expected object in {path}")
        return value

    @staticmethod
    def _write_json(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)

