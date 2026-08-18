from __future__ import annotations

import hashlib
import platform
import subprocess
import sys
from importlib import resources
from pathlib import Path
from typing import Any

from .ingestion import SidecarVideoIngestionProvider
from .models import ManifestCase, VideoContext


PROMPT_ASSETS = [
    "knowledge_point_selection.md",
    "card_generation.md",
    "quality_audit.md",
]


def build_environment_snapshot(
    *,
    case: ManifestCase,
    provider_name: str,
    model_name: str,
    context: VideoContext | None = None,
    ingestion_provider: SidecarVideoIngestionProvider | None = None,
) -> dict[str, Any]:
    digest, size_bytes = _sha256_and_size(case.video_path)
    return {
        "video": {
            "path": str(case.video_path),
            "sha256": digest,
            "size_bytes": size_bytes,
            "duration_seconds": case.duration_seconds,
            "language": case.language,
        },
        "provider_name": provider_name,
        "model_name": model_name,
        "prompt_asset_hashes": prompt_asset_hashes(),
        "ingestion": _ingestion_snapshot(context=context, ingestion_provider=ingestion_provider),
        "runtime": {
            "git_commit": _git_commit(),
            "python_version": sys.version.split()[0],
            "platform": platform.platform(),
        },
    }


def prompt_asset_hashes() -> dict[str, str]:
    hashes = {}
    for name in PROMPT_ASSETS:
        content = resources.files(__package__).joinpath("prompts", name).read_bytes()
        hashes[name] = hashlib.sha256(content).hexdigest()
    return hashes


def provider_identity(provider: object, *, provider_name: str | None = None, model_name: str | None = None) -> tuple[str, str]:
    if provider_name and model_name:
        return provider_name, model_name
    resolved_provider = provider_name or provider.__class__.__name__.replace("Provider", "").lower()
    resolved_model = model_name
    model_getter = getattr(provider, "_model", None)
    if resolved_model is None and callable(model_getter):
        try:
            resolved_model = str(model_getter())
        except Exception:
            resolved_model = None
    if resolved_model is None:
        resolved_model = "mock" if resolved_provider == "mock" else resolved_provider
    return resolved_provider, resolved_model


def _ingestion_snapshot(
    *,
    context: VideoContext | None,
    ingestion_provider: SidecarVideoIngestionProvider | None,
) -> dict[str, Any]:
    mode = None
    if context is not None:
        if context.has_file_input:
            mode = "file"
        elif context.has_frame_input:
            mode = "frames"
        elif context.has_video_input:
            mode = "inline"
        else:
            mode = "sidecar_text"
    return {
        "mode": mode,
        "frame_count": len(context.frames) if context and context.has_frame_input else None,
        "video_fps": context.video_fps if context and context.has_video_input else None,
        "configured_mode": getattr(ingestion_provider, "video_input_mode", None),
        "configured_frame_count": getattr(ingestion_provider, "frame_count", None),
        "configured_max_frame_edge": getattr(ingestion_provider, "max_frame_edge", None),
    }


def _sha256_and_size(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size_bytes = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            size_bytes += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size_bytes


def _git_commit() -> str | None:
    repo_root = Path(__file__).resolve().parents[3]
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            check=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None
