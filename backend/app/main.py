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
from pydantic import BaseModel

from .douyin import DouyinDownloadError, download_douyin_video, extract_douyin_url
from .chain3 import Chain3Adapter, Chain3Client, Chain3Error
from .knowledge_pool import KnowledgePoolStore
from .pipeline import process_job
from .showcase import ShowcaseStore
from .store import JobStore

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/x-m4v", "video/webm", "application/octet-stream"}


class DouyinVideoRequest(BaseModel):
    url: str


class KnowledgePoolRequest(BaseModel):
    jobId: str


class ReconstructionRequest(BaseModel):
    videoIds: list[str]
    requestedAnalysisMode: str = "auto"
    themeHint: str | None = None


class ReconstructionPathRequest(BaseModel):
    researchQuestion: str


def create_app(
    *,
    data_root: Path | None = None,
    processor: Callable[[JobStore, str, Path], None] = process_job,
    executor: Any | None = None,
    probe_validator: Callable[[Path], None] | None = None,
    douyin_downloader: Callable[[str, Path, int], dict[str, Any]] = download_douyin_video,
    showcase_file: Path | None = None,
    knowledge_pool_file: Path | None = None,
    chain3_client: Any | None = None,
) -> FastAPI:
    store = JobStore(data_root or Path(os.getenv("BACKEND_DATA_DIR", "backend_data/jobs")))
    showcase = ShowcaseStore(
        showcase_file or Path(os.getenv("BACKEND_SHOWCASE_FILE", str(store.root.parent / "showcase.json"))),
        store,
    )
    knowledge_pool = KnowledgePoolStore(
        knowledge_pool_file
        or Path(os.getenv("BACKEND_KNOWLEDGE_POOL_FILE", str(store.root.parent / "knowledge-pool.json"))),
        store,
    )
    chain3 = chain3_client or Chain3Client(
        os.getenv("BACKEND_CHAIN3_URL", "http://127.0.0.1:8787"),
        timeout_seconds=float(os.getenv("BACKEND_CHAIN3_TIMEOUT_SECONDS", "30")),
    )
    chain3_adapter = Chain3Adapter(store)
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

    @app.get("/api/showcase")
    def video_showcase() -> dict[str, Any]:
        try:
            return showcase.read()
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(500, "展示清单无效") from None

    @app.post("/api/videos", status_code=202)
    async def upload_video(file: UploadFile = File(...)) -> dict[str, Any]:
        suffix = Path(file.filename or "").suffix.lower()
        content_type = file.content_type or "application/octet-stream"
        if suffix not in ALLOWED_EXTENSIONS or content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(415, "只支持 MP4、MOV、M4V 和 WebM 视频")
        job_id = str(uuid4())
        status = store.create(job_id, original_name=file.filename or "video", content_type=content_type)
        store.update(job_id, creator="本地上传")
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

    @app.post("/api/videos/from-douyin", status_code=202)
    def upload_douyin_video(request: DouyinVideoRequest) -> dict[str, Any]:
        try:
            source_url = extract_douyin_url(request.url)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None

        job_id = str(uuid4())
        status = store.create(job_id, original_name="抖音视频", content_type="video/douyin-link")
        store.update(job_id, sourceUrl=source_url)
        max_bytes = int(os.getenv("MAX_UPLOAD_BYTES", str(500 * 1024 * 1024)))

        def download_and_process() -> None:
            try:
                store.update(
                    job_id,
                    state="probing",
                    progress=0.02,
                    message="正在下载并验证抖音视频",
                )
                downloaded = douyin_downloader(source_url, store.job_dir(job_id) / "media", max_bytes)
                target = Path(downloaded["path"])
                validate_probe(target)
                title = str(downloaded.get("title") or "抖音视频")
                store.update(
                    job_id,
                    originalName=f"{title}{target.suffix.lower()}",
                    contentType=str(downloaded.get("contentType") or "video/mp4"),
                    sizeBytes=int(downloaded.get("sizeBytes") or target.stat().st_size),
                    sourceUrl=str(downloaded.get("url") or source_url),
                    creator=str(downloaded.get("creator") or "抖音创作者"),
                )
                processor(store, job_id, target)
            except Exception as exc:
                detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                if isinstance(exc, DouyinDownloadError):
                    detail = str(exc)
                store.update(
                    job_id,
                    state="failed",
                    progress=0.0,
                    message="抖音视频导入失败",
                    retryable=False,
                    error=str(detail)[:500],
                )

        work_executor.submit(download_and_process)
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

    @app.get("/api/knowledge-pool")
    def knowledge_pool_items() -> dict[str, Any]:
        try:
            return knowledge_pool.read()
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(500, "划重点视频池清单无效") from None

    @app.post("/api/knowledge-pool/items")
    def add_knowledge_pool_item(request: KnowledgePoolRequest) -> dict[str, Any]:
        try:
            return knowledge_pool.add(request.jobId)
        except (FileNotFoundError, ValueError):
            raise HTTPException(404, "视频任务不存在") from None

    @app.delete("/api/knowledge-pool/items/{job_id}", status_code=204)
    def delete_knowledge_pool_item(job_id: str) -> None:
        try:
            knowledge_pool.remove(job_id)
        except FileNotFoundError:
            raise HTTPException(404, "视频不在划重点视频池中") from None

    @app.post("/api/reconstructions", status_code=202)
    def start_reconstruction(request: ReconstructionRequest) -> dict[str, Any]:
        try:
            for job_id in request.videoIds:
                if not knowledge_pool.contains(job_id):
                    raise ValueError(f"视频 {job_id} 尚未加入划重点视频池")
            payload = chain3_adapter.build_request(
                video_ids=request.videoIds,
                requested_analysis_mode=request.requestedAnalysisMode,
                theme_hint=request.themeHint,
            )
            result = chain3.start_analysis(payload)
            return {
                "analysisId": result["analysis_id"],
                "status": result.get("status", "created"),
            }
        except FileNotFoundError:
            raise HTTPException(404, "所选视频任务不存在") from None
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except Chain3Error as exc:
            raise HTTPException(503, str(exc)) from None

    @app.get("/api/reconstructions/{analysis_id}")
    def reconstruction_status(analysis_id: str) -> dict[str, Any]:
        try:
            result = chain3.get_status(analysis_id)
            return {
                "analysisId": result["analysis_id"],
                "status": result["status"],
                "progress": result.get("progress", 0),
                "currentStep": result.get("current_step"),
                "error": result.get("error"),
            }
        except Chain3Error as exc:
            raise HTTPException(503, str(exc)) from None

    @app.get("/api/reconstructions/{analysis_id}/result")
    def reconstruction_result(analysis_id: str) -> dict[str, Any]:
        try:
            return chain3.get_result(analysis_id)
        except Chain3Error as exc:
            raise HTTPException(503, str(exc)) from None

    @app.post("/api/reconstructions/{analysis_id}/path", status_code=202)
    def start_reconstruction_path(
        analysis_id: str,
        request: ReconstructionPathRequest,
    ) -> dict[str, Any]:
        question = request.researchQuestion.strip()
        if not question:
            raise HTTPException(422, "研究问题不能为空")
        try:
            result = chain3.start_reconstruction(analysis_id, question)
            return {
                "analysisId": result["analysis_id"],
                "status": result.get("status", "created"),
            }
        except Chain3Error as exc:
            raise HTTPException(503, str(exc)) from None

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
    app.state.knowledge_pool_store = knowledge_pool
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
