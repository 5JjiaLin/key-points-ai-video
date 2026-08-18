from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .store import JobStore


READY_STATES = {"ready", "ready_with_fallbacks"}


class KnowledgePoolStore:
    def __init__(self, path: Path, jobs: JobStore) -> None:
        self.path = path.expanduser().resolve()
        self.jobs = jobs
        self._lock = threading.Lock()

    def add(self, job_id: str) -> dict[str, Any]:
        self.jobs.read_status(job_id)
        with self._lock:
            entries = self._read_entries()
            existing = next((item for item in entries if item["jobId"] == job_id), None)
            if existing is None:
                existing = {
                    "jobId": job_id,
                    "addedAt": datetime.now(timezone.utc).isoformat(),
                }
                entries.insert(0, existing)
                self._write_entries(entries)
        return self._build_item(existing)

    def remove(self, job_id: str) -> None:
        with self._lock:
            entries = self._read_entries()
            remaining = [item for item in entries if item["jobId"] != job_id]
            if len(remaining) == len(entries):
                raise FileNotFoundError(job_id)
            self._write_entries(remaining)

    def read(self) -> dict[str, Any]:
        items: list[dict[str, Any]] = []
        for entry in self._read_entries():
            try:
                items.append(self._build_item(entry))
            except (FileNotFoundError, ValueError):
                continue
        return {"schemaVersion": "knowledge-pool.v1", "items": items}

    def contains(self, job_id: str) -> bool:
        return any(item["jobId"] == job_id for item in self._read_entries())

    def _build_item(self, entry: dict[str, Any]) -> dict[str, Any]:
        status = self.jobs.read_status(entry["jobId"])
        project = None
        if status.get("state") in READY_STATES:
            try:
                project = self.jobs.read_result(entry["jobId"])
            except FileNotFoundError:
                project = None
        return {
            "jobId": entry["jobId"],
            "addedAt": entry["addedAt"],
            "state": status.get("state", "queued"),
            "progress": float(status.get("progress") or 0),
            "message": status.get("message") or "等待解析",
            "retryable": bool(status.get("retryable")),
            **({"error": status["error"]} if status.get("error") else {}),
            "project": project,
        }

    def _read_entries(self) -> list[dict[str, str]]:
        if not self.path.is_file():
            return []
        value = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("schemaVersion") != "knowledge-pool.v1":
            raise ValueError(f"Invalid knowledge pool manifest: {self.path}")
        entries = value.get("items")
        if not isinstance(entries, list):
            raise ValueError(f"Invalid knowledge pool items: {self.path}")
        return [
            {"jobId": item["jobId"], "addedAt": item["addedAt"]}
            for item in entries
            if isinstance(item, dict)
            and isinstance(item.get("jobId"), str)
            and isinstance(item.get("addedAt"), str)
        ]

    def _write_entries(self, entries: list[dict[str, str]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(
                {"schemaVersion": "knowledge-pool.v1", "items": entries},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        temporary.replace(self.path)
