from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
for source_root in [
    REPO_ROOT / "video_analysis_harness" / "src",
    REPO_ROOT / "video_pipeline" / "src",
    REPO_ROOT / "链路2_harness" / "src",
]:
    if str(source_root) not in sys.path:
        sys.path.insert(0, str(source_root))

from video_analysis_harness import VideoAnalysisRequest
from video_analysis_harness.runtime import create_default_harness

from .playback import prepare_playback_media
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
    try:
        load_local_env()
        job_status = store.read_status(job_id)
        original_name = job_status.get("originalName") or source_path.stem
        creator = str(job_status.get("creator") or "本地上传")

        def harness_progress(stage: str, value: float) -> None:
            store.update(
                job_id,
                state=stage,
                progress=round(value, 3),
                message=_stage_message(stage),
            )

        harness = create_default_harness(
            repo_root=REPO_ROOT,
            chain2_provider=os.getenv("CHAIN2_PROVIDER", "doubao"),
        )
        analysis = harness.run(
            VideoAnalysisRequest(
                video_id=job_id,
                source_path=source_path,
                title=Path(str(original_name)).stem,
                creator=creator,
            ),
            run_dir=job_dir,
            progress=harness_progress,
        )

        playback_path = prepare_playback_media(source_path)
        result = build_video_project_dto(
            job_id=job_id,
            environment=analysis.environment,
            chain1=analysis.understanding_supplements,
            chain2=analysis.knowledge_navigation,
            source_path=playback_path,
            fallbacks=analysis.fallbacks,
            errors=analysis.errors,
        )
        store.write_result(job_id, result)
        store.update(
            job_id,
            state=analysis.status,
            progress=1.0,
            message="视频解析完成",
            retryable=False,
            fallbacks=analysis.fallbacks,
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
        if item.get("displayMode") != "auto_prompt":
            continue
        adapted = dict(item)
        if adapted.get("type") == "claim_verification":
            has_columns = bool(adapted.get("leftColumn") and adapted.get("rightColumn"))
            requested_variant = adapted.get("cardVariant")
            is_clarification = has_columns and requested_variant in {None, "viewpoint_clarification"}
            adapted["cardVariant"] = "viewpoint_clarification" if is_clarification else "verification_result"
            adapted["subtitle"] = adapted.get("subtitle") or (
                "换个角度看看这句话" if is_clarification else "查看核验结果"
            )
            adapted["sourceCount"] = max(0, int(adapted.get("sourceCount") or 0))
            if adapted["sourceCount"] <= 0:
                adapted.pop("sourceAction", None)
            else:
                adapted["sourceAction"] = adapted.get("sourceAction") or "查看依据"
            adapted["renderMode"] = "verification_template"
            adapted.pop("cardImageUrl", None)
            if not is_clarification:
                adapted.pop("leftColumn", None)
                adapted.pop("rightColumn", None)
        for image_key in ("cardImageUrl", "hintStickerImageUrl"):
            if adapted.get(image_key):
                filename = Path(adapted[image_key]).name
                adapted[image_key] = f"/api/media/{job_id}/media/cards/{filename}"
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

def _stage_message(stage: str) -> str:
    return {
        "probing": "正在检查视频",
        "transcribing": "正在提取带时间戳文案",
        "indexing": "正在建立语义时间轴",
        "ocr": "正在读取疑似区间的画面文字",
        "chain1": "正在并行分析理解补充与知识点",
        "chain2": "正在并行分析理解补充与知识点",
        "finalizing": "正在生成播放时间轴",
    }.get(stage, "正在解析视频")
