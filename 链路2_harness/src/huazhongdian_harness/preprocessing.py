from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from video_pipeline import (
    FasterWhisperTranscriber,
    PreprocessingConfig,
    PreprocessingError,
    VideoSource,
    build_analysis_chunks,
    build_semantic_segments,
    preprocess_video,
    select_ocr_timestamps,
    select_ocr_timestamps_by_chunk,
    validate_environment,
)

from .manifest import read_manifest
from .models import ManifestCase


def preprocess_case(
    *,
    case: ManifestCase,
    out_dir: Path,
    config: PreprocessingConfig,
    transcriber: Any | None = None,
) -> dict[str, Any]:
    return preprocess_video(
        source=VideoSource(
            video_id=case.video_id,
            path=case.video_path,
            title=case.title,
            language=case.language,
        ),
        out_dir=out_dir,
        config=config,
        transcriber=transcriber,
    )


def preprocess_manifest(
    *,
    manifest_path: Path,
    out_dir: Path,
    config: PreprocessingConfig,
    transcriber: Any | None = None,
) -> dict[str, Any]:
    cases = read_manifest(manifest_path)
    output_root = out_dir.expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    shared_transcriber = transcriber or FasterWhisperTranscriber(config)
    generated_rows: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    for case in cases:
        result = preprocess_case(
            case=case,
            out_dir=output_root / case.case_id,
            config=config,
            transcriber=shared_transcriber,
        )
        results.append(result)
        generated_rows.append(
            {
                "case_id": case.case_id,
                "video_id": case.video_id,
                "video_path": str(case.video_path),
                "title": case.title,
                "duration_seconds": result["durationMs"] / 1000,
                "language": case.language,
                "sidecar_text_path": result["transcriptPath"],
                "environment_path": result["environmentPath"],
            }
        )
    generated_manifest = output_root / "videos.preprocessed.jsonl"
    generated_manifest.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in generated_rows),
        encoding="utf-8",
    )
    summary = {
        "status": "ready",
        "manifestPath": str(manifest_path.expanduser().resolve()),
        "generatedManifestPath": str(generated_manifest),
        "config": asdict(config),
        "cases": results,
    }
    (output_root / "preprocessing_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


__all__ = [
    "FasterWhisperTranscriber",
    "PreprocessingConfig",
    "PreprocessingError",
    "build_analysis_chunks",
    "build_semantic_segments",
    "preprocess_case",
    "preprocess_manifest",
    "select_ocr_timestamps",
    "select_ocr_timestamps_by_chunk",
    "validate_environment",
]
