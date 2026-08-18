from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx

from .store import JobStore


READY_STATES = {"ready", "ready_with_fallbacks"}


class Chain3Error(RuntimeError):
    pass


class Chain3Adapter:
    def __init__(self, jobs: JobStore) -> None:
        self.jobs = jobs

    def build_request(
        self,
        *,
        video_ids: list[str],
        requested_analysis_mode: str,
        theme_hint: str | None,
    ) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(video_ids))
        if len(unique_ids) != len(video_ids):
            raise ValueError("视频选择中存在重复项")
        if not 3 <= len(unique_ids) <= 10:
            raise ValueError("请选择3至10条已解析视频")
        if requested_analysis_mode not in {"single_creator_series", "multi_creator_topic", "auto"}:
            raise ValueError("不支持的分析方式")

        videos = [self._build_video(job_id) for job_id in unique_ids]
        return {
            "requested_analysis_mode": requested_analysis_mode,
            "theme_hint": theme_hint or None,
            "videos": videos,
        }

    def _build_video(self, job_id: str) -> dict[str, Any]:
        status = self.jobs.read_status(job_id)
        if status.get("state") not in READY_STATES:
            raise ValueError(f"视频 {job_id} 尚未解析完成")
        project = self.jobs.read_result(job_id)
        environment_path = self.jobs.job_dir(job_id) / "evidence" / "video_environment.v1.json"
        if not environment_path.is_file():
            raise ValueError(f"视频 {job_id} 缺少共享解析证据")
        environment = json.loads(environment_path.read_text(encoding="utf-8"))
        video = environment.get("video") or {}
        creator = str(project.get("creator") or video.get("creator") or "本地上传")
        semantic_segments = environment.get("semanticSegments") or []
        knowledge_points = project.get("knowledgePoints") or []
        source_artifact = _load_source_artifact(
            job_dir=self.jobs.job_dir(job_id),
            job_id=job_id,
            environment_path=environment_path,
            environment=environment,
            creator_id=_creator_id(creator, job_id),
        )
        return {
            "video_id": job_id,
            "creator_id": _creator_id(creator, job_id),
            "creator_name": creator,
            "title": str(project.get("title") or video.get("title") or "未命名视频"),
            "duration_ms": int(project.get("durationMs") or video.get("durationMs") or 0),
            "content_version": str(video.get("hash") or "1"),
            "asr_summary": "".join(str(item.get("text") or "") for item in semantic_segments)[:2000],
            "asr_segments": [_timed_segment(item) for item in environment.get("asrSegments") or []],
            "ocr_segments": [_timed_segment(item) for item in environment.get("ocrSegments") or []],
            "visual_segments": [
                {
                    "id": item.get("id"),
                    "timestamp_ms": int(item.get("timestampMs") or 0),
                    "ocr_text": item.get("ocrText") or "",
                    "contains_chart_or_source": bool(item.get("containsChartOrSource")),
                    "contains_scale_visualization": bool(item.get("containsScaleVisualization")),
                    "contains_simulation": bool(item.get("containsSimulation")),
                }
                for item in environment.get("keyframes") or []
            ],
            "chapter_hints": [
                {
                    "id": item.get("id"),
                    "title": item.get("title") or item.get("factualStatement"),
                    "statement": item.get("factualStatement") or item.get("title"),
                    "start_ms": int(item.get("startMs") or 0),
                    "end_ms": int(item.get("endMs") or 0),
                    "evidence_segment_ids": item.get("evidenceSegmentIds") or [],
                }
                for item in knowledge_points
            ],
            **(source_artifact or {}),
        }


