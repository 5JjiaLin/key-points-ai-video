from __future__ import annotations

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
for source_root in [REPO_ROOT / "video_pipeline" / "src", REPO_ROOT / "链路2_harness" / "src"]:
    if str(source_root) not in sys.path:
        sys.path.insert(0, str(source_root))

from huazhongdian_harness.environment_analysis import analyze_environment
from huazhongdian_harness.providers import provider_from_name
from video_pipeline import PreprocessingConfig, VideoSource, preprocess_video

from .store import JobStore


def load_local_env() -> None:
    for path in [REPO_ROOT / ".env", REPO_ROOT / "链路2_harness" / ".env", REPO_ROOT / "链路1_harness" / ".env"]:
        if not path.is_file():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def process_job(store: JobStore, job_id: str, source_path: Path) -> None:
    job_dir = store.job_dir(job_id)
    fallbacks: list[str] = []
    errors: dict[str, str] = {}
    try:
        load_local_env()
        original_name = store.read_status(job_id).get("originalName") or source_path.stem

        def preprocessing_progress(stage: str, value: float) -> None:
            store.update(
                job_id,
                state=stage,
                progress=round(value * 0.55, 3),
                message=_stage_message(stage),
            )

        preprocessing = preprocess_video(
            source=VideoSource(video_id=job_id, path=source_path, title=Path(str(original_name)).stem),
            out_dir=job_dir / "evidence",
            config=PreprocessingConfig.from_environment(),
            progress=preprocessing_progress,
        )
        environment_path = Path(preprocessing["environmentPath"])
        environment = json.loads(environment_path.read_text(encoding="utf-8"))

        store.update(job_id, state="chain1", progress=0.58, message="正在并行分析理解补充与知识点")
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix=f"video-{job_id}") as executor:
            chain1_future = executor.submit(_run_chain1, job_dir, environment_path)
            chain2_future = executor.submit(
                analyze_environment,
                environment_path=environment_path,
                out_dir=job_dir / "chain2",
                provider=provider_from_name("doubao"),
                progress=lambda _stage, value: store.update(
                    job_id,
                    state="chain2",
                    progress=round(0.58 + value * 0.36, 3),
                    message="正在并行分析理解补充与知识点",
                ),
            )
            try:
                chain1 = chain1_future.result()
                if chain1.get("status") == "failed":
                    fallbacks.append("chain1_failed")
                elif chain1.get("status") == "ready_with_fallbacks":
                    fallbacks.append("chain1_partial_fallback")
            except Exception as exc:
                errors["chain1"] = str(exc)
                fallbacks.append("chain1_failed")
                chain1 = {"videoId": job_id, "status": "failed", "supplements": []}
            try:
                chain2 = chain2_future.result()
                if chain2.get("status") == "ready_with_fallbacks":
                    fallbacks.append("chain2_partial_fallback")
            except Exception as exc:
                errors["chain2"] = str(exc)
                fallbacks.append("chain2_deterministic_fallback")
                chain2 = _fallback_chain2(environment)

        store.update(job_id, state="finalizing", progress=0.96, message="正在生成播放时间轴")
        result = build_video_project_dto(
            job_id=job_id,
            environment=environment,
            chain1=chain1,
            chain2=chain2,
            source_path=source_path,
            fallbacks=fallbacks,
            errors=errors,
        )
        store.write_result(job_id, result)
        state = "ready_with_fallbacks" if fallbacks else "ready"
        store.update(
            job_id,
            state=state,
            progress=1.0,
            message="视频解析完成",
            retryable=False,
            fallbacks=fallbacks,
        )
    except Exception as exc:
        store.update(
            job_id,
            state="failed",
            progress=1.0,
            message="视频解析失败",
            error=str(exc),
            retryable=True,
        )


