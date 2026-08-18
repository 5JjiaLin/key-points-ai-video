from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import threading
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Protocol

from .models import VideoSource


class PreprocessingError(RuntimeError):
    """Raised when the shared video preprocessing pipeline cannot finish."""


ProgressCallback = Callable[[str, float], None]
_OCR_FRAMES_PER_ABSTRACT_SEGMENT = 3


@dataclass(frozen=True)
class PreprocessingConfig:
    asr_provider: str = "faster_whisper"
    asr_model_size: str = "base"
    asr_device: str = "cpu"
    asr_compute_type: str = "int8"
    asr_beam_size: int = 5
    asr_condition_on_previous_text: bool = False
    asr_initial_prompt: str = "请输出准确的简体中文口播文案，保留数字、金额和专有名词。"
    asr_word_timestamps: bool = True
    asr_max_segment_seconds: float = 8.0
    asr_max_segment_chars: int = 50
    funasr_model: str = "paraformer-zh"
    funasr_vad_model: str = "fsmn-vad"
    funasr_punc_model: str = "ct-punc"
    funasr_batch_size_seconds: int = 60
    funasr_hotwords: str = ""
    language: str = "zh"
    analysis_chunk_seconds: float = 240.0
    analysis_chunk_overlap_seconds: float = 12.0
    semantic_max_seconds: float = 24.0
    semantic_max_chars: int = 180
    ocr_enabled: bool = True
    ocr_frames_per_chunk: int = 8
    ocr_periodic_seconds: float = 60.0
    ocr_scene_threshold: float = 0.35
    keyframe_max_edge: int = 960

    @classmethod
    def from_environment(cls) -> "PreprocessingConfig":
        return cls(
            asr_provider=os.getenv("VIDEO_ASR_PROVIDER", "faster_whisper"),
            asr_model_size=os.getenv("VIDEO_ASR_MODEL_SIZE", "base"),
            asr_device=os.getenv("VIDEO_ASR_DEVICE", "cpu"),
            asr_compute_type=os.getenv("VIDEO_ASR_COMPUTE_TYPE", "int8"),
            asr_beam_size=int(os.getenv("VIDEO_ASR_BEAM_SIZE", "5")),
            asr_condition_on_previous_text=_env_bool(
                "VIDEO_ASR_CONDITION_ON_PREVIOUS_TEXT", False
            ),
            asr_initial_prompt=os.getenv(
                "VIDEO_ASR_INITIAL_PROMPT",
                "请输出准确的简体中文口播文案，保留数字、金额和专有名词。",
            ),
            asr_word_timestamps=_env_bool("VIDEO_ASR_WORD_TIMESTAMPS", True),
            asr_max_segment_seconds=float(
                os.getenv("VIDEO_ASR_MAX_SEGMENT_SECONDS", "8")
            ),
            asr_max_segment_chars=int(os.getenv("VIDEO_ASR_MAX_SEGMENT_CHARS", "50")),
            funasr_model=os.getenv("VIDEO_FUNASR_MODEL", "paraformer-zh"),
            funasr_vad_model=os.getenv("VIDEO_FUNASR_VAD_MODEL", "fsmn-vad"),
            funasr_punc_model=os.getenv("VIDEO_FUNASR_PUNC_MODEL", "ct-punc"),
            funasr_batch_size_seconds=int(
                os.getenv("VIDEO_FUNASR_BATCH_SIZE_SECONDS", "60")
            ),
            funasr_hotwords=os.getenv("VIDEO_FUNASR_HOTWORDS", ""),
            language=os.getenv("VIDEO_ASR_LANGUAGE", "zh"),
            analysis_chunk_seconds=float(os.getenv("VIDEO_ANALYSIS_CHUNK_SECONDS", "240")),
            analysis_chunk_overlap_seconds=float(
                os.getenv("VIDEO_ANALYSIS_CHUNK_OVERLAP_SECONDS", "12")
            ),
            semantic_max_seconds=float(os.getenv("VIDEO_SEMANTIC_MAX_SECONDS", "24")),
            semantic_max_chars=int(os.getenv("VIDEO_SEMANTIC_MAX_CHARS", "180")),
            ocr_enabled=_env_bool("VIDEO_OCR_ENABLED", True),
            ocr_frames_per_chunk=int(os.getenv("VIDEO_OCR_FRAMES_PER_CHUNK", "8")),
            ocr_periodic_seconds=float(os.getenv("VIDEO_OCR_PERIODIC_SECONDS", "60")),
            ocr_scene_threshold=float(os.getenv("VIDEO_OCR_SCENE_THRESHOLD", "0.35")),
            keyframe_max_edge=int(os.getenv("VIDEO_KEYFRAME_MAX_EDGE", "960")),
        )


