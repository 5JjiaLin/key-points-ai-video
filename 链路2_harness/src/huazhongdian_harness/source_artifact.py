from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def build_source_knowledge_artifact(
    *, environment_path: Path, video_id: str, knowledge_points: list[dict[str, Any]]
) -> dict[str, Any]:
    environment_sha256 = hashlib.sha256(environment_path.read_bytes()).hexdigest()
    normalized = [
        {
            "source_knowledge_id": str(point["id"]),
            "source_video_id": video_id,
            "statement": str(point["statement"]),
            "question": str(point.get("question") or point["statement"]),
            "answer": str(point.get("answer") or point["statement"]),
            "start_ms": int(point["startMs"]),
            "end_ms": int(point["endMs"]),
            "evidence_segment_ids": [str(value) for value in point.get("evidenceSegmentIds") or []],
            **({"task_type": str(point["taskType"])} if point.get("taskType") else {}),
        }
        for point in knowledge_points
    ]
    payload_hash = hashlib.sha256(
        json.dumps(normalized, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "schema_version": "source-knowledge-artifact.v1",
        "artifact_id": f"ska_{payload_hash[:24]}",
        "video_id": video_id,
        "environment": {"schema_version": "video-environment.v1", "sha256": environment_sha256},
        "producer": {"name": "chain2-harness", "version": "0.1.0"},
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "knowledge_points": normalized,
    }


def write_source_knowledge_artifact(path: Path, artifact: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