def build_video_project_dto(
    *,
    job_id: str,
    environment: dict[str, Any],
    chain1: dict[str, Any],
    chain2: dict[str, Any],
    source_path: Path,
    fallbacks: list[str],
    errors: dict[str, str],
) -> dict[str, Any]:
    video = environment["video"]
    knowledge_points = []
    for order, item in enumerate(chain2.get("knowledgePoints") or [], start=1):
        knowledge_points.append(
            {
                "id": item["id"],
                "title": item["statement"],
                "factualStatement": item["statement"],
                "question": item.get("question") or item["statement"],
                "answer": item.get("answer") or item["statement"],
                "startMs": item["startMs"],
                "endMs": item["endMs"],
                "order": order,
                "taskType": item.get("taskType"),
                "evidenceSegmentIds": item.get("evidenceSegmentIds") or [],
            }
        )
    supplements = []
    for item in chain1.get("supplements") or []:
        adapted = dict(item)
        if adapted.get("cardImageUrl"):
            filename = Path(adapted["cardImageUrl"]).name
            adapted["cardImageUrl"] = f"/api/media/{job_id}/media/cards/{filename}"
        adapted["evidenceSegmentIds"] = [
            segment["id"]
            for segment in environment["semanticSegments"]
            if segment["endMs"] >= adapted["startMs"] and segment["startMs"] <= adapted["endMs"]
        ]
        supplements.append(adapted)
    return {
        "schemaVersion": "video-project.v1",
        "id": job_id,
        "title": video["title"],
        "creator": video.get("creator") or "本地上传",
        "durationMs": video["durationMs"],
        "videoUrl": f"/api/media/{job_id}/media/{source_path.name}",
        "transcriptSegments": environment["semanticSegments"],
        "knowledgePoints": knowledge_points,
        "supplements": supplements,
        "analysisStatus": {
            "state": "ready_with_fallbacks" if fallbacks else "ready",
            "fallbacks": fallbacks,
            "errors": errors,
            "diagnostics": environment["diagnostics"],
        },
    }


def _run_chain1(job_dir: Path, environment_path: Path) -> dict[str, Any]:
    chain1_dir = REPO_ROOT / "链路1_harness"
    entrypoint = chain1_dir / "dist" / "run-environment.js"
    if not entrypoint.is_file():
        raise RuntimeError("chain1 is not built; run npm run build in 链路1_harness")
    output = job_dir / "chain1" / "result.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ)
    environment["CHAIN1_TRACE_DIR"] = str(job_dir / "chain1" / "traces")
    environment["CHAIN1_ASSET_DIR"] = str(job_dir / "media" / "cards")
    result = subprocess.run(
        ["node", str(entrypoint), str(environment_path), str(output)],
        cwd=chain1_dir,
        env=environment,
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if result.returncode != 0:
        raise RuntimeError(f"chain1 failed: {(result.stderr or result.stdout)[-500:]}")
    return json.loads(output.read_text(encoding="utf-8"))


def _fallback_chain2(environment: dict[str, Any]) -> dict[str, Any]:
    points: list[dict[str, Any]] = []
    segments = environment["semanticSegments"]
    for index in range(0, len(segments), 2):
        group = segments[index:index + 2]
        if not group:
            continue
        text = "".join(item["text"] for item in group).strip()
        point_id = f"fallback-kp-{len(points) + 1:03d}"
        points.append({
            "id": point_id,
            "statement": text,
            "question": "这段内容的关键结论是什么？",
            "answer": text[:80],
            "startMs": group[0]["startMs"],
            "endMs": group[-1]["endMs"],
            "taskType": "待模型复核",
            "evidenceSegmentIds": [item["id"] for item in group],
        })
    return {
        "videoId": environment["video"]["id"],
        "status": "ready_with_fallbacks",
        "knowledgePoints": points,
    }


def _stage_message(stage: str) -> str:
    return {
        "probing": "正在检查视频",
        "transcribing": "正在提取带时间戳文案",
        "indexing": "正在建立语义时间轴",
        "ocr": "正在读取疑似区间的画面文字",
    }.get(stage, "正在解析视频")
