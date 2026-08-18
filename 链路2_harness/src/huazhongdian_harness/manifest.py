from __future__ import annotations

import json
from pathlib import Path

from .models import ManifestCase, ManifestError


def read_manifest(path: str | Path, *, validate_files: bool = True) -> list[ManifestCase]:
    manifest_path = Path(path).expanduser().resolve()
    if not manifest_path.exists():
        raise ManifestError(f"Manifest not found: {manifest_path}")

    cases: list[ManifestCase] = []
    with manifest_path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                row = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ManifestError(f"Line {line_no}: invalid JSONL row") from exc
            if not isinstance(row, dict):
                raise ManifestError(f"Line {line_no}: row must be a JSON object")

            try:
                case = ManifestCase.from_json(
                    row,
                    base_dir=manifest_path.parent,
                    source_line=line_no,
                )
            except ManifestError as exc:
                raise ManifestError(f"Line {line_no}: {exc}") from exc

            if validate_files and not case.video_path.exists():
                raise ManifestError(f"Line {line_no}: video not found: {case.video_path}")
            if validate_files and case.sidecar_text_path and not case.sidecar_text_path.exists():
                raise ManifestError(f"Line {line_no}: sidecar not found: {case.sidecar_text_path}")
            cases.append(case)

    return cases
