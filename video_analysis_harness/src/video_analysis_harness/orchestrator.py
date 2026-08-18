from __future__ import annotations

import hashlib
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Protocol

from .models import VideoAnalysisRequest, VideoAnalysisResult
from .trace import RootTrace


ProgressCallback = Callable[[str, float], None]


class Preprocessor(Protocol):
    def run(
        self,
        request: VideoAnalysisRequest,
        run_dir: Path,
        progress: ProgressCallback | None,
    ) -> dict[str, Any]: ...


class CapabilityRunner(Protocol):
    def run(
        self,
        environment_path: Path,
        run_dir: Path,
        progress: ProgressCallback | None,
    ) -> dict[str, Any]: ...


class RequiredCapabilityError(RuntimeError):
    """Raised when the required knowledge-navigation capability cannot finish."""


class VideoAnalysisHarness:
    def __init__(
        self,
        *,
        preprocessor: Preprocessor,
        understanding_supplements: CapabilityRunner,
        knowledge_navigation: CapabilityRunner,
    ) -> None:
        self.preprocessor = preprocessor
        self.understanding_supplements = understanding_supplements
        self.knowledge_navigation = knowledge_navigation

    def run(
        self,
        request: VideoAnalysisRequest,
        *,
        run_dir: Path,
        progress: ProgressCallback | None = None,
    ) -> VideoAnalysisResult:
        output = run_dir.expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        run_id = f"video_run_{uuid.uuid4().hex}"
        trace = RootTrace(output / "trace.jsonl")
        trace.append({"runId": run_id, "step": "run_started", "status": "started"})

        try:
            preprocessing = self.preprocessor.run(
                request,
                output,
                self._scaled_progress(progress, start=0.0, span=0.55),
            )
            environment_path = Path(str(preprocessing["environmentPath"])).expanduser().resolve()
            environment = _load_environment(environment_path, request.video_id)
            snapshot_id = _environment_snapshot_id(environment)
        except Exception as exc:
            trace.append({
                "runId": run_id,
                "step": "run_failed",
                "status": "failed",
                "error": str(exc),
            })
            raise
        trace.append({
            "runId": run_id,
            "environmentSnapshotId": snapshot_id,
            "step": "environment_ready",
            "status": "completed",
            "output": {
                "schemaVersion": environment["schemaVersion"],
                "asrSegmentCount": len(environment["asrSegments"]),
                "semanticSegmentCount": len(environment["semanticSegments"]),
            },
        })

        if progress:
            progress("chain1", 0.58)
        trace.append({
            "runId": run_id,
            "environmentSnapshotId": snapshot_id,
            "step": "capabilities_started",
            "status": "started",
        })
        chain2_progress = self._scaled_progress(progress, start=0.58, span=0.36, stage="chain2")
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix=f"video-{request.video_id}") as executor:
            chain1_future = executor.submit(
                self.understanding_supplements.run,
                environment_path,
                output,
                None,
            )
            chain2_future = executor.submit(
                self.knowledge_navigation.run,
                environment_path,
                output,
                chain2_progress,
            )
            fallbacks: list[str] = []
            errors: dict[str, str] = {}
            try:
                chain1 = chain1_future.result()
                _require_capability_result(
                    chain1,
                    video_id=request.video_id,
                    items_key="supplements",
                    capability="understanding supplements",
                )
                if chain1.get("status") == "failed":
                    fallbacks.append("chain1_failed")
                elif chain1.get("status") == "ready_with_fallbacks":
                    fallbacks.append("chain1_partial_fallback")
                elif chain1.get("status") != "ready":
                    raise ValueError(
                        f"understanding supplements returned {chain1.get('status') or 'unknown'}"
                    )
                trace.append({
                    "runId": run_id,
                    "environmentSnapshotId": snapshot_id,
                    "step": "understanding_supplements",
                    "status": "failed" if chain1["status"] == "failed" else "completed",
                    "output": {
                        "capabilityStatus": chain1["status"],
                        "itemCount": len(chain1["supplements"]),
                    },
                })
            except Exception as exc:
                errors["chain1"] = str(exc)
                fallbacks.append("chain1_failed")
                chain1 = {
                    "videoId": request.video_id,
                    "status": "failed",
                    "supplements": [],
                }
                trace.append({
                    "runId": run_id,
                    "environmentSnapshotId": snapshot_id,
                    "step": "understanding_supplements",
                    "status": "failed",
                    "error": str(exc),
                })

            try:
                chain2 = chain2_future.result()
                _require_capability_result(
                    chain2,
                    video_id=request.video_id,
                    items_key="knowledgePoints",
                    capability="knowledge navigation",
                )
                if chain2.get("status") != "ready":
                    raise RuntimeError(
                        "knowledge navigation returned "
                        f"{chain2.get('status') or 'unknown'}"
                    )
                trace.append({
                    "runId": run_id,
                    "environmentSnapshotId": snapshot_id,
                    "step": "knowledge_navigation",
                    "status": "completed",
                    "output": {
                        "capabilityStatus": chain2["status"],
                        "itemCount": len(chain2["knowledgePoints"]),
                    },
                })
            except Exception as exc:
                trace.append({
                    "runId": run_id,
                    "environmentSnapshotId": snapshot_id,
                    "step": "knowledge_navigation",
                    "status": "failed",
                    "error": str(exc),
                })
                trace.append({
                    "runId": run_id,
                    "environmentSnapshotId": snapshot_id,
                    "step": "run_failed",
                    "status": "failed",
                    "error": str(exc),
                })
                raise RequiredCapabilityError(
                    f"knowledge navigation strict pipeline failed: {exc}"
                ) from exc

        status = "ready_with_fallbacks" if fallbacks else "ready"
        result = VideoAnalysisResult(
            run_id=run_id,
            video_id=request.video_id,
            status=status,
            environment_snapshot_id=snapshot_id,
            environment_path=environment_path,
            environment=environment,
            understanding_supplements=chain1,
            knowledge_navigation=chain2,
            fallbacks=fallbacks,
            errors=errors,
            trace_path=trace.path,
        )
        result_path = output / "video_analysis_result.json"
        result_path.write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        trace.append({
            "runId": run_id,
            "environmentSnapshotId": snapshot_id,
            "step": "run_completed",
            "status": "completed",
            "output": {
                "analysisStatus": status,
                "fallbacks": fallbacks,
                "resultPath": str(result_path),
            },
        })
        if progress:
            progress("finalizing", 0.96)
        return result

    @staticmethod
    def _scaled_progress(
        progress: ProgressCallback | None,
        *,
        start: float,
        span: float,
        stage: str | None = None,
    ) -> ProgressCallback | None:
        if progress is None:
            return None

        def update(child_stage: str, value: float) -> None:
            bounded = max(0.0, min(1.0, value))
            progress(stage or child_stage, start + bounded * span)

        return update


