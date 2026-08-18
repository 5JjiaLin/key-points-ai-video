from __future__ import annotations

import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .pipeline import process_job
from .store import JobStore

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/x-m4v", "video/webm", "application/octet-stream"}


def create_app(
    *,
    data_root: Path | None = None,
    processor: Callable[[JobStore, str, Path], None] = process_job,
    executor: Any | None = None,
    probe_validator: Callable[[Path], None] | None = None,
) -> FastAPI:
    store = JobStore(data_root or Path(os.getenv("BACKEND_DATA_DIR", "backend_data/jobs")))
    work_executor = executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix="video-analysis")
    validate_probe = probe_validator or validate_video_file
    app = FastAPI(title="划重点本地视频解析 API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "workerConcurrency": 1}

    @app.post("/api/videos", status_code=202)
    async def upload_video(file: UploadFile = File(...)) -> dict[str, Any]:
        suffix = Path(file.filename or "").suffix.lower()
        content_type = file.content_type or "application/octet-stream"
        if suffix not in ALLOWED_EXTENSIONS or content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(415, "只支持 MP4、MOV、M4V 和 WebM 视频")
        job_id = str(uuid4())
        status = store.create(job_id, original_name=file.filename or "video", content_type=content_type)
        target = store.job_dir(job_id) / "media" / f"source{suffix}"
        max_bytes = int(os.getenv("MAX_UPLOAD_BYTES", str(500 * 1024 * 1024)))
        size = 0
        try:
            with target.open("wb") as handle:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(413, "视频超过500MB限制")
                    handle.write(chunk)
            validate_probe(target)
        except Exception:
            target.unlink(missing_ok=True)
            raise
        store.update(job_id, sizeBytes=size)
        work_executor.submit(processor, store, job_id, target)
        return {"jobId": job_id, "status": status["state"]}

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str) -> dict[str, Any]:
        try:
            return store.read_status(job_id)
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "任务不存在") from None

    @app.get("/api/jobs/{job_id}/result")
    def job_result(job_id: str) -> dict[str, Any]:
        try:
            status = store.read_status(job_id)
            if status["state"] not in {"ready", "ready_with_fallbacks"}:
                raise HTTPException(409, "任务尚未完成")
            return store.read_result(job_id)
        except FileNotFoundError:
            raise HTTPException(404, "结果不存在") from None

    @app.post("/api/jobs/{job_id}/retry", status_code=202)
    def retry_job(job_id: str) -> dict[str, Any]:
        try:
            status = store.read_status(job_id)
            if status["state"] != "failed" or not status.get("retryable"):
                raise HTTPException(409, "当前任务不可重试")
            media = next((store.job_dir(job_id) / "media").glob("source.*"), None)
            if media is None:
                raise HTTPException(409, "原视频已不存在")
            store.update(job_id, state="queued", progress=0.0, message="已重新加入队列", retryable=False, error=None)
            work_executor.submit(processor, store, job_id, media)
            return {"jobId": job_id, "status": "queued"}
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "任务不存在") from None

    @app.get("/api/media/{job_id}/{relative_path:path}")
    def media(job_id: str, relative_path: str) -> FileResponse:
        try:
            path = store.media_file(job_id, relative_path)
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "媒体不存在") from None
        if not path.is_file():
            raise HTTPException(404, "媒体不存在")
        return FileResponse(path)

    app.state.job_store = store
    return app


def validate_video_file(path: Path) -> None:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise HTTPException(422, "视频文件无法解析")
    try:
        payload = json.loads(result.stdout)
        duration = float((payload.get("format") or {}).get("duration") or 0)
        has_video = any(item.get("codec_type") == "video" for item in payload.get("streams") or [])
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(422, "视频元数据无效") from None
    if duration <= 0 or not has_video:
        raise HTTPException(422, "文件不包含可播放视频流")


app = create_app()