class TimedTranscriber(Protocol):
    def transcribe(self, audio_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]: ...


_WHISPER_MODEL_CACHE: dict[tuple[str, str, str], Any] = {}
_WHISPER_MODEL_LOCK = threading.Lock()


def _load_whisper_model(model_size: str, device: str, compute_type: str) -> Any:
    """Return a process-wide cached WhisperModel so repeated jobs skip reloading."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise PreprocessingError("faster-whisper is required for preprocessing") from exc
    key = (model_size, device, compute_type)
    cached = _WHISPER_MODEL_CACHE.get(key)
    if cached is not None:
        return cached
    with _WHISPER_MODEL_LOCK:
        cached = _WHISPER_MODEL_CACHE.get(key)
        if cached is None:
            cached = WhisperModel(model_size, device=device, compute_type=compute_type)
            _WHISPER_MODEL_CACHE[key] = cached
    return cached


class FasterWhisperTranscriber:
    def __init__(self, config: PreprocessingConfig) -> None:
        self.config = config
        self._model: Any | None = None

    def transcribe(self, audio_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        if self._model is None:
            self._model = _load_whisper_model(
                self.config.asr_model_size,
                self.config.asr_device,
                self.config.asr_compute_type,
            )
        try:
            raw_segments, info = self._model.transcribe(
                str(audio_path),
                language=self.config.language or None,
                vad_filter=True,
                beam_size=self.config.asr_beam_size,
                condition_on_previous_text=self.config.asr_condition_on_previous_text,
                initial_prompt=self.config.asr_initial_prompt or None,
                word_timestamps=self.config.asr_word_timestamps,
            )
            segments = _normalize_asr_segments(
                raw_segments,
                max_seconds=self.config.asr_max_segment_seconds,
                max_chars=self.config.asr_max_segment_chars,
            )
        except Exception as exc:
            raise PreprocessingError(f"ASR failed: {str(exc)[:300]}") from exc
        segments = [segment for segment in segments if segment["text"]]
        if not segments:
            raise PreprocessingError("ASR produced no timestamped text")
        return segments, {
            "status": "ok",
            "engine": "faster_whisper",
            "modelSize": self.config.asr_model_size,
            "beamSize": self.config.asr_beam_size,
            "conditionOnPreviousText": self.config.asr_condition_on_previous_text,
            "wordTimestamps": self.config.asr_word_timestamps,
            "language": getattr(info, "language", self.config.language),
            "languageProbability": getattr(info, "language_probability", None),
        }


class FunASRTranscriber:
    def __init__(self, config: PreprocessingConfig) -> None:
        self.config = config
        self._model: Any | None = None

    def transcribe(self, audio_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        if self._model is None:
            try:
                from funasr import AutoModel
            except ImportError as exc:
                raise PreprocessingError("FunASR is required for the funasr ASR provider") from exc
            try:
                self._model = AutoModel(
                    model=self.config.funasr_model,
                    vad_model=self.config.funasr_vad_model,
                    punc_model=self.config.funasr_punc_model,
                    device=self.config.asr_device,
                    disable_update=True,
                    disable_pbar=True,
                    log_level="WARNING",
                    seed=0,
                )
            except Exception as exc:
                raise PreprocessingError(
                    f"FunASR model loading failed: {str(exc)[:300]}"
                ) from exc

        generate_options: dict[str, Any] = {
            "input": str(audio_path),
            "batch_size_s": self.config.funasr_batch_size_seconds,
            "sentence_timestamp": True,
            "output_timestamp": True,
            "return_raw_text": True,
        }
        if self.config.funasr_hotwords.strip():
            generate_options["hotword"] = self.config.funasr_hotwords.strip()
        try:
            results = self._model.generate(**generate_options)
            if not isinstance(results, list) or not results or not isinstance(results[0], dict):
                raise PreprocessingError("FunASR returned an invalid result")
            segments = _normalize_funasr_result(
                results[0],
                max_seconds=self.config.asr_max_segment_seconds,
                max_chars=self.config.asr_max_segment_chars,
            )
        except PreprocessingError:
            raise
        except Exception as exc:
            raise PreprocessingError(f"FunASR failed: {str(exc)[:300]}") from exc
        if not segments:
            raise PreprocessingError("FunASR produced no timestamped text")
        return segments, {
            "status": "ok",
            "engine": "funasr",
            "model": self.config.funasr_model,
            "vadModel": self.config.funasr_vad_model,
            "puncModel": self.config.funasr_punc_model,
            "timestampSource": "native",
            "language": self.config.language,
        }


class FallbackTimedTranscriber:
    def __init__(self, primary: TimedTranscriber, fallback: TimedTranscriber) -> None:
        self.primary = primary
        self.fallback = fallback

    def transcribe(self, audio_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        try:
            return self.primary.transcribe(audio_path)
        except PreprocessingError as exc:
            segments, diagnostics = self.fallback.transcribe(audio_path)
            return segments, {
                **diagnostics,
                "fallbackUsed": True,
                "fallbackReason": str(exc)[:300],
            }


def create_transcriber(config: PreprocessingConfig) -> TimedTranscriber:
    provider = config.asr_provider.strip().lower()
    if provider == "faster_whisper":
        return FasterWhisperTranscriber(config)
    if provider == "funasr":
        return FallbackTimedTranscriber(
            FunASRTranscriber(config), FasterWhisperTranscriber(config)
        )
    raise PreprocessingError(f"Unsupported ASR provider: {config.asr_provider}")


def preprocess_video(
    *,
    source: VideoSource,
    out_dir: Path,
    config: PreprocessingConfig | None = None,
    transcriber: TimedTranscriber | None = None,
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    resolved = source.path.expanduser().resolve()
    if not resolved.is_file():
        raise PreprocessingError(f"Video not found: {resolved}")
    settings = config or PreprocessingConfig.from_environment()
    output = out_dir.expanduser().resolve()
    keyframe_dir = output / "keyframes"
    output.mkdir(parents=True, exist_ok=True)
    keyframe_dir.mkdir(parents=True, exist_ok=True)
    for stale_keyframe in keyframe_dir.glob("keyframe-*.jpg"):
        stale_keyframe.unlink()
    status_path = output / "status.json"

    def advance(stage: str, value: float) -> None:
        _write_json(status_path, {"videoId": source.video_id, "stage": stage, "progress": value})
        if progress:
            progress(stage, value)

    try:
        advance("probing", 0.05)
        probe = _probe_video(resolved)
        duration = float(probe["durationSeconds"])
        if duration <= 0:
            raise PreprocessingError("Could not determine video duration")

        audio_path = output / "audio.wav"
        _extract_audio(resolved, audio_path)
        advance("transcribing", 0.18)
        engine = transcriber or create_transcriber(settings)
        asr_segments, asr_diagnostics = engine.transcribe(audio_path)
        asr_segments = [
            {**segment, "text": to_simplified_chinese(str(segment.get("text") or ""))}
            for segment in asr_segments
        ]
        asr_diagnostics = {**asr_diagnostics, "textScript": "simplified_chinese"}
        audio_path.unlink(missing_ok=True)

        advance("indexing", 0.48)
        semantic_segments = build_semantic_segments(
            asr_segments,
            max_seconds=settings.semantic_max_seconds,
            max_chars=settings.semantic_max_chars,
        )
        chunks = build_analysis_chunks(
            duration_seconds=duration,
            chunk_seconds=settings.analysis_chunk_seconds,
            overlap_seconds=settings.analysis_chunk_overlap_seconds,
        )

        advance("ocr", 0.58)
        ocr_segments: list[dict[str, Any]] = []
        keyframes: list[dict[str, Any]] = []
        ocr_diagnostics: dict[str, Any] = {"status": "disabled", "errors": []}
        if settings.ocr_enabled:
            ocr_segments, keyframes, ocr_diagnostics = _build_visual_evidence(
                video_path=resolved,
                duration_seconds=duration,
                semantic_segments=semantic_segments,
                chunks=chunks,
                keyframe_dir=keyframe_dir,
                config=settings,
            )

        semantic_segments = _attach_evidence(semantic_segments, ocr_segments, keyframes)
        chunks = _attach_chunk_evidence(
            chunks,
            semantic_segments,
            keyframes,
            frames_per_chunk=settings.ocr_frames_per_chunk,
        )
        environment = {
            "schemaVersion": "video-environment.v1",
            "video": {
                "id": source.video_id,
                "hash": _sha256(resolved),
                "title": source.title,
                "creator": source.creator,
                "language": source.language,
                "durationMs": round(duration * 1000),
                "sourcePath": str(resolved),
            },
            "asrSegments": asr_segments,
            "semanticSegments": semantic_segments,
            "ocrSegments": ocr_segments,
            "keyframes": keyframes,
            "analysisChunks": chunks,
            "diagnostics": {
                "pipelineVersion": "shared-evidence-v1",
                "config": asdict(settings),
                "probe": probe,
                "asr": asr_diagnostics,
                "ocr": ocr_diagnostics,
            },
        }
        validate_environment(environment)
        environment_path = output / "video_environment.v1.json"
        transcript_path = output / "transcript.md"
        _write_json(environment_path, environment)
        transcript_path.write_text(_render_transcript(environment), encoding="utf-8")
        result = {
            "videoId": source.video_id,
            "status": "ready",
            "durationMs": environment["video"]["durationMs"],
            "environmentPath": str(environment_path),
            "transcriptPath": str(transcript_path),
            "asrSegmentCount": len(asr_segments),
            "semanticSegmentCount": len(semantic_segments),
            "ocrSegmentCount": len(ocr_segments),
            "keyframeCount": len(keyframes),
            "analysisChunkCount": len(chunks),
        }
        _write_json(status_path, result)
        return result
    except Exception as exc:
        _write_json(
            status_path,
            {"videoId": source.video_id, "status": "failed", "error": str(exc)},
        )
        raise


def build_analysis_chunks(
    *, duration_seconds: float, chunk_seconds: float, overlap_seconds: float
) -> list[dict[str, Any]]:
    if duration_seconds <= 0 or chunk_seconds <= 0:
        raise PreprocessingError("duration_seconds and chunk_seconds must be positive")
    if overlap_seconds < 0 or overlap_seconds >= chunk_seconds:
        raise PreprocessingError("overlap_seconds must be >= 0 and less than chunk_seconds")
    chunks: list[dict[str, Any]] = []
    start = 0.0
    step = chunk_seconds - overlap_seconds
    while start < duration_seconds:
        end = min(duration_seconds, start + chunk_seconds)
        chunks.append(
            {
                "id": f"chunk-{len(chunks) + 1:03d}",
                "startMs": round(start * 1000),
                "endMs": round(end * 1000),
                "semanticSegmentIds": [],
                "keyframeIds": [],
            }
        )
        if end >= duration_seconds:
            break
        start += step
    return chunks


def build_semantic_segments(
    asr_segments: list[dict[str, Any]], *, max_seconds: float, max_chars: int
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    group: list[dict[str, Any]] = []

    def flush() -> None:
        if not group:
            return
        result.append(
            {
                "id": f"semantic-{len(result) + 1:04d}",
                "startMs": group[0]["startMs"],
                "endMs": group[-1]["endMs"],
                "text": "".join(item["text"].strip() for item in group).strip(),
                "asrSegmentIds": [item["id"] for item in group],
                "ocrSegmentIds": [],
                "keyframeIds": [],
            }
        )
        group.clear()

    for segment in asr_segments:
        if group and segment["startMs"] - group[-1]["endMs"] > 2500:
            flush()
        group.append(segment)
        duration = (group[-1]["endMs"] - group[0]["startMs"]) / 1000
        chars = sum(len(item["text"]) for item in group)
        if duration >= max_seconds or chars >= max_chars or re.search(
            r"[。！？!?；;]$", group[-1]["text"].strip()
        ):
            flush()
    flush()
    return result


def select_ocr_timestamps_by_chunk(
    *,
    semantic_segments: list[dict[str, Any]],
    analysis_chunks: list[dict[str, Any]],
    scene_timestamps: list[float],
    periodic_seconds: float,
    frames_per_chunk: int,
) -> list[float]:
    if frames_per_chunk <= 0:
        return []
    del periodic_seconds
    selected: list[float] = []
    for chunk in analysis_chunks:
        start = chunk["startMs"] / 1000
        end = chunk["endMs"] / 1000
        abstract_segments = [
            segment
            for segment in semantic_segments
            if segment["endMs"] >= chunk["startMs"]
            and segment["startMs"] <= chunk["endMs"]
            and _needs_abstract_visual_check(segment["text"])
        ]
        chunk_selected: list[float] = []
        for segment in abstract_segments:
            segment_start = max(segment["startMs"] / 1000, start)
            segment_end = min(segment["endMs"] / 1000, end)
            duration = max(segment_end - segment_start, 0.0)
            if duration <= 0:
                continue
            midpoint = segment_start + duration / 2
            local_scenes = sorted(
                (
                    value
                    for value in scene_timestamps
                    if segment_start <= value <= segment_end
                ),
                key=lambda value: abs(value - midpoint),
            )
            sample_points = [
                midpoint,
                *local_scenes,
                segment_start + duration * 0.25,
                segment_start + duration * 0.75,
            ]
            segment_selected = _dedupe_timestamps(sample_points, minimum_gap=1.0)[
                :_OCR_FRAMES_PER_ABSTRACT_SEGMENT
            ]
            for timestamp in segment_selected:
                if len(chunk_selected) >= frames_per_chunk:
                    break
                if any(abs(existing - timestamp) < 1.0 for existing in chunk_selected):
                    continue
                chunk_selected.append(round(timestamp, 3))
            if len(chunk_selected) >= frames_per_chunk:
                break
        for timestamp in sorted(chunk_selected):
            if any(abs(existing - timestamp) < 1.0 for existing in selected):
                continue
            selected.append(timestamp)
    return sorted(selected)


def select_ocr_timestamps(
    *,
    semantic_segments: list[dict[str, Any]],
    duration_seconds: float,
    periodic_seconds: float,
    scene_timestamps: list[float],
    max_frames: int,
) -> list[float]:
    chunks = build_analysis_chunks(
        duration_seconds=duration_seconds,
        chunk_seconds=duration_seconds,
        overlap_seconds=0,
    )
    return select_ocr_timestamps_by_chunk(
        semantic_segments=semantic_segments,
        analysis_chunks=chunks,
        scene_timestamps=scene_timestamps,
        periodic_seconds=periodic_seconds,
        frames_per_chunk=max_frames,
    )[:max_frames]


def validate_environment(value: dict[str, Any]) -> None:
    if value.get("schemaVersion") != "video-environment.v1":
        raise PreprocessingError("Unsupported video environment schema")
    video = value.get("video")
    if not isinstance(video, dict) or not video.get("id") or not video.get("hash"):
        raise PreprocessingError("VideoEnvironmentV1.video is invalid")
    if not isinstance(video.get("durationMs"), int) or video["durationMs"] <= 0:
        raise PreprocessingError("VideoEnvironmentV1.video.durationMs is invalid")
    for key in [
        "asrSegments",
        "semanticSegments",
        "ocrSegments",
        "keyframes",
        "analysisChunks",
    ]:
        if not isinstance(value.get(key), list):
            raise PreprocessingError(f"VideoEnvironmentV1.{key} must be an array")
    if not value["asrSegments"] or not value["semanticSegments"]:
        raise PreprocessingError("VideoEnvironmentV1 requires ASR and semantic segments")


def _build_visual_evidence(
    *,
    video_path: Path,
    duration_seconds: float,
    semantic_segments: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
    keyframe_dir: Path,
    config: PreprocessingConfig,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    if not shutil.which("ffmpeg"):
        return [], [], {"status": "skipped", "reason": "ffmpeg_not_found", "errors": []}
    if not any(_needs_abstract_visual_check(item["text"]) for item in semantic_segments):
        return [], [], {
            "status": "skipped",
            "reason": "no_abstract_visual_candidate",
            "selectionPolicy": "abstract_quantity_with_intuitive_cue_v1",
            "maxFramesPerCandidate": _OCR_FRAMES_PER_ABSTRACT_SEGMENT,
            "selectedFrameCount": 0,
            "extractedFrameCount": 0,
            "errors": [],
        }
    script = Path(__file__).with_name("vision_ocr.swift")
    ocr_engine = _detect_ocr_engine(script)
    scenes = _collect_scene_change_timestamps(
        video_path,
        threshold=config.ocr_scene_threshold,
        limit=max(len(chunks) * config.ocr_frames_per_chunk, 1),
    )
    timestamps = select_ocr_timestamps_by_chunk(
        semantic_segments=semantic_segments,
        analysis_chunks=chunks,
        scene_timestamps=scenes,
        periodic_seconds=config.ocr_periodic_seconds,
        frames_per_chunk=config.ocr_frames_per_chunk,
    )
    ocr_segments: list[dict[str, Any]] = []
    keyframes: list[dict[str, Any]] = []
    errors: list[str] = []
    previous_text = ""
    for index, timestamp in enumerate(timestamps, start=1):
        frame_id = f"keyframe-{index:04d}"
        frame_path = keyframe_dir / f"{frame_id}-{round(timestamp * 1000)}ms.jpg"
        try:
            _extract_frame(video_path, timestamp, frame_path, config.keyframe_max_edge)
        except PreprocessingError as exc:
            errors.append(str(exc))
            continue
        lines: list[str] = []
        if ocr_engine:
            try:
                raw_lines = (
                    _run_vision_ocr(script, frame_path)
                    if ocr_engine == "macos_vision"
                    else _run_tesseract_ocr(frame_path)
                )
                lines = [to_simplified_chinese(line) for line in raw_lines]
            except PreprocessingError as exc:
                errors.append(str(exc))
        text = " | ".join(_dedupe_lines(lines))
        ocr_ids: list[str] = []
        if text and text.casefold() != previous_text.casefold():
            ocr_id = f"ocr-{len(ocr_segments) + 1:04d}"
            ocr_segments.append(
                {
                    "id": ocr_id,
                    "startMs": round(timestamp * 1000),
                    "endMs": round(min(duration_seconds, timestamp + 1) * 1000),
                    "text": text,
                    "keyframeId": frame_id,
                }
            )
            ocr_ids.append(ocr_id)
            previous_text = text
        keyframes.append(
            {
                "id": frame_id,
                "timestampMs": round(timestamp * 1000),
                "path": str(frame_path),
                "ocrSegmentIds": ocr_ids,
                "ocrText": [text] if text else [],
                "containsScaleVisualization": bool(_SCALE_RE.search(text)),
                "containsChartOrSource": bool(_CHART_RE.search(text)),
                "containsSimulation": bool(_SIMULATION_RE.search(text)),
            }
        )
    return ocr_segments, keyframes, {
        "status": "ok" if ocr_engine else "keyframes_only",
        "engine": ocr_engine,
        "selectionPolicy": "abstract_quantity_with_intuitive_cue_v1",
        "maxFramesPerCandidate": _OCR_FRAMES_PER_ABSTRACT_SEGMENT,
        "selectedFrameCount": len(timestamps),
        "extractedFrameCount": len(keyframes),
        "errors": errors[:20],
    }


def _attach_evidence(
    semantic_segments: list[dict[str, Any]],
    ocr_segments: list[dict[str, Any]],
    keyframes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for segment in semantic_segments:
        enriched = dict(segment)
        enriched["ocrSegmentIds"] = [
            item["id"]
            for item in ocr_segments
            if item["endMs"] >= segment["startMs"] and item["startMs"] <= segment["endMs"]
        ]
        enriched["keyframeIds"] = [
            item["id"]
            for item in keyframes
            if segment["startMs"] - 2000 <= item["timestampMs"] <= segment["endMs"] + 15000
        ]
        output.append(enriched)
    return output


def _attach_chunk_evidence(
    chunks: list[dict[str, Any]],
    semantic_segments: list[dict[str, Any]],
    keyframes: list[dict[str, Any]],
    *,
    frames_per_chunk: int,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for chunk in chunks:
        enriched = dict(chunk)
        enriched["semanticSegmentIds"] = [
            item["id"]
            for item in semantic_segments
            if item["endMs"] >= chunk["startMs"] and item["startMs"] <= chunk["endMs"]
        ]
        chunk_keyframes = [
            item
            for item in keyframes
            if chunk["startMs"] <= item["timestampMs"] <= chunk["endMs"]
        ]
        enriched["keyframeIds"] = [
            item["id"]
            for item in _budget_chunk_keyframes(chunk_keyframes, frames_per_chunk)
        ]
        output.append(enriched)
    return output


def _budget_chunk_keyframes(
    keyframes: list[dict[str, Any]], frames_per_chunk: int
) -> list[dict[str, Any]]:
    if frames_per_chunk <= 0:
        return []
    if len(keyframes) <= frames_per_chunk:
        return sorted(keyframes, key=lambda item: item["timestampMs"])
    evidence = [
        item
        for item in keyframes
        if item.get("ocrText")
        or item.get("containsScaleVisualization")
        or item.get("containsChartOrSource")
        or item.get("containsSimulation")
    ][:frames_per_chunk]
    chosen_ids = {item["id"] for item in evidence}
    remainder = [item for item in keyframes if item["id"] not in chosen_ids]
    slots = frames_per_chunk - len(evidence)
    if slots > 0 and remainder:
        if slots == 1:
            evidence.append(remainder[len(remainder) // 2])
        else:
            indices = {
                round(index * (len(remainder) - 1) / (slots - 1))
                for index in range(slots)
            }
            evidence.extend(remainder[index] for index in sorted(indices))
    return sorted(evidence[:frames_per_chunk], key=lambda item: item["timestampMs"])


def _normalize_asr_segments(
    segments: Any,
    *,
    max_seconds: float,
    max_chars: int,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for segment in segments:
        words = list(getattr(segment, "words", None) or [])
        if words:
            output.extend(
                _normalize_asr_words(words, max_seconds=max_seconds, max_chars=max_chars)
            )
        else:
            output.append(_normalize_asr_segment(segment, 0))
    for index, item in enumerate(output):
        item["id"] = f"asr-{index + 1:04d}"
    return output


def _normalize_funasr_result(
    result: dict[str, Any], *, max_seconds: float, max_chars: int
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for sentence in result.get("sentence_info") or []:
        if not isinstance(sentence, dict):
            continue
        text = str(sentence.get("sentence") or sentence.get("text") or "").strip()
        start = sentence.get("start")
        end = sentence.get("end")
        if not text or not isinstance(start, int | float) or not isinstance(end, int | float):
            continue
        start_ms = max(round(float(start)), 0)
        end_ms = max(round(float(end)), start_ms)
        if end_ms > start_ms:
            output.append(
                {"id": "", "startMs": start_ms, "endMs": end_ms, "text": text}
            )

    if not output:
        raw_text = str(result.get("raw_text") or "").strip()
        timestamps = result.get("timestamp") or result.get("timestamps") or []
        tokens = raw_text.split()
        if tokens and len(tokens) == len(timestamps):
            timed_tokens: list[Any] = []
            for token, timestamp in zip(tokens, timestamps):
                if not isinstance(timestamp, (list, tuple)) or len(timestamp) < 2:
                    continue
                start, end = timestamp[:2]
                if not isinstance(start, int | float) or not isinstance(end, int | float):
                    continue
                timed_tokens.append(
                    _TimedToken(
                        word=token,
                        start=max(float(start) / 1000, 0.0),
                        end=max(float(end) / 1000, float(start) / 1000),
                    )
                )
            output = _normalize_asr_words(
                timed_tokens, max_seconds=max_seconds, max_chars=max_chars
            )

    for index, item in enumerate(output):
        item["id"] = f"asr-{index + 1:04d}"
    return output


@dataclass(frozen=True)
class _TimedToken:
    word: str
    start: float
    end: float


def _normalize_asr_words(
    words: list[Any],
    *,
    max_seconds: float,
    max_chars: int,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    group: list[Any] = []

    def flush() -> None:
        if not group:
            return
        text = "".join(str(getattr(word, "word", "")) for word in group).strip()
        if not text:
            group.clear()
            return
        start = max(float(getattr(group[0], "start", 0.0) or 0.0), 0.0)
        end = max(float(getattr(group[-1], "end", start) or start), start)
        item: dict[str, Any] = {
            "id": "",
            "startMs": round(start * 1000),
            "endMs": round(end * 1000),
            "text": text,
        }
        probabilities = [
            float(probability)
            for word in group
            if isinstance((probability := getattr(word, "probability", None)), int | float)
        ]
        if probabilities:
            item["confidence"] = round(sum(probabilities) / len(probabilities), 4)
        output.append(item)
        group.clear()

    for word in words:
        text = str(getattr(word, "word", ""))
        if not text:
            continue
        word_start = float(getattr(word, "start", 0.0) or 0.0)
        if group:
            group_start = float(getattr(group[0], "start", word_start) or word_start)
            current_text = "".join(str(getattr(item, "word", "")) for item in group)
            if word_start - group_start >= max_seconds or len(current_text) + len(text) > max_chars:
                flush()
        group.append(word)
        if re.search(r"[。！？!?；;，,]$", text.strip()):
            flush()
    flush()
    return output


def _normalize_asr_segment(segment: Any, index: int) -> dict[str, Any]:
    start = max(float(getattr(segment, "start", 0.0)), 0.0)
    end = max(float(getattr(segment, "end", start)), start)
    result: dict[str, Any] = {
        "id": f"asr-{index + 1:04d}",
        "startMs": round(start * 1000),
        "endMs": round(end * 1000),
        "text": str(getattr(segment, "text", "")).strip(),
    }
    avg_logprob = getattr(segment, "avg_logprob", None)
    if isinstance(avg_logprob, int | float):
        result["confidence"] = round(min(max(math.exp(float(avg_logprob)), 0.0), 1.0), 4)
    return result


def _probe_video(path: Path) -> dict[str, Any]:
    if not shutil.which("ffprobe"):
        raise PreprocessingError("ffprobe is required")
    command = [
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate",
        "-of", "json", str(path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=30)
        payload = json.loads(result.stdout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        raise PreprocessingError(f"ffprobe failed: {str(exc)[:300]}") from exc
    info = payload.get("format") or {}
    return {
        "durationSeconds": float(info.get("duration") or 0),
        "sizeBytes": int(info.get("size") or path.stat().st_size),
        "formatName": info.get("format_name"),
        "streams": payload.get("streams") or [],
    }


def _extract_audio(video_path: Path, audio_path: Path) -> None:
    if not shutil.which("ffmpeg"):
        raise PreprocessingError("ffmpeg is required")
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio_path),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=1200)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise PreprocessingError("audio extraction failed") from exc


def _collect_scene_change_timestamps(path: Path, *, threshold: float, limit: int) -> list[float]:
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "info", "-i", str(path), "-vf",
        f"select='gt(scene,{threshold})',showinfo", "-an", "-f", "null", "-",
    ]
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=1200)
    except subprocess.TimeoutExpired:
        return []
    timestamps = [float(value) for value in re.findall(r"pts_time:([0-9.]+)", result.stderr or "")]
    if len(timestamps) <= limit:
        return timestamps
    stride = max(1, len(timestamps) // limit)
    return timestamps[::stride][:limit]


def _extract_frame(path: Path, timestamp: float, output: Path, max_edge: int) -> None:
    scale = (
        f"scale='if(gt(iw,ih),min({max_edge},iw),-2)':"
        f"'if(gt(iw,ih),-2,min({max_edge},ih))'"
    )
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{timestamp:.3f}",
        "-i", str(path), "-frames:v", "1", "-vf", scale, "-q:v", "5", str(output),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise PreprocessingError(f"frame extraction failed at {timestamp:.3f}s") from exc


def _run_vision_ocr(script: Path, frame: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["swift", str(script), str(frame)],
            check=False,
            capture_output=True,
            text=True,
            timeout=45,
        )
    except subprocess.TimeoutExpired as exc:
        raise PreprocessingError(f"OCR timed out for {frame.name}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:200]
        raise PreprocessingError(f"OCR failed for {frame.name}: {detail}")
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _detect_ocr_engine(script: Path) -> str | None:
    if shutil.which("swift") and script.exists():
        return "macos_vision"
    if shutil.which("tesseract"):
        return "tesseract"
    return None


def _run_tesseract_ocr(frame: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["tesseract", str(frame), "stdout", "-l", "chi_sim+eng", "--psm", "6"],
            check=False,
            capture_output=True,
            text=True,
            timeout=45,
        )
    except subprocess.TimeoutExpired as exc:
        raise PreprocessingError(f"OCR timed out for {frame.name}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:200]
        raise PreprocessingError(f"OCR failed for {frame.name}: {detail}")
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _render_transcript(environment: dict[str, Any]) -> str:
    lines = [f"# {environment['video']['title']}", "", "## 带时间戳口播文案", ""]
    for item in environment["semanticSegments"]:
        lines.append(f"[{_format_ms(item['startMs'])} --> {_format_ms(item['endMs'])}] {item['text']}")
    if environment["ocrSegments"]:
        lines.extend(["", "## 画面文字（OCR 辅助信息）", ""])
        for item in environment["ocrSegments"]:
            lines.append(f"[{_format_ms(item['startMs'])}] {item['text']}")
    return "\n".join(lines) + "\n"


def _format_ms(value: int) -> str:
    seconds = max(value, 0) / 1000
    minutes = int(seconds // 60)
    return f"{minutes:02d}:{seconds % 60:06.3f}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _dedupe_lines(lines: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for line in lines:
        normalized = line.strip()
        key = normalized.casefold()
        if normalized and key not in seen:
            seen.add(key)
            output.append(normalized)
    return output


def to_simplified_chinese(value: str) -> str:
    detector, converter = _opencc_converters()
    if detector.convert(value) == value:
        return value
    return converter.convert(value)


@lru_cache(maxsize=1)
def _opencc_converters() -> tuple[Any, Any]:
    try:
        from opencc import OpenCC
    except ImportError as exc:
        raise PreprocessingError(
            "opencc-python-reimplemented is required for simplified Chinese output"
        ) from exc
    return OpenCC("t2s"), OpenCC("tw2s")


def _dedupe_timestamps(values: list[float], *, minimum_gap: float) -> list[float]:
    output: list[float] = []
    for value in values:
        if not any(abs(existing - value) < minimum_gap for existing in output):
            output.append(round(value, 3))
    return output


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() not in {"0", "false", "no", "off"}


_NUMBER_UNIT_RE = re.compile(
    r"(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万亿兆]+)\s*"
    r"(?:%|％|℃|度|伏|V(?![A-Za-z])|安|A(?!类)|瓦|W|米|公里|光年|秒|分钟|小时|年|倍|元|万元|亿元|万亿元|万亿|亿|万|公斤|克)"
)
_INTUITIVE_EXPLANATION_RE = re.compile(
    r"(?:什么概念|有多|相当于|约等于|差不多|接近|相近|体感|热感|冷感|换算|对比|刻度|"
    r"平铺|叠起来|能装下|放在现实|摸起来|感觉|看起来|温度区间|"
    r"长度|高度|大小|距离|速度|体积|重量|量级)"
)
_CHART_RE = re.compile(r"(?:图表|曲线|数据来源|研究|论文|报告|统计|坐标|表格)", re.I)
_SCALE_RE = re.compile(r"(?:刻度|比例|对比|倍|大小|长度|高度|温度|速度|距离)", re.I)
_SIMULATION_RE = re.compile(r"(?:模拟|演示|示意|过程|变化)", re.I)


def _needs_abstract_visual_check(text: str) -> bool:
    return bool(_NUMBER_UNIT_RE.search(text) and _INTUITIVE_EXPLANATION_RE.search(text))