def _load_environment(path: Path, video_id: str) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != "video-environment.v1":
        raise ValueError("unified harness requires video-environment.v1")
    video = value.get("video")
    if not isinstance(video, dict) or video.get("id") != video_id:
        raise ValueError("video environment does not match the analysis request")
    for key in ("asrSegments", "semanticSegments", "ocrSegments", "keyframes", "analysisChunks"):
        if not isinstance(value.get(key), list):
            raise ValueError(f"video environment field {key} must be an array")
    if not value["asrSegments"] or not value["semanticSegments"]:
        raise ValueError("video environment requires timestamped ASR and semantic segments")
    return value


def _environment_snapshot_id(environment: dict[str, Any]) -> str:
    video = environment["video"]
    keyframes = [
        {key: value for key, value in frame.items() if key != "path"}
        for frame in environment["keyframes"]
        if isinstance(frame, dict)
    ]
    payload = {
        "schemaVersion": environment["schemaVersion"],
        "video": {
            "id": video.get("id"),
            "hash": video.get("hash"),
            "durationMs": video.get("durationMs"),
        },
        "asrSegments": environment["asrSegments"],
        "semanticSegments": environment["semanticSegments"],
        "ocrSegments": environment["ocrSegments"],
        "keyframes": keyframes,
        "analysisChunks": environment["analysisChunks"],
    }
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"video_environment_{digest[:20]}"


def _require_capability_result(
    value: Any,
    *,
    video_id: str,
    items_key: str,
    capability: str,
) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{capability} result must be an object")
    if value.get("videoId") != video_id:
        raise ValueError(f"{capability} result videoId does not match the request")
    if not isinstance(value.get("status"), str):
        raise ValueError(f"{capability} result status is missing")
    if not isinstance(value.get(items_key), list):
        raise ValueError(f"{capability} result {items_key} must be an array")