class Chain3Client:
    def __init__(self, base_url: str, timeout_seconds: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def start_analysis(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/analysis", json=payload)

    def get_status(self, analysis_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/analysis/{analysis_id}/status")

    def get_result(self, analysis_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/analysis/{analysis_id}/path")

    def start_reconstruction(self, analysis_id: str, research_question: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/analysis/{analysis_id}/reconstruct",
            json={"research_question": research_question},
        )

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = httpx.request(
                method,
                f"{self.base_url}{path}",
                timeout=self.timeout_seconds,
                **kwargs,
            )
        except httpx.HTTPError as exc:
            raise Chain3Error("链路3重构服务暂时不可用") from exc
        try:
            body = response.json()
        except ValueError as exc:
            raise Chain3Error("链路3重构服务返回了无效响应") from exc
        if not response.is_success:
            detail = body.get("error") if isinstance(body, dict) else None
            raise Chain3Error(str(detail or f"链路3请求失败：{response.status_code}"))
        if not isinstance(body, dict):
            raise Chain3Error("链路3重构服务返回了无效响应")
        return body


def _timed_segment(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "start_ms": int(item.get("startMs") or 0),
        "end_ms": int(item.get("endMs") or 0),
        "text": item.get("text") or "",
    }


def _creator_id(creator: str, job_id: str) -> str:
    if not creator.strip() or creator == "本地上传":
        return f"local-{job_id}"
    digest = hashlib.sha256(creator.strip().encode("utf-8")).hexdigest()[:16]
    return f"creator-{digest}"


def _load_source_artifact(
    *,
    job_dir: Path,
    job_id: str,
    environment_path: Path,
    environment: dict[str, Any],
    creator_id: str,
) -> dict[str, Any] | None:
    artifact_path = job_dir / "chain2" / "source-knowledge-artifact.v1.json"
    if not artifact_path.is_file():
        return None
    try:
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        if artifact.get("schema_version") != "source-knowledge-artifact.v1":
            return None
        if artifact.get("video_id") != job_id:
            return None
        expected_hash = hashlib.sha256(environment_path.read_bytes()).hexdigest()
        if (artifact.get("environment") or {}).get("sha256") != expected_hash:
            return None
        duration_ms = int((environment.get("video") or {}).get("durationMs") or 0)
        semantic_segments = environment.get("semanticSegments") or []
        evidence_by_id = {
            str(item.get("id")): str(item.get("text") or "")
            for item in semantic_segments
            if item.get("id")
        }
        points = []
        seen_ids: set[str] = set()
        for raw in artifact.get("knowledge_points") or []:
            point_id = str(raw.get("source_knowledge_id") or "")
            start_ms = int(raw.get("start_ms"))
            end_ms = int(raw.get("end_ms"))
            evidence_ids = [str(value) for value in raw.get("evidence_segment_ids") or []]
            statement = str(raw.get("statement") or "").strip()
            if (
                not point_id or point_id in seen_ids or raw.get("source_video_id") != job_id
                or not statement or start_ms < 0 or end_ms <= start_ms
                or (duration_ms and end_ms > duration_ms)
                or not evidence_ids or any(value not in evidence_by_id for value in evidence_ids)
            ):
                return None
            seen_ids.add(point_id)
            evidence_text = " ".join(evidence_by_id[value] for value in evidence_ids).strip()
            if not evidence_text:
                return None
            task_type = str(raw.get("task_type") or "").casefold()
            knowledge_type = "mechanism" if "mechan" in task_type else "concept"
            internal_point_id = f"{job_id}:{point_id}"
            points.append({
                "source_knowledge_id": internal_point_id,
                "title": str(raw.get("question") or statement).strip(),
                "statement": statement,
                "summary": str(raw.get("answer") or statement).strip(),
                "knowledge_type": knowledge_type,
                "knowledge_dimension": "mechanism" if knowledge_type == "mechanism" else "definition",
                "structural_role": "core",
                "source_video_id": job_id,
                "creator_id": creator_id,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "evidence_text": evidence_text,
                "evidence_segment_ids": evidence_ids,
                "visual_evidence_ids": [],
                "question_candidate": str(raw.get("question") or statement).strip(),
                "answer_candidate": str(raw.get("answer") or statement).strip(),
                "confidence": 0.85,
                "checks": {"chain2_artifact_validated": True},
            })
        if not points:
            return None
        return {
            "source_knowledge_artifact": {
                "schema_version": artifact["schema_version"],
                "artifact_id": str(artifact.get("artifact_id") or ""),
                "environment_sha256": expected_hash,
            },
            "source_knowledge_points": points,
        }
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
